import { hostname } from "node:os";
import type { Connection } from "mysql2/promise";
import { EnvGuardError } from "../config/env-guard.js";
import type { Config } from "../config/load.js";
import { openAdminConnection } from "../db/pools.js";
import { migrationsDir } from "../paths.js";
import { loadManifest } from "./manifest.js";
import { migrate } from "./migrator.js";

export const CORE_DATABASES = ["spark_core", "spark_identity"] as const;
export type CoreDatabase = (typeof CORE_DATABASES)[number];

export const appliedBy = (user: string) => `${user}@${hostname()}#${process.pid}`.slice(0, 64);

/**
 * Grava o marcador na primeira migração; recusa se já existir com outro ambiente.
 * Nunca altera um marcador existente (data-model.md).
 */
async function ensureEnvironmentMarker(connection: Connection, config: Config): Promise<boolean> {
  const [rows] = await connection.query("SELECT environment FROM environment_marker WHERE id = 1");
  const current = (rows as { environment: string }[])[0]?.environment;
  if (current !== undefined) {
    if (current !== config.SPARK_ENV) {
      throw new EnvGuardError(
        `Ambiente divergente: SPARK_ENV=${config.SPARK_ENV}, marcador do banco=${current}`,
      );
    }
    return false;
  }
  await connection.query(
    "INSERT INTO environment_marker (id, environment, synthetic_data, created_at) VALUES (1, ?, ?, UTC_TIMESTAMP(6))",
    [config.SPARK_ENV, config.SPARK_ENV !== "production"],
  );
  return true;
}

export interface CoreMigrationResult {
  database: CoreDatabase;
  applied: number[];
}

/** Aplica as migrações de `spark_core` e `spark_identity` com a credencial do migrador. */
export async function migrateCoreDatabases(
  config: Config,
  databases: Readonly<Record<CoreDatabase, string>> = {
    spark_core: "spark_core",
    spark_identity: "spark_identity",
  },
): Promise<{ results: CoreMigrationResult[]; markerCreated: boolean }> {
  const results: CoreMigrationResult[] = [];
  let markerCreated = false;
  for (const database of CORE_DATABASES) {
    const loaded = await loadManifest(migrationsDir(database));
    const connection = await openAdminConnection(config, "migrator", databases[database]);
    try {
      const { applied } = await migrate(connection, loaded, {
        appliedBy: appliedBy("spark_core_migrator"),
      });
      if (database === "spark_core")
        markerCreated = await ensureEnvironmentMarker(connection, config);
      results.push({ database, applied });
    } finally {
      await connection.end();
    }
  }
  return { results, markerCreated };
}
