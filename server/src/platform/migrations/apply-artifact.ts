import { randomBytes } from "node:crypto";
import type { Connection } from "mysql2/promise";
import type { Config } from "../config/load.js";
import { openAdminConnection } from "../db/pools.js";
import { grantDatabaseName, instanceDatabaseName, instanceUserName, uuidToBin } from "../ids.js";
import { validateArtifact } from "./artifact-validator.js";
import { appliedBy } from "./core-migrations.js";
import { type LoadedManifest, MigrationError } from "./manifest.js";
import { migrate } from "./migrator.js";

export interface ApplyArtifactOptions {
  instanceUuid: string;
  synthetic: boolean;
  /** Para testes de atualização: aplica até esta versão. */
  targetVersion?: number;
}

export interface AppliedInstance {
  database: string;
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

/**
 * Aplica um artefato de produto em um banco de instância com a credencial do provisionador:
 * cria o banco (nome derivado do UUID), aplica as versões, grava o marcador logo após a v1 e cria
 * a credencial operacional só com DML nesse banco. Base do provisionador de F02, sem tarefas
 * persistentes nesta fatia.
 */
export async function applyArtifact(
  config: Config,
  loaded: LoadedManifest,
  options: ApplyArtifactOptions,
): Promise<AppliedInstance> {
  validateArtifact(loaded);
  const prefix = loaded.manifest.databasePrefix ?? `${loaded.artifact}_`;
  const database = instanceDatabaseName(prefix, options.instanceUuid);
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

    const [users] = await admin
      .query("SELECT 1 FROM mysql.user WHERE user = ?", [user])
      .catch(() => [[]] as [unknown[]]);
    if ((users as unknown[]).length === 0) {
      password = randomBytes(24).toString("base64url");
      await admin.query(`CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY ?`, [password]);
    }
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${grantDatabaseName(database)}\`.* TO '${user}'@'%'`,
    );
  } finally {
    await admin.end();
  }
  return { database, user, password, applied, created };
}
