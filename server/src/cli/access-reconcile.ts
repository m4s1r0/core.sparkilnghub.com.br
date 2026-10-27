import { sql } from "kysely";
import { reconcileInstance } from "../modules/access-projection/reconcile.js";
import { getInstance } from "../modules/instances/instances.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { binToUuid } from "../platform/ids.js";
import { createLogger } from "../platform/logging/logger.js";

// npm run access:reconcile -- <slug> — recalcula a projeção de acesso de uma instância a partir
// de spark_identity (FR-033, contracts/commands-f01.md). Saídas: 0 ok; 2 instância inexistente
// ou ambígua; 4 banco de acesso inacessível; 1 demais falhas.
async function main(): Promise<number> {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Uso: npm run access:reconcile -- <slug>");
    return 1;
  }
  const config = loadConfig({ credentials: ["web", "access"] });
  const pools = new PoolRegistry(config);
  const ctx = createAppContext(config, pools, {
    logger: createLogger({ name: "access-reconcile" }),
  });
  try {
    const { rows } = await sql<{
      id: Buffer;
    }>`SELECT id FROM instance WHERE slug = ${slug}`.execute(ctx.core);
    if (rows.length !== 1 || !rows[0]) {
      console.error(
        rows.length === 0
          ? `Instância "${slug}" não encontrada.`
          : `Slug "${slug}" existe em mais de um produto.`,
      );
      return 2;
    }
    const instance = await getInstance(ctx, binToUuid(rows[0].id));
    if (!instance) return 2;
    try {
      const { divergences } = await reconcileInstance(ctx, instance);
      console.log(
        divergences === 0
          ? `access:reconcile ok: ${slug} sem divergência`
          : `access:reconcile ok: ${slug} — ${divergences} divergência(s) corrigida(s)`,
      );
      return 0;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (/ACCESS_DENIED|ECONNREFUSED|ER_BAD_DB_ERROR|ETIMEDOUT/.test(code)) {
        console.error(`Banco de acesso de "${slug}" inacessível (${code}).`);
        return 4;
      }
      throw error;
    }
  } finally {
    await pools.closeAll();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[access:reconcile] falha: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
