import { readFileSync } from "node:fs";
import { Kysely, MysqlDialect } from "kysely";
import { createPool, type Pool } from "mysql2";
import { createConnection, type Connection } from "mysql2/promise";
import type { Config } from "../config/load.js";
import { type CredentialRole, mysqlUser } from "../config/schema.js";

const DATABASE_NAME = /^[a-z][a-z0-9_]{1,63}$/;

/**
 * TLS até o MySQL (SEC-15): `required` cifra sem verificar a CA (rede interna com certificado
 * próprio do servidor); `verify` cifra e verifica com `MYSQL_TLS_CA`. `off` só em desenvolvimento
 * (a configuração recusa nos demais ambientes).
 */
export function sslOptions(
  config: Pick<Config, "MYSQL_TLS"> & Partial<Pick<Config, "MYSQL_TLS_CA">>,
): { rejectUnauthorized: boolean; ca?: string } | undefined {
  if (config.MYSQL_TLS === "off") return undefined;
  if (config.MYSQL_TLS === "required") return { rejectUnauthorized: false };
  if (!config.MYSQL_TLS_CA) throw new Error("MYSQL_TLS_CA ausente (MYSQL_TLS=verify)");
  return { rejectUnauthorized: true, ca: readFileSync(config.MYSQL_TLS_CA, "utf8") };
}

/** `{ ssl }` para espalhar nas opções do mysql2, ou nada com TLS desligado. */
export function sslField(
  config: Pick<Config, "MYSQL_TLS"> & Partial<Pick<Config, "MYSQL_TLS_CA">>,
): { ssl: { rejectUnauthorized: boolean; ca?: string } } | Record<string, never> {
  const ssl = sslOptions(config);
  return ssl ? { ssl } : {};
}

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
      ...sslField(this.config),
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
    ...sslField(config),
  });
}
