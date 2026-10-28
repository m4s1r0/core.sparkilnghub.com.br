import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { type Connection, createConnection } from "mysql2/promise";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { openAdminConnection } from "../../platform/db/pools.js";
import { grantDatabaseName, instanceUserName, uuidToBin } from "../../platform/ids.js";
import {
  ACCESS_HISTORY_TABLE,
  accessDatabaseName,
  databaseExists,
  grantAccessProjection,
} from "../../platform/migrations/apply-artifact.js";
import { appliedBy } from "../../platform/migrations/core-migrations.js";
import { type LoadedManifest, loadManifest } from "../../platform/migrations/manifest.js";
import { checkHistory, migrate, readHistory } from "../../platform/migrations/migrator.js";
import { accessProjectionDir } from "../../platform/paths.js";
import { prepareInitialInvitation } from "../identity/invitations.js";
import type { Instance } from "../instances/instances.js";
import { ProvisioningFailure } from "./errors.js";
import {
  discardFreshIntent,
  getResource,
  markResource,
  recordIntent,
  type ResourceKind,
  resourceSecret,
  tableNames,
} from "./resources.js";
import type { Step, Task } from "./tasks.js";

export type StepOutcome = "concluida" | "ignorada";

export interface StepContext {
  ctx: AppContext;
  /** Configuração com a credencial `provisioner` (só no trabalhador e nas sementes). */
  config: Config;
  task: Task;
  instance: Instance;
  manifest: LoadedManifest;
  /** Só em testes: chamado depois de cada efeito no MySQL e antes do registro (R-19). */
  afterEffect?: (step: Step) => void | Promise<void>;
}

const CHARSET = "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci";
const conflict = (detail: string) =>
  new ProvisioningFailure("PROVISIONING_RESOURCE_CONFLICT", detail);

export async function withAdmin<T>(
  config: Config,
  database: string | undefined,
  run: (c: Connection) => Promise<T>,
) {
  const connection = await openAdminConnection(config, "provisioner", database);
  try {
    return await run(connection);
  } finally {
    await connection.end().catch(() => undefined);
  }
}

/** Banco já existente: só é adotado com intenção desta instância e prova de propriedade. */
async function assertOwnedDatabase(
  admin: Connection,
  kind: ResourceKind,
  database: string,
  instanceId: string,
): Promise<void> {
  const tables = await tableNames(admin, database);
  // Queda entre CREATE DATABASE e a primeira versão: banco vazio com intenção (CA-SC-006).
  if (tables.length === 0) return;
  const [table, column] =
    kind === "banco_operacional"
      ? ["_spark_instance", "instance_uuid"]
      : ["access_instance", "instance_id"];
  if (!tables.includes(table)) {
    // Projeção criada e ainda sem a linha da instância (queda antes de `configurar`).
    if (kind === "banco_acesso" && tables.includes(ACCESS_HISTORY_TABLE)) return;
    throw conflict(`${kind} com tabelas e sem marcador`);
  }
  const [rows] = await admin.query(`SELECT ${column} AS id FROM \`${database}\`.${table}`);
  const ids = (rows as { id: Buffer }[]).map((r) => r.id);
  if (ids.length === 0 && kind === "banco_acesso") return;
  if (ids.length !== 1 || !ids[0]?.equals(uuidToBin(instanceId))) {
    throw conflict(`${kind} com marcador de outra instância`);
  }
}

/** Etapa 3: banco operacional e banco de acesso, derivados do UUID (SC-019, FR-029). */
export async function createDatabases(sc: StepContext): Promise<StepOutcome> {
  const { ctx, config, instance, task } = sc;
  let effects = 0;
  await withAdmin(config, undefined, async (admin) => {
    for (const [kind, name] of [
      ["banco_operacional", instance.databaseName],
      ["banco_acesso", accessDatabaseName(instance.databaseName)],
    ] as const) {
      const intent = await getResource(ctx.core, instance.id, kind);
      if (await databaseExists(admin, name)) {
        if (!intent) throw conflict(`${kind} existe sem intenção`);
        await assertOwnedDatabase(admin, kind, name, instance.id);
        if (intent.status === "pretendido") {
          await markResource(ctx, instance.id, kind, "criado");
          effects += 1;
        }
        continue;
      }
      if (!intent) {
        await recordIntent(ctx, {
          instanceId: instance.id,
          kind,
          identifier: name,
          taskId: task.id,
        });
      }
      await admin.query(`CREATE DATABASE \`${name}\` ${CHARSET}`);
      await sc.afterEffect?.("criar_bancos");
      await markResource(ctx, instance.id, kind, "criado");
      effects += 1;
    }
  });
  return effects > 0 ? "concluida" : "ignorada";
}

/**
 * Etapa 4: credencial operacional exclusiva (FR-029, FR-030). A senha é gerada e gravada cifrada
 * junto com a intenção ANTES do `CREATE USER`; usuário já existente é adotado (`ALTER USER` com a
 * senha guardada) só se a intenção já existia antes desta tentativa (R-06).
 */
export async function createCredential(sc: StepContext): Promise<StepOutcome> {
  const { ctx, config, instance, task } = sc;
  const user = instanceUserName(instance.id);
  let intent = await getResource(ctx.core, instance.id, "usuario_mysql");
  const fresh = intent === null;
  if (!intent) {
    await recordIntent(ctx, {
      instanceId: instance.id,
      kind: "usuario_mysql",
      identifier: user,
      taskId: task.id,
      secret: randomBytes(32).toString("base64url"),
    });
    intent = await getResource(ctx.core, instance.id, "usuario_mysql");
    if (!intent) throw new Error("Intenção do usuário não gravada");
  }
  const password = resourceSecret(ctx, instance.id, intent);
  let created = false;
  await withAdmin(config, undefined, async (admin) => {
    try {
      await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
      created = true;
      await sc.afterEffect?.("criar_credencial");
    } catch (error) {
      if ((error as { errno?: number }).errno !== 1396) throw error;
      if (fresh) {
        await discardFreshIntent(ctx, instance.id, "usuario_mysql");
        throw conflict("usuário MySQL existe sem intenção");
      }
      if (intent.status === "pretendido") {
        await admin.query(`ALTER USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
      }
    }
    // DML só no operacional (idempotente). Os privilégios do banco de acesso são concedidos em
    // `aplicar_migracoes`, depois que as tabelas da projeção existem.
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${grantDatabaseName(instance.databaseName)}\`.* TO '${user}'@'%'`,
    );
  });
  const wasPending = intent.status === "pretendido";
  if (wasPending) await markResource(ctx, instance.id, "usuario_mysql", "criado");
  return created || wasPending ? "concluida" : "ignorada";
}

/**
 * Etapa 5: artefato do produto fixado na tarefa (com o marcador gravado logo após a v1) e a
 * projeção de acesso vigente. Versão interrompida no meio não é repetida (R-07).
 */
export async function applyMigrations(sc: StepContext): Promise<StepOutcome> {
  const { ctx, config, instance, task, manifest } = sc;
  const product = await withAdmin(config, instance.databaseName, (connection) =>
    migrate(connection, manifest, {
      appliedBy: appliedBy("spark_provisioner"),
      afterVersion: async (version, conn) => {
        if (version !== 1) return;
        await conn.query(
          `INSERT IGNORE INTO _spark_instance (instance_uuid, product_code, owner_task_uuid, synthetic, created_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))`,
          [uuidToBin(instance.id), manifest.artifact, uuidToBin(task.id), instance.synthetic],
        );
      },
    }),
  );
  if (product.applied.length > 0) await sc.afterEffect?.("aplicar_migracoes");
  const access = await withAdmin(config, accessDatabaseName(instance.databaseName), async (c) =>
    migrate(c, await loadManifest(accessProjectionDir), {
      appliedBy: appliedBy("spark_provisioner"),
      historyTable: ACCESS_HISTORY_TABLE,
    }),
  );
  // Leitura e logout para o usuário da instância; DML para o escritor do Core (F01 R-07).
  await withAdmin(config, undefined, (admin) =>
    grantAccessProjection(
      admin,
      accessDatabaseName(instance.databaseName),
      instanceUserName(instance.id),
    ),
  );
  await sql`UPDATE instance SET schema_version = ${manifest.migrations.length}
             WHERE id = ${uuidToBin(instance.id)}`.execute(ctx.core);
  return product.applied.length + access.applied.length > 0 ? "concluida" : "ignorada";
}

/** Etapa 6: marcador conferido e linha da projeção em `pronta` (projeção v2, R-11). */
export async function configure(sc: StepContext): Promise<StepOutcome> {
  const { config, instance } = sc;
  const id = uuidToBin(instance.id);
  await withAdmin(config, instance.databaseName, async (c) => {
    const [rows] = await c.query("SELECT instance_uuid AS id FROM _spark_instance");
    const ids = (rows as { id: Buffer }[]).map((r) => r.id);
    if (ids.length !== 1 || !ids[0]?.equals(id)) throw conflict("marcador divergente");
  });
  const inserted = await withAdmin(config, accessDatabaseName(instance.databaseName), async (c) => {
    const [result] = await c.query(
      `INSERT IGNORE INTO access_instance (instance_id, state, authorization_revision, updated_at)
       VALUES (?, 'pronta', ?, UTC_TIMESTAMP(6))`,
      [id, instance.authorizationRevision],
    );
    const [rows] = await c.query("SELECT instance_id AS id FROM access_instance");
    const ids = (rows as { id: Buffer }[]).map((r) => r.id);
    if (ids.length !== 1 || !ids[0]?.equals(id)) throw conflict("projeção de outra instância");
    return (result as { affectedRows: number }).affectedRows === 1;
  });
  if (inserted) await sc.afterEffect?.("configurar");
  return inserted ? "concluida" : "ignorada";
}

/** Etapa 7: convite inicial preparado, sem link (R-12, FR-034). */
export async function prepareInvitation(sc: StepContext): Promise<StepOutcome> {
  const { ctx, instance, task } = sc;
  if (!instance.initialAdminEmail) return "ignorada";
  const created = await prepareInitialInvitation(ctx.identity, ctx.clock(), {
    instanceId: instance.id,
    email: instance.initialAdminEmail,
    createdBy: task.requestedBy,
  });
  if (created) await sc.afterEffect?.("preparar_convite");
  return created ? "concluida" : "ignorada";
}

const errnoOf = (error: unknown) => (error as { errno?: number }).errno;

/** O comando precisa ser negado por privilégio; sucesso é falha de verificação (CS-006). */
async function expectDenied(connection: Connection, statement: string, label: string) {
  try {
    await connection.query(statement);
  } catch (error) {
    // 1044 banco, 1142 tabela, 1227 operação: todos negados por privilégio.
    if ([1044, 1142, 1227].includes(errnoOf(error) ?? 0)) return;
    throw error;
  }
  throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", `${label} permitido`);
}

/**
 * Etapa 8: com a credencial operacional, confere marcador, versão (prontidão conforme o contrato
 * do artefato) e privilégios negativos; marca os recursos como verificados.
 */
export async function verify(sc: StepContext): Promise<StepOutcome> {
  const { ctx, config, instance, manifest } = sc;
  const resource = await getResource(ctx.core, instance.id, "usuario_mysql");
  if (!resource) throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", "sem usuário");
  const password = resourceSecret(ctx, instance.id, resource);
  const open = (database: string) =>
    createConnection({
      host: config.MYSQL_HOST,
      port: config.MYSQL_PORT,
      user: resource.identifier,
      password,
      database,
      timezone: "Z",
      connectTimeout: 5_000,
    });
  const failed = (detail: string) =>
    new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", detail);

  const operational = await open(instance.databaseName);
  try {
    const [rows] = await operational.query("SELECT instance_uuid AS id FROM _spark_instance");
    const ids = (rows as { id: Buffer }[]).map((r) => r.id);
    if (ids.length !== 1 || !ids[0]?.equals(uuidToBin(instance.id))) throw failed("marcador");
    const history = checkHistory(await readHistory(operational), manifest);
    if (history.problem || history.appliedVersion !== manifest.migrations.length) {
      throw failed("versão do schema");
    }
    await expectDenied(operational, "CREATE TABLE _spark_probe (id INT)", "CREATE TABLE");
    await expectDenied(
      operational,
      `CREATE DATABASE \`${instance.databaseName}_probe\``,
      "CREATE DATABASE",
    );
  } finally {
    await operational.end().catch(() => undefined);
  }

  const access = await open(accessDatabaseName(instance.databaseName));
  try {
    const [rows] = await access.query("SELECT state FROM access_instance");
    const state = (rows as { state: string }[])[0]?.state;
    if (state !== "pronta" && state !== "ativa") throw failed("estado da projeção");
    await expectDenied(access, "UPDATE access_instance SET state = 'ativa'", "UPDATE na projeção");
  } finally {
    await access.end().catch(() => undefined);
  }

  for (const kind of ["banco_operacional", "banco_acesso", "usuario_mysql"] as const) {
    await markResource(ctx, instance.id, kind, "verificado");
  }
  await sc.afterEffect?.("verificar");
  return "concluida";
}
