import { migrateAccessProjections } from "../modules/access-projection/upgrade.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";

// npm run instances:migrate-access — aplica a versão vigente da projeção de acesso em todas as
// instâncias registradas (F02 contracts/commands-f02.md). Saídas: 0 todas atualizadas; 4 alguma
// inacessível (as demais são atualizadas); 1 demais falhas.
async function main(): Promise<number> {
  const config = loadConfig({ credentials: ["migrator", "provisioner"] });
  const pools = new PoolRegistry(config);
  const ctx = createAppContext(config, pools, {
    role: "migrator",
    logger: createLogger({ name: "instances-migrate-access" }),
  });
  try {
    const report = await migrateAccessProjections(ctx, config);
    for (const { slug, applied } of report.updated) {
      console.log(`${slug}: projeção atualizada (versões ${applied.join(", ")})`);
    }
    console.log(
      `instances:migrate-access: ${report.updated.length} atualizada(s), ` +
        `${report.current.length} já na versão vigente, ${report.skipped.length} ainda sem banco`,
    );
    for (const { slug, code } of report.unreachable) {
      console.error(`${slug}: banco de acesso inacessível (${code})`);
    }
    return report.unreachable.length > 0 ? 4 : 0;
  } finally {
    await pools.closeAll();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[instances:migrate-access] falha: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
