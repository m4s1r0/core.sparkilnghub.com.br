import { randomBytes } from "node:crypto";
import type { Connection } from "mysql2/promise";
import type { Config } from "../config/load.js";
import { openAdminConnection } from "../db/pools.js";
import { mysqlUser } from "../config/schema.js";
import { grantDatabaseName, instanceDatabaseName, instanceUserName, uuidToBin } from "../ids.js";
import { accessProjectionDir } from "../paths.js";
import { validateArtifact } from "./artifact-validator.js";
import { appliedBy } from "./core-migrations.js";
import { loadManifest, type LoadedManifest, MigrationError } from "./manifest.js";
import { migrate } from "./migrator.js";

/** Histórico do artefato da projeção, separado do histórico do produto (F01 R-07). */
export const ACCESS_HISTORY_TABLE = "_spark_access_history";

/** Banco de acesso companheiro do banco operacional: mesmo prefixo e UUID (constituição I). */
export const accessDatabaseName = (database: string) => `${database}_acc`;

export interface ApplyArtifactOptions {
  instanceUuid: string;
  synthetic: boolean;
  /** Para testes de atualização: aplica até esta versão. */
  targetVersion?: number;
}

export interface AppliedInstance {
  database: string;
  /** Banco de acesso `<database>_acc` com a projeção de acesso (D-04). */
  accessDatabase: string;
  user: string;
  /** Senha da credencial operacional; só existe quando o usuário é criado nesta chamada. */
  password: string | null;
  applied: number[];
  created: boolean;
}

async function databaseExists(connection: Connection, name: string): Promise<boolean> {
  const [rows] = await connection.query(
    "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
    [name],
  );
  return (rows as unknown[]).length > 0;
}

/** Prova de propriedade: o marcador da instância precisa ter o mesmo UUID (SC-021). */
async function assertOwnership(connection: Connection, database: string, uuid: string) {
  try {
    const [rows] = await connection.query(
      `SELECT instance_uuid FROM \`${database}\`._spark_instance WHERE instance_uuid = ?`,
      [uuidToBin(uuid)],
    );
    if ((rows as unknown[]).length === 1) return;
  } catch {
    // sem marcador
  }
  throw new MigrationError(
    "SCHEMA_UNKNOWN_VERSION",
    `Banco ${database} existe sem marcador desta instância; não será reutilizado`,
  );
}

/** Prova de propriedade do banco de acesso: a linha de `access_instance` tem o mesmo UUID. */
async function assertAccessOwnership(connection: Connection, database: string, uuid: string) {
  const [rows] = await connection.query(`SELECT instance_id FROM \`${database}\`.access_instance`);
  const found = rows as { instance_id: Buffer }[];
  if (found.length === 0 || found.every((r) => r.instance_id.equals(uuidToBin(uuid)))) return;
  throw new MigrationError(
    "SCHEMA_UNKNOWN_VERSION",
    `Banco ${database} pertence a outra instância; não será reutilizado`,
  );
}

/**
 * Cria (ou atualiza) o banco de acesso da instância: aplica o artefato `access_projection` com
 * histórico próprio e grava a linha única de `access_instance` (estado `ativa`, F01).
 */
async function applyAccessProjection(
  config: Config,
  admin: Connection,
  accessDatabase: string,
  instanceUuid: string,
): Promise<void> {
  if (await databaseExists(admin, accessDatabase)) {
    await assertAccessOwnership(admin, accessDatabase, instanceUuid).catch((error: unknown) => {
      // Banco criado mas sem a tabela ainda (falha antes da v1): segue para migrar.
      if ((error as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw error;
    });
  } else {
    await admin.query(
      `CREATE DATABASE \`${accessDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  }
  const connection = await openAdminConnection(config, "provisioner", accessDatabase);
  try {
    await migrate(connection, await loadManifest(accessProjectionDir), {
      appliedBy: appliedBy("spark_provisioner"),
      historyTable: ACCESS_HISTORY_TABLE,
    });
    await connection.query(
      `INSERT IGNORE INTO access_instance (instance_id, state, authorization_revision, updated_at)
       VALUES (?, 'ativa', 1, UTC_TIMESTAMP(6))`,
      [uuidToBin(instanceUuid)],
    );
  } finally {
    await connection.end();
  }
}

/**
 * Concede os privilégios do banco de acesso (R-07): o escritor do Core tem DML; o usuário da
 * instância só lê e insere logout, sem UPDATE nem DELETE (um encerramento nunca é desfeito).
 * Privilégio por tabela usa o nome literal do banco: curingas só valem em `banco.*`.
 */
async function grantAccessProjection(admin: Connection, accessDatabase: string, user: string) {
  const pattern = grantDatabaseName(accessDatabase);
  await admin.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${pattern}\`.* TO '${mysqlUser.access}'@'%'`,
  );
  await admin.query(`GRANT SELECT ON \`${pattern}\`.* TO '${user}'@'%'`);
  await admin.query(`GRANT INSERT ON \`${accessDatabase}\`.access_session_logout TO '${user}'@'%'`);
}

/**
 * Aplica um artefato de produto em um banco de instância com a credencial do provisionador:
 * cria o banco (nome derivado do UUID), aplica as versões, grava o marcador logo após a v1, cria
 * a credencial operacional só com DML nesse banco e o banco de acesso companheiro com a projeção
 * (F01, D-04). Base do provisionador de F02, sem tarefas persistentes nesta fatia.
 */
export async function applyArtifact(
  config: Config,
  loaded: LoadedManifest,
  options: ApplyArtifactOptions,
): Promise<AppliedInstance> {
  validateArtifact(loaded);
  const prefix = loaded.manifest.databasePrefix ?? `${loaded.artifact}_`;
  const database = instanceDatabaseName(prefix, options.instanceUuid);
  const accessDatabase = accessDatabaseName(database);
  const user = instanceUserName(options.instanceUuid);

  const admin = await openAdminConnection(config, "provisioner");
  let created = false;
  let password: string | null = null;
  let applied: number[];
  try {
    if (await databaseExists(admin, database)) {
      await assertOwnership(admin, database, options.instanceUuid);
    } else {
      await admin.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      created = true;
    }

    const connection = await openAdminConnection(config, "provisioner", database);
    try {
      const result = await migrate(connection, loaded, {
        appliedBy: appliedBy("spark_provisioner"),
        ...(options.targetVersion !== undefined ? { targetVersion: options.targetVersion } : {}),
        afterVersion: async (version, conn) => {
          if (version !== 1) return;
          await conn.query(
            `INSERT INTO _spark_instance (instance_uuid, product_code, owner_task_uuid, synthetic, created_at)
             VALUES (?, ?, NULL, ?, UTC_TIMESTAMP(6))`,
            [uuidToBin(options.instanceUuid), loaded.artifact, options.synthetic],
          );
        },
      });
      applied = result.applied;
    } finally {
      await connection.end();
    }

    // O provisionador não lê mysql.user; a existência vem do próprio CREATE USER (erro 1396).
    const candidate = randomBytes(24).toString("base64url");
    try {
      await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [candidate]);
      password = candidate;
    } catch (error) {
      if ((error as { errno?: number }).errno !== 1396) throw error;
    }
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${grantDatabaseName(database)}\`.* TO '${user}'@'%'`,
    );
    await applyAccessProjection(config, admin, accessDatabase, options.instanceUuid);
    await grantAccessProjection(admin, accessDatabase, user);
  } finally {
    await admin.end();
  }
  return { database, accessDatabase, user, password, applied, created };
}
