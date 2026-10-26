import type { Config } from "../src/platform/config/load.js";
import { openAdminConnection } from "../src/platform/db/pools.js";
import { applyArtifact } from "../src/platform/migrations/apply-artifact.js";
import { loadManifest } from "../src/platform/migrations/manifest.js";
import { referenceProductDir } from "../src/platform/paths.js";

/** UUID fixo da semente: a instância de referência sintética é sempre a mesma (idempotência). */
export const SEED_REFERENCE_INSTANCE = "0192f600-0000-7000-8000-000000000f00";

export const SYNTHETIC_PREFIX = "[SINTÉTICO]";

export interface SeedResult {
  inserted: number;
  existing: number;
  database: string;
}

/**
 * Dados sintéticos de F00 (US7, NFR-016): o marcador de ambiente (gravado pelo `db:migrate`) e
 * uma instância do produto de referência com um item marcado como fictício. Idempotente.
 */
export async function seedF00(config: Config): Promise<SeedResult> {
  const loaded = await loadManifest(referenceProductDir);
  const instance = await applyArtifact(config, loaded, {
    instanceUuid: SEED_REFERENCE_INSTANCE,
    synthetic: true,
  });

  const connection = await openAdminConnection(config, "provisioner", instance.database);
  let itemInserted = false;
  try {
    const [rows] = await connection.query("SELECT COUNT(*) AS total FROM ref_item");
    if (Number((rows as { total: number }[])[0]?.total ?? 0) === 0) {
      await connection.query(
        "INSERT INTO ref_item (label, created_at) VALUES (?, UTC_TIMESTAMP(6))",
        [`${SYNTHETIC_PREFIX} Item do produto de referência`],
      );
      itemInserted = true;
    }
  } finally {
    await connection.end();
  }

  const inserted = (instance.created ? 1 : 0) + (itemInserted ? 1 : 0);
  return { inserted, existing: 2 - inserted, database: instance.database };
}
