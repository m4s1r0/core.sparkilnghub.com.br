import { loadConfig } from "../platform/config/load.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";
import { join } from "node:path";
import { repoRoot } from "../platform/paths.js";
import { buildApp } from "./build-app.js";
import { registerModules } from "./modules.js";

const logger = createLogger({ name: "app" });

async function main() {
  const config = loadConfig({
    credentials: ["web", "access"],
    secrets: ["IDENTITY_SECRET_KEY", "INSTANCE_SECRET_KEY"],
  });
  const pools = new PoolRegistry(config);
  const app = await buildApp({
    config,
    logger,
    webRoot: join(repoRoot, "web", "dist"),
    register: (instance) => registerModules(instance, { config, pools }),
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Encerrando servidor");
    await app.close();
    await pools.closeAll();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT });
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Falha ao iniciar o servidor");
  process.exit(1);
});
