import { randomBytes } from "node:crypto";
import { type Connection, createConnection } from "mysql2/promise";
import { assertEnvironment } from "../../src/platform/config/env-guard.js";
import { type Config, loadConfig } from "../../src/platform/config/load.js";
import type { CredentialRole } from "../../src/platform/config/schema.js";
import { openAdminConnection } from "../../src/platform/db/pools.js";
import { createLogger } from "../../src/platform/logging/logger.js";

const INSTANCE_PREFIXES = ["sparkref_", "sparkpet_"];

/**
 * Apoio dos testes de integração. Cria apenas bancos `t_<runid>_*` e remove somente o que ele
 * mesmo criou nesta execução. Recusa rodar fora de `development` (constituição IV, v1.1.1).
 */
export class MysqlTestContext {
  readonly runId = randomBytes(4).toString("hex");
  readonly #databases = new Set<string>();
  readonly #instanceDatabases = new Set<string>();
  readonly #users = new Set<string>();
  readonly #connections: Connection[] = [];

  private constructor(readonly config: Config) {}

  static async create(): Promise<MysqlTestContext> {
    const config = loadConfig({
      credentials: ["migrator", "web", "worker", "provisioner", "access", "test"],
      secrets: ["IDENTITY_SECRET_KEY", "INSTANCE_SECRET_KEY"],
    });
    await assertEnvironment(["development"], "test-harness", {
      config,
      logger: createLogger({ name: "test-harness", level: "silent" }),
    });
    return new MysqlTestContext(config);
  }

  async connect(role: CredentialRole, database?: string): Promise<Connection> {
    const connection = await openAdminConnection(this.config, role, database);
    this.#connections.push(connection);
    return connection;
  }

  /** Conexão com usuário arbitrário (ex.: usuário `inst_*` criado pelo provisionador). */
  async connectAs(user: string, password: string, database?: string): Promise<Connection> {
    const connection = await createConnection({
      host: this.config.MYSQL_HOST,
      port: this.config.MYSQL_PORT,
      user,
      password,
      ...(database ? { database } : {}),
      timezone: "Z",
      connectTimeout: 5_000,
    });
    this.#connections.push(connection);
    return connection;
  }

  /** Cria `t_<runid>_<suffix>` com o usuário de teste. */
  async createDatabase(suffix: string): Promise<string> {
    if (!/^[a-z0-9_]{1,40}$/.test(suffix)) throw new TypeError(`Sufixo inválido: ${suffix}`);
    const name = `t_${this.runId}_${suffix}`;
    const connection = await this.connect("test");
    await connection.query(
      `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    this.#databases.add(name);
    return name;
  }

  /** Registra banco de instância criado pelo teste, para remoção no teardown. */
  trackInstanceDatabase(name: string): void {
    if (!INSTANCE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      throw new TypeError(`Banco de instância fora do prefixo esperado: ${name}`);
    }
    this.#instanceDatabases.add(name);
  }

  trackUser(name: string): void {
    if (!name.startsWith("inst_")) throw new TypeError(`Usuário inesperado: ${name}`);
    this.#users.add(name);
  }

  async cleanup(): Promise<void> {
    for (const connection of this.#connections.splice(0)) {
      await connection.end().catch(() => undefined);
    }
    const prefix = `t_${this.runId}_`;
    const test = await openAdminConnection(this.config, "test");
    try {
      for (const name of this.#databases) {
        if (name.startsWith(prefix)) await test.query(`DROP DATABASE IF EXISTS \`${name}\``);
      }
    } finally {
      await test.end();
    }
    if (this.#instanceDatabases.size + this.#users.size === 0) return;
    const provisioner = await openAdminConnection(this.config, "provisioner");
    try {
      for (const name of this.#instanceDatabases) {
        await provisioner.query(`DROP DATABASE IF EXISTS \`${name}\``);
      }
      for (const name of this.#users) {
        await provisioner.query(`DROP USER IF EXISTS '${name}'@'%'`);
      }
    } finally {
      await provisioner.end();
    }
    this.#databases.clear();
    this.#instanceDatabases.clear();
    this.#users.clear();
  }
}

export async function tableStructure(connection: Connection, database: string): Promise<unknown[]> {
  const [tables] = await connection.query(
    "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [database],
  );
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE,
            CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const [indexes] = await connection.query(
    `SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [database],
  );
  return [tables, columns, indexes];
}
