import { BootstrapRefused, bootstrapAdmin } from "../modules/identity/bootstrap.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";
import { runCli } from "./run.js";

// npm run bootstrap:admin -- <email> — convite do primeiro administrador da plataforma (FR-005,
// R-12, contracts/commands-f01.md). Permitido em todos os ambientes (em produção, executado pelo
// responsável pela implantação). Saídas: 0 com o link; 3 recusado; 1 demais falhas.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

runCli("bootstrap:admin", async () => {
  const email = process.argv[2]?.trim() ?? "";
  if (!EMAIL.test(email) || email.length > 254) {
    throw new Error("Uso: npm run bootstrap:admin -- <email>");
  }
  const config = loadConfig({ credentials: ["migrator"] });
  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, {
      role: "migrator",
      logger: createLogger({ name: "bootstrap-admin" }),
    });
    const { link, expiresAt } = await bootstrapAdmin(ctx, email);
    console.log("Convite do primeiro administrador da plataforma (exibido uma única vez):");
    console.log(link);
    console.log(
      `Válido até ${expiresAt.toISOString()}. Entregue por canal seguro; o link não pode ser consultado de novo.`,
    );
  } catch (error) {
    if (error instanceof BootstrapRefused) {
      console.error(`[bootstrap:admin] recusado: ${error.message}`);
      await pools.closeAll();
      process.exit(error.exitCode);
    }
    throw error;
  } finally {
    await pools.closeAll();
  }
});
