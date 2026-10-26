import { assertEnvironment, readEnvironmentMarker } from "../platform/config/env-guard.js";
import { loadConfig } from "../platform/config/load.js";
import { createLogger } from "../platform/logging/logger.js";
import { seedF00 } from "../../seeds/f00.js";
import { runCli } from "./run.js";

runCli("db:seed", async () => {
  const config = loadConfig({ credentials: ["migrator", "provisioner"] });
  const logger = createLogger({ name: "db-seed" });
  await assertEnvironment(["development", "homologation"], "db:seed", { config, logger });
  if ((await readEnvironmentMarker(config)) === null) {
    throw new Error("environment_marker ausente: rode `npm run db:migrate` antes de `db:seed`");
  }
  const result = await seedF00(config);
  console.log(
    `db:seed ok: ${result.inserted} inserido(s), ${result.existing} já existente(s) (${result.database})`,
  );
});
