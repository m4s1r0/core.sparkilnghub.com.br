import { sql } from "kysely";
import { PASSWORD_PARAMS_VERSION, hashPassword } from "../../src/modules/identity/password.js";
import { type InstanceRef, registerInstanceRef } from "../../src/modules/instances/instance-ref.js";
import { createLogger } from "../../src/platform/logging/logger.js";
import { type AppContext, createAppContext } from "../../src/platform/context.js";
import { PoolRegistry } from "../../src/platform/db/pools.js";
import { grantDatabaseName, newId, uuidToBin } from "../../src/platform/ids.js";
import { applyArtifact } from "../../src/platform/migrations/apply-artifact.js";
import { appliedBy } from "../../src/platform/migrations/core-migrations.js";
import { loadManifest } from "../../src/platform/migrations/manifest.js";
import { migrate } from "../../src/platform/migrations/migrator.js";
import { migrationsDir, referenceProductDir } from "../../src/platform/paths.js";
import { MysqlTestContext } from "./mysql.js";

/** Relógio controlado pelo teste (expiração de sessões, janelas de limitação, TOTP). */
export class TestClock {
  constructor(public current = new Date("2026-10-26T12:00:00.000Z")) {}
  now = (): Date => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/**
 * Ambiente de F01 isolado: `spark_identity` e `spark_core` migrados em bancos `t_<run>_*` e
 * acessados com a credencial de teste; bancos de instância e de acesso reais (`sparkref_*`),
 * criados pelo provisionador e removidos no fim.
 */
export class F01TestEnv {
  private constructor(
    readonly mysql: MysqlTestContext,
    readonly pools: PoolRegistry,
    readonly ctx: AppContext,
    readonly clock: TestClock,
    readonly databases: { identity: string; core: string },
  ) {}

  static async create(): Promise<F01TestEnv> {
    const mysql = await MysqlTestContext.create();
    const databases = {
      identity: await mysql.createDatabase("identity"),
      core: await mysql.createDatabase("core"),
    };
    for (const [artifact, database] of [
      ["spark_identity", databases.identity],
      ["spark_core", databases.core],
    ] as const) {
      const connection = await mysql.connect("test", database);
      await migrate(connection, await loadManifest(migrationsDir(artifact)), {
        appliedBy: appliedBy("spark_test"),
      });
    }
    const pools = new PoolRegistry({ ...mysql.config, DB_POOL_GLOBAL_LIMIT: 500 });
    const clock = new TestClock();
    const ctx = createAppContext(mysql.config, pools, {
      identityDatabase: databases.identity,
      coreDatabase: databases.core,
      role: "test",
      clock: clock.now,
      logger: createLogger({ name: "f01-test", level: "silent" }),
    });
    return new F01TestEnv(mysql, pools, ctx, clock, databases);
  }

  readonly #extraPools: PoolRegistry[] = [];

  /**
   * Contexto com pools novos. Privilégios de banco revogados só valem para conexões abertas
   * depois do REVOKE; simulações de banco inacessível usam este contexto.
   */
  freshContext(): AppContext {
    const pools = new PoolRegistry({ ...this.mysql.config, DB_POOL_GLOBAL_LIMIT: 500 });
    this.#extraPools.push(pools);
    return createAppContext(this.mysql.config, pools, {
      identityDatabase: this.databases.identity,
      coreDatabase: this.databases.core,
      role: "test",
      clock: this.clock.now,
      logger: createLogger({ name: "f01-test", level: "silent" }),
    });
  }

  /** Retira (ou devolve) o DML do escritor no banco de acesso: instância "inacessível". */
  async setWriterAccess(instance: InstanceRef, allowed: boolean): Promise<void> {
    const provisioner = await this.mysql.connect("provisioner");
    const pattern = grantDatabaseName(instance.accessDatabaseName);
    await provisioner.query(
      allowed
        ? `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${pattern}\`.* TO 'spark_access_writer'@'%'`
        : `REVOKE SELECT, INSERT, UPDATE, DELETE ON \`${pattern}\`.* FROM 'spark_access_writer'@'%'`,
    );
  }

  /** Instância sintética do produto de referência com banco de acesso e referência registrada. */
  async createInstance(slug: string, displayName = `[SINTÉTICO] ${slug}`): Promise<TestInstance> {
    const id = newId();
    const applied = await applyArtifact(
      this.mysql.config,
      await loadManifest(referenceProductDir),
      {
        instanceUuid: id,
        synthetic: true,
      },
    );
    this.mysql.trackInstanceDatabase(applied.database);
    this.mysql.trackInstanceDatabase(applied.accessDatabase);
    this.mysql.trackUser(applied.user);
    if (!applied.password) throw new Error("usuário da instância deveria ser novo");
    const ref = await registerInstanceRef(this.ctx, {
      id,
      productCode: "sparkref",
      slug,
      displayName,
      databaseName: applied.database,
      accessDatabaseName: applied.accessDatabase,
      synthetic: true,
    });
    return { ...ref, user: applied.user, password: applied.password };
  }

  /** Conta gravada direto na fonte (sem passar pelo fluxo de convite). */
  async insertAccount(
    options: {
      email?: string;
      displayName?: string;
      status?: "ativa" | "inativa" | "bloqueada";
      password?: string;
    } = {},
  ): Promise<{ id: string; email: string; password: string }> {
    const id = newId();
    const email = options.email ?? `conta-${id.slice(-12)}@example.test`;
    const password = options.password ?? `senha-de-teste-${id.slice(-8)}`;
    const now = this.clock.now();
    await sql`INSERT INTO account (id, email_normalized, email_display, display_name, status,
                auth_revision, created_at, updated_at)
              VALUES (${uuidToBin(id)}, ${email}, ${email}, ${options.displayName ?? `[SINTÉTICO] Conta ${id.slice(-6)}`},
                      ${options.status ?? "ativa"}, 1, ${now}, ${now})`.execute(this.ctx.identity);
    await sql`INSERT INTO password_credential (account_id, hash, params_version, changed_at)
              VALUES (${uuidToBin(id)}, ${await hashPassword(password)}, ${PASSWORD_PARAMS_VERSION}, ${now})`.execute(
      this.ctx.identity,
    );
    return { id, email, password };
  }

  async insertMembership(
    accountId: string,
    instanceId: string,
    role: "administrador" | "colaborador",
  ): Promise<string> {
    const id = newId();
    const now = this.clock.now();
    await sql`INSERT INTO membership (id, account_id, instance_id, role, status, version,
                created_at, changed_at)
              VALUES (${uuidToBin(id)}, ${uuidToBin(accountId)}, ${uuidToBin(instanceId)}, ${role},
                      'ativo', 1, ${now}, ${now})`.execute(this.ctx.identity);
    return id;
  }

  readonly #connections: { end(): Promise<void> }[] = [];

  /** Conexões abertas pelo teste (ex.: produto de referência), encerradas no fim. */
  trackConnection(connection: { end(): Promise<void> }): void {
    this.#connections.push(connection);
  }

  async cleanup(): Promise<void> {
    for (const connection of this.#connections.splice(0)) await connection.end().catch(() => {});
    for (const pools of this.#extraPools) await pools.closeAll();
    await this.pools.closeAll();
    await this.mysql.cleanup();
  }
}

export type TestInstance = InstanceRef & { user: string; password: string };
