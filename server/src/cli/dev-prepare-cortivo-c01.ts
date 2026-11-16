import {
  assertEnvironment,
  EnvGuardError,
  readEnvironmentMarker,
} from "../platform/config/env-guard.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";
import { seedCortivoC01 } from "../../seeds/cortivo-c01.js";
import { runCli } from "./run.js";

runCli("dev:prepare-cortivo-c01", async () => {
  const config = loadConfig({
    credentials: ["migrator", "provisioner", "access"],
    secrets: ["SEED_USER_PASSWORD", "INSTANCE_SECRET_KEY"],
  });
  const logger = createLogger({ name: "dev-prepare-cortivo-c01" });
  await assertEnvironment(["development"], "dev:prepare-cortivo-c01", { config, logger });
  const marker = await readEnvironmentMarker(config);
  if (marker !== "development") {
    logger.warn(
      { event: "env_guard_refused", command: "dev:prepare-cortivo-c01", marker },
      "Preparação C01 exige marcador de banco development",
    );
    throw new EnvGuardError("Preparação C01 exige que o banco esteja marcado como development");
  }
  const seedPassword = config.secrets.SEED_USER_PASSWORD;
  if (!seedPassword) throw new Error("Defina SEED_USER_PASSWORD para as contas sintéticas C01");

  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, { role: "migrator", logger });
    const result = await seedCortivoC01(ctx, config, seedPassword);
    console.log(
      `C01 preparado: ${result.instances.map((instance) => `${instance.slug}=${instance.state}`).join(", ")}; ` +
        `contas ${result.accounts.created} criada(s), ${result.accounts.existing} existente(s); ` +
        `vínculos ${result.memberships.created} criado(s), ${result.memberships.existing} existente(s).`,
    );
    for (const credential of result.credentials) {
      if (!credential.value) {
        console.log(
          `Credencial de ${credential.slug} já existente; segredo não pode ser recuperado e não foi reemitido.`,
        );
        continue;
      }
      console.log(
        `Credencial ${credential.slug} (exibida uma única vez; guarde em configuração local):`,
      );
      const instanceKey = credential.slug.replace(/^cortivo-/, "").toUpperCase();
      console.log(`CORTIVO_${instanceKey}_APP_CREDENTIAL=${credential.value}`);
    }
  } finally {
    await pools.closeAll();
  }
});
