import { sql } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { openAdminConnection } from "../../platform/db/pools.js";
import { ACCESS_HISTORY_TABLE } from "../../platform/migrations/apply-artifact.js";
import { appliedBy } from "../../platform/migrations/core-migrations.js";
import { loadManifest } from "../../platform/migrations/manifest.js";
import { migrate } from "../../platform/migrations/migrator.js";
import { accessProjectionDir } from "../../platform/paths.js";
import type { InstanceState } from "../instances/instances.js";

/** Estados em que o banco de acesso ainda pode não existir (o provisionamento o cria). */
const NOT_YET_CREATED: ReadonlySet<InstanceState> = new Set([
  "CADASTRADA",
  "PROVISIONANDO",
  "FALHA_PROVISIONAMENTO",
]);

export interface AccessUpgradeReport {
  updated: { slug: string; applied: number[] }[];
  current: string[];
  skipped: string[];
  unreachable: { slug: string; code: string }[];
}

/**
 * Aplica a versão vigente da projeção de acesso em todas as instâncias registradas
 * (`npm run instances:migrate-access`, F02 access-projection-v2.md), com a credencial do
 * provisionador. Banco inacessível é listado e não impede as demais.
 */
export async function migrateAccessProjections(
  ctx: AppContext,
  config: Config,
): Promise<AccessUpgradeReport> {
  const manifest = await loadManifest(accessProjectionDir);
  const { rows } = await sql<{
    slug: string;
    state: InstanceState;
    access_database_name: string;
  }>`SELECT slug, state, access_database_name FROM instance ORDER BY created_at`.execute(ctx.core);
  const report: AccessUpgradeReport = { updated: [], current: [], skipped: [], unreachable: [] };
  for (const row of rows) {
    let connection;
    try {
      connection = await openAdminConnection(config, "provisioner", row.access_database_name);
    } catch (error) {
      const code = (error as { code?: string }).code ?? "ERRO";
      if (code === "ER_BAD_DB_ERROR" && NOT_YET_CREATED.has(row.state)) {
        report.skipped.push(row.slug);
      } else {
        report.unreachable.push({ slug: row.slug, code });
      }
      continue;
    }
    try {
      const { applied } = await migrate(connection, manifest, {
        appliedBy: appliedBy("spark_provisioner"),
        historyTable: ACCESS_HISTORY_TABLE,
      });
      if (applied.length > 0) report.updated.push({ slug: row.slug, applied });
      else report.current.push(row.slug);
    } catch (error) {
      report.unreachable.push({
        slug: row.slug,
        code: (error as { code?: string }).code ?? "ERRO",
      });
    } finally {
      await connection.end();
    }
  }
  return report;
}
