import type { Connection } from "mysql2/promise";
import { type LoadedManifest, MigrationError, type MigrationErrorCode } from "./manifest.js";

export const HISTORY_TABLE = "_spark_schema_history";

const CREATE_HISTORY = `
CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
  version INT UNSIGNED NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  checksum CHAR(64) NOT NULL,
  artifact VARCHAR(64) NOT NULL,
  status ENUM('aplicada','falha') NOT NULL,
  started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  applied_by VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

export interface HistoryRow {
  version: number;
  name: string;
  checksum: string;
  artifact: string;
  status: "aplicada" | "falha";
}

export interface HistoryCheck {
  appliedVersion: number;
  expectedVersion: number;
  problem: Exclude<
    MigrationErrorCode,
    `MANIFEST_${string}` | "MIGRATION_FAILED" | "ARTIFACT_FORBIDDEN_CONSTRUCT"
  > | null;
  message?: string;
}

/** Compara o histórico gravado com o manifesto, sem alterar nada. */
export function checkHistory(history: HistoryRow[], loaded: LoadedManifest): HistoryCheck {
  const expectedVersion = loaded.migrations.length;
  let appliedVersion = 0;
  for (const [index, row] of history.entries()) {
    const migration = loaded.migrations[row.version - 1];
    if (!migration) {
      return {
        appliedVersion,
        expectedVersion,
        problem: "SCHEMA_UNKNOWN_VERSION",
        message: `Versão ${row.version} registrada no banco não existe no artefato ${loaded.artifact}`,
      };
    }
    if (row.version !== index + 1) {
      return {
        appliedVersion,
        expectedVersion,
        problem: "SCHEMA_SEQUENCE",
        message: `Histórico fora de sequência na versão ${row.version}`,
      };
    }
    if (row.checksum !== migration.sha256) {
      return {
        appliedVersion,
        expectedVersion,
        problem: "SCHEMA_CHECKSUM_MISMATCH",
        message: `Checksum da versão ${row.version} difere do artefato`,
      };
    }
    if (row.status === "falha") {
      return {
        appliedVersion,
        expectedVersion,
        problem: "SCHEMA_FAILED",
        message: `Versão ${row.version} falhou ou foi interrompida; exige verificação`,
      };
    }
    appliedVersion = row.version;
  }
  return { appliedVersion, expectedVersion, problem: null };
}

/** Arquivo só com comentários (ex.: linha de base vazia) não é enviado ao servidor. */
function hasStatements(sql: string): boolean {
  return (
    sql
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*(--|#).*$/gm, "")
      .trim().length > 0
  );
}

export async function readHistory(connection: Connection): Promise<HistoryRow[]> {
  try {
    const [rows] = await connection.query(
      `SELECT version, name, checksum, artifact, status FROM ${HISTORY_TABLE} ORDER BY version`,
    );
    return rows as HistoryRow[];
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

export interface MigrateOptions {
  appliedBy: string;
  /** Executado logo após cada versão aplicada (ex.: marcador de instância após a v1). */
  afterVersion?: (version: number, connection: Connection) => Promise<void>;
  /** Para em uma versão específica (usado em testes de atualização). */
  targetVersion?: number;
}

/**
 * Aplica as versões pendentes, uma por arquivo. MySQL faz commit implícito em DDL, então cada
 * versão é registrada como `falha` antes de executar e passa a `aplicada` só após o sucesso;
 * uma interrupção deixa `falha` e bloqueia novas versões (research.md R-04).
 */
export async function migrate(
  connection: Connection,
  loaded: LoadedManifest,
  options: MigrateOptions,
): Promise<{ applied: number[] }> {
  await connection.query(CREATE_HISTORY);
  const check = checkHistory(await readHistory(connection), loaded);
  if (check.problem) {
    throw new MigrationError(
      check.problem,
      check.message ?? check.problem,
      check.appliedVersion + 1,
    );
  }

  const target = Math.min(
    options.targetVersion ?? loaded.migrations.length,
    loaded.migrations.length,
  );
  const applied: number[] = [];
  const appliedBy = options.appliedBy.slice(0, 64);
  for (const migration of loaded.migrations.slice(check.appliedVersion, target)) {
    await connection.query(
      `INSERT INTO ${HISTORY_TABLE} (version, name, checksum, artifact, status, started_at, applied_by)
       VALUES (?, ?, ?, ?, 'falha', UTC_TIMESTAMP(6), ?)`,
      [migration.version, migration.name, migration.sha256, loaded.artifact, appliedBy],
    );
    try {
      if (hasStatements(migration.sql)) await connection.query(migration.sql);
      if (options.afterVersion) await options.afterVersion(migration.version, connection);
    } catch (error) {
      await connection
        .query(`UPDATE ${HISTORY_TABLE} SET finished_at = UTC_TIMESTAMP(6) WHERE version = ?`, [
          migration.version,
        ])
        .catch(() => undefined);
      throw new MigrationError(
        "MIGRATION_FAILED",
        `Falha ao aplicar ${loaded.artifact} v${migration.version} (${migration.name})`,
        migration.version,
        { cause: error },
      );
    }
    await connection.query(
      `UPDATE ${HISTORY_TABLE} SET status = 'aplicada', finished_at = UTC_TIMESTAMP(6) WHERE version = ?`,
      [migration.version],
    );
    applied.push(migration.version);
  }
  return { applied };
}
