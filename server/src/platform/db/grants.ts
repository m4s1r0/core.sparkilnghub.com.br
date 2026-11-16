import type { Connection } from "mysql2/promise";
import type { Config } from "../config/load.js";
import { grantDatabaseName } from "../ids.js";

const USER = /^[a-z][a-z0-9_]{1,31}$/;
const HOST = /^[A-Za-z0-9.%_:-]{1,255}$/;
const TABLE = /^[A-Za-z0-9_$]{1,64}$/;

/** Prefixo das tabelas internas do Core no banco da instância (`_spark_instance`, histórico). */
export const INTERNAL_TABLE_PREFIX = "_spark_";

/**
 * Conta MySQL da credencial operacional da instância: `'<usuário>'@'<host>'`. Fora do
 * desenvolvimento o host é a rede da aplicação, nunca `%` (SEC-15, `INSTANCE_DB_USER_HOST`).
 */
export function instanceAccount(user: string, host = "%"): string {
  if (!USER.test(user)) throw new TypeError(`Usuário MySQL inválido: ${user}`);
  if (!HOST.test(host)) throw new TypeError(`Host MySQL inválido: ${host}`);
  return `'${user}'@'${host}'`;
}

/** Conta e exigência de TLS da credencial operacional conforme a configuração (SEC-15). */
export function instanceAccountOf(
  config: Pick<Config, "INSTANCE_DB_USER_HOST" | "MYSQL_TLS">,
  user: string,
): { account: string; requireTls: boolean } {
  return {
    account: instanceAccount(user, config.INSTANCE_DB_USER_HOST),
    requireTls: config.MYSQL_TLS !== "off",
  };
}

/** Sufixo de `CREATE USER`: TLS obrigatório fora do desenvolvimento (SEC-15). */
export const tlsClause = (requireTls: boolean): string => (requireTls ? " REQUIRE SSL" : "");

export interface OperationalGrants {
  database: string;
  account: string;
  /** Tabelas só-inserção declaradas no artefato (SEC-12); ausentes no banco são ignoradas. */
  appendOnlyTables: readonly string[];
  requireTls: boolean;
}

/**
 * Privilégios da credencial operacional no banco da instância (SEC-12, SEC-BASE-12):
 *
 * - banco: só `SELECT` (inclui `_spark_*`, que o produto lê e nunca escreve);
 * - tabela comum: `INSERT, UPDATE, DELETE`;
 * - tabela só-inserção (declarada no artefato): só `INSERT` — o rastro não é alterável.
 *
 * Idempotente. Concede antes de revogar, para que uma instância em uso nunca fique sem o
 * privilégio de que precisa durante a troca. Chamada no provisionamento, depois de cada migração e
 * pela CLI `instances:sync-grants`. Privilégio por tabela usa o nome literal do banco (curingas só
 * valem em `banco.*`).
 */
export async function syncOperationalGrants(
  admin: Connection,
  grants: OperationalGrants,
): Promise<{ tables: number; appendOnly: string[] }> {
  const { database, account } = grants;
  const [rows] = await admin.query(
    `SELECT TABLE_NAME AS name FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [database],
  );
  const tables = (rows as { name: string }[]).map((row) => row.name);
  for (const table of tables) {
    if (!TABLE.test(table)) throw new TypeError(`Nome de tabela inesperado: ${table}`);
  }
  const declared = new Set(grants.appendOnlyTables);
  const appendOnly = tables.filter((t) => declared.has(t));
  const internal = tables.filter((t) => t.startsWith(INTERNAL_TABLE_PREFIX));
  const regular = tables.filter((t) => !declared.has(t) && !t.startsWith(INTERNAL_TABLE_PREFIX));
  const on = (table: string) => `\`${database}\`.\`${table}\``;

  await admin.query(`GRANT SELECT ON \`${grantDatabaseName(database)}\`.* TO ${account}`);
  for (const table of regular) {
    await admin.query(`GRANT INSERT, UPDATE, DELETE ON ${on(table)} TO ${account}`);
  }
  for (const table of appendOnly) {
    await admin.query(`GRANT INSERT ON ${on(table)} TO ${account}`);
  }
  // Só depois de conceder: retira o DML amplo de nível de banco (modelo anterior a SEC-12) e
  // qualquer UPDATE/DELETE que reste nas tabelas só-inserção e internas.
  await admin.query(
    `REVOKE IF EXISTS INSERT, UPDATE, DELETE ON \`${grantDatabaseName(database)}\`.* FROM ${account}`,
  );
  for (const table of appendOnly) {
    await admin.query(`REVOKE IF EXISTS UPDATE, DELETE ON ${on(table)} FROM ${account}`);
  }
  for (const table of internal) {
    await admin.query(`REVOKE IF EXISTS INSERT, UPDATE, DELETE ON ${on(table)} FROM ${account}`);
  }
  if (grants.requireTls) await admin.query(`ALTER USER ${account} REQUIRE SSL`);
  return { tables: tables.length, appendOnly };
}
