import { syncAllOperationalGrants } from "../modules/provisioning/grants-sync.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";

// npm run instances:sync-grants — reaplica os privilégios da credencial operacional de todas as
// instâncias (SEC-12 tabelas só-inserção, SEC-15 REQUIRE SSL e host). Rodar uma vez depois de
// implantar o Core endurecido e sempre que um artefato passar a declarar tabela só-inserção.
// Saídas: 0 todas atualizadas; 4 alguma inacessível (as demais são atualizadas); 1 demais falhas.
async function main(): Promise<number> {
  const config = loadConfig({ credentials: ["migrator", "provisioner"] });
  const pools = new PoolRegistry(config);
  const ctx = createAppContext(config, pools, {
    role: "migrator",
    logger: createLogger({ name: "instances-sync-grants" }),
  });
  try {
    const report = await syncAllOperationalGrants(ctx, config);
    for (const { slug, appendOnly } of report.updated) {
      console.log(
        `${slug}: privilégios sincronizados` +
          (appendOnly.length ? ` (só-inserção: ${appendOnly.join(", ")})` : ""),
      );
    }
    console.log(
      `instances:sync-grants: ${report.updated.length} atualizada(s), ` +
        `${report.skipped.length} sem credencial operacional`,
    );
    for (const { slug, code } of report.unreachable) console.error(`${slug}: falhou (${code})`);
    return report.unreachable.length > 0 ? 4 : 0;
  } finally {
    await pools.closeAll();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[instances:sync-grants] falha: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
