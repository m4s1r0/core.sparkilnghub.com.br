import { sql } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { instanceAccountOf, syncOperationalGrants } from "../../platform/db/grants.js";
import { openAdminConnection } from "../../platform/db/pools.js";
import { binToUuid, instanceUserName } from "../../platform/ids.js";
import {
  accessDatabaseName,
  grantAccessProjection,
} from "../../platform/migrations/apply-artifact.js";
import { type LoadedManifest, loadManifest } from "../../platform/migrations/manifest.js";
import { PROVISIONERS, type ProvisionerRegistry } from "../catalog/provisioners.js";
import type { InstanceState } from "../instances/instances.js";

/** Estados em que a credencial operacional ainda não existe. */
const NO_CREDENTIAL: ReadonlySet<InstanceState> = new Set([
  "CADASTRADA",
  "PROVISIONANDO",
  "FALHA_PROVISIONAMENTO",
]);

export interface GrantsSyncReport {
  updated: { slug: string; appendOnly: string[] }[];
  skipped: string[];
  unreachable: { slug: string; code: string }[];
}

/**
 * Reaplica os privilégios da credencial operacional em todas as instâncias existentes (SEC-12,
 * SEC-15): DML por tabela, só INSERT nas só-inserção declaradas no artefato vigente do produto,
 * leitura nas internas, leitura+logout na projeção e `REQUIRE SSL` quando o TLS está ligado.
 * Idempotente; usado por `npm run instances:sync-grants` depois de implantar o Core endurecido.
 */
export async function syncAllOperationalGrants(
  ctx: AppContext,
  config: Config,
  registry: ProvisionerRegistry = PROVISIONERS,
): Promise<GrantsSyncReport> {
  const { rows } = await sql<{
    id: Buffer;
    slug: string;
    state: InstanceState;
    product_code: string;
    database_name: string;
  }>`SELECT id, slug, state, product_code, database_name FROM instance ORDER BY created_at`.execute(
    ctx.core,
  );
  const manifests = new Map<string, LoadedManifest | null>();
  const report: GrantsSyncReport = { updated: [], skipped: [], unreachable: [] };
  for (const row of rows) {
    const def = registry[row.product_code];
    if (NO_CREDENTIAL.has(row.state) || !def) {
      report.skipped.push(row.slug);
      continue;
    }
    if (!manifests.has(row.product_code)) {
      manifests.set(row.product_code, await loadManifest(def.artifactDir).catch(() => null));
    }
    const manifest = manifests.get(row.product_code);
    if (!manifest) {
      report.unreachable.push({ slug: row.slug, code: "ARTEFATO_ILEGIVEL" });
      continue;
    }
    const user = instanceUserName(binToUuid(row.id));
    const { account, requireTls } = instanceAccountOf(config, user);
    let admin;
    try {
      admin = await openAdminConnection(config, "provisioner");
    } catch (error) {
      report.unreachable.push({
        slug: row.slug,
        code: (error as { code?: string }).code ?? "ERRO",
      });
      continue;
    }
    try {
      const result = await syncOperationalGrants(admin, {
        database: row.database_name,
        account,
        appendOnlyTables: manifest.manifest.appendOnlyTables ?? [],
        requireTls,
      });
      await grantAccessProjection(
        admin,
        accessDatabaseName(row.database_name),
        user,
        config.INSTANCE_DB_USER_HOST,
      );
      report.updated.push({ slug: row.slug, appendOnly: result.appendOnly });
    } catch (error) {
      report.unreachable.push({
        slug: row.slug,
        code: (error as { code?: string }).code ?? "ERRO",
      });
    } finally {
      await admin.end();
    }
  }
  return report;
}
