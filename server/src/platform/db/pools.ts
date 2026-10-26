import { Kysely, MysqlDialect } from "kysely";
import { createPool, type Pool } from "mysql2";
import { createConnection, type Connection } from "mysql2/promise";
import type { Config } from "../config/load.js";
import { type CredentialRole, mysqlUser } from "../config/schema.js";

const DATABASE_NAME = /^[a-z][a-z0-9_]{1,63}$/;

interface Entry {
  pool: Pool;
  db: Kysely<unknown>;
  limit: number;
}

/**
 * Pools por par (banco, credencial). Cada pool pertence a um único banco; trocar de banco com
 * `USE` em conexão compartilhada é proibido (princípio I). Há limite por pool e teto global.
 */
export class PoolRegistry {
  readonly #entries = new Map<string, Entry>();

  constructor(private readonly config: Config) {}

  #password(role: CredentialRole): string {
    const password = this.config.credentials[role];
    if (!password) throw new Error(`Credencial ${role} não carregada nesta configuração`);
    return password;
  }

  get openConnections(): number {
    let total = 0;
    for (const entry of this.#entries.values()) total += entry.limit;
    return total;
  }

  /** Kysely sobre um pool exclusivo de `database` com a credencial `role`. */
  get<DB>(role: CredentialRole, database: string): Kysely<DB> {
    if (!DATABASE_NAME.test(database)) throw new TypeError(`Nome de banco inválido: ${database}`);
    const key = `${database}\u0000${role}`;
    const existing = this.#entries.get(key);
    if (existing) return existing.db as Kysely<DB>;

    const limit = this.config.DB_POOL_LIMIT;
    if (this.openConnections + limit > this.config.DB_POOL_GLOBAL_LIMIT) {
      throw new Error("Teto global de conexões atingido");
    }
    const pool = createPool({
      host: this.config.MYSQL_HOST,
      port: this.config.MYSQL_PORT,
      user: mysqlUser[role],
      password: this.#password(role),
      database,
      connectionLimit: limit,
      maxIdle: limit,
      idleTimeout: 60_000,
      timezone: "Z",
      multipleStatements: false,
      connectTimeout: 2_000,
      supportBigNumbers: true,
    });
    const db = new Kysely<DB>({ dialect: new MysqlDialect({ pool }) });
    this.#entries.set(key, { pool, db: db as Kysely<unknown>, limit });
    return db;
  }

  async closeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(entries.map((entry) => entry.db.destroy()));
  }
}

/**
 * Conexão única para tarefas administrativas (migrações, criação de banco). Aceita várias
 * instruções por arquivo; nunca é compartilhada entre requisições.
 */
export async function openAdminConnection(
  config: Config,
  role: CredentialRole,
  database?: string,
): Promise<Connection> {
  if (database !== undefined && !DATABASE_NAME.test(database)) {
    throw new TypeError(`Nome de banco inválido: ${database}`);
  }
  const password = config.credentials[role];
  if (!password) throw new Error(`Credencial ${role} não carregada nesta configuração`);
  return createConnection({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: mysqlUser[role],
    password,
    ...(database ? { database } : {}),
    timezone: "Z",
    multipleStatements: true,
    connectTimeout: 5_000,
  });
}
