import type { Connection } from "mysql2/promise";
import {
  type LoadedManifest,
  loadManifest,
} from "../../server/src/platform/migrations/manifest.js";
import { migrate } from "../../server/src/platform/migrations/migrator.js";
import type { MysqlTestContext } from "../../server/tests/support/mysql.js";

interface ColumnRow {
  TABLE_NAME: string;
}

async function rowsByTable(connection: Connection, sql: string, database: string) {
  const [rows] = await connection.query(sql, [database]);
  const byTable = new Map<string, unknown[]>();
  for (const row of rows as ColumnRow[]) {
    const list = byTable.get(row.TABLE_NAME) ?? [];
    list.push(row);
    byTable.set(row.TABLE_NAME, list);
  }
  return byTable;
}

const QUERIES = [
  "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
  `SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE,
          CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  `SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
];

/** Tabelas cuja estrutura (tabela, colunas, índices) difere entre dois bancos. */
export async function compareStructures(
  a: { connection: Connection; database: string },
  b: { connection: Connection; database: string },
): Promise<string[]> {
  const differing = new Set<string>();
  for (const sql of QUERIES) {
    const left = await rowsByTable(a.connection, sql, a.database);
    const right = await rowsByTable(b.connection, sql, b.database);
    for (const table of new Set([...left.keys(), ...right.keys()])) {
      if (JSON.stringify(left.get(table)) !== JSON.stringify(right.get(table)))
        differing.add(table);
    }
  }
  return [...differing].sort();
}

export interface UpgradeResult {
  artifact: string;
  baseVersions: number;
  currentVersions: number;
  differences: string[];
}

/**
 * Aplica `base` e depois `current` em um banco temporário e `current` do zero em outro, e compara
 * as estruturas (FR-017, CS-005, constituição V). Sem base: nada a comparar.
 */
export async function checkUpgradePath(
  ctx: MysqlTestContext,
  label: string,
  base: LoadedManifest | null,
  current: LoadedManifest,
): Promise<UpgradeResult> {
  const result = {
    artifact: current.artifact,
    baseVersions: base?.migrations.length ?? 0,
    currentVersions: current.migrations.length,
    differences: [] as string[],
  };
  if (!base) return result;

  const upgradedDb = await ctx.createDatabase(`upgrade_${label}_a`);
  const freshDb = await ctx.createDatabase(`upgrade_${label}_b`);
  const upgraded = await ctx.connect("test", upgradedDb);
  const fresh = await ctx.connect("test", freshDb);
  await migrate(upgraded, base, { appliedBy: "check:upgrade" });
  await migrate(upgraded, current, { appliedBy: "check:upgrade" });
  await migrate(fresh, current, { appliedBy: "check:upgrade" });
  result.differences = await compareStructures(
    { connection: upgraded, database: upgradedDb },
    { connection: fresh, database: freshDb },
  );
  return result;
}

export { loadManifest };
