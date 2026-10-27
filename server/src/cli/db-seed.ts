import { assertEnvironment, readEnvironmentMarker } from "../platform/config/env-guard.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { createLogger } from "../platform/logging/logger.js";
import { seedF00 } from "../../seeds/f00.js";
import { seedF01 } from "../../seeds/f01.js";
import { runCli } from "./run.js";

runCli("db:seed", async () => {
  const config = loadConfig({
    credentials: ["migrator", "provisioner", "access"],
    secrets: ["SEED_USER_PASSWORD"],
  });
  const logger = createLogger({ name: "db-seed" });
  await assertEnvironment(["development", "homologation"], "db:seed", { config, logger });
  if ((await readEnvironmentMarker(config)) === null) {
    throw new Error("environment_marker ausente: rode `npm run db:migrate` antes de `db:seed`");
  }
  const result = await seedF00(config);
  console.log(
    `db:seed ok: ${result.inserted} inserido(s), ${result.existing} já existente(s) (${result.database})`,
  );

  // F01: as sementes escrevem spark_identity/spark_core com o migrador (dono dos bancos do Core)
  // e a projeção de acesso com o escritor dedicado.
  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, { role: "migrator", logger });
    const f01 = await seedF01(ctx, config, config.secrets.SEED_USER_PASSWORD ?? "");
    console.log(
      `db:seed F01: ${f01.instances} instância(s) sintética(s); contas ${f01.accounts.created} criada(s), ` +
        `${f01.accounts.existing} existente(s); vínculos ${f01.memberships.created} criado(s), ` +
        `${f01.memberships.existing} existente(s)`,
    );
    if (f01.appCredential) {
      console.log(
        "Credencial de aplicação do sparkref (exibida uma única vez; guarde no .env local):",
      );
      console.log(`SPARKREF_APP_CREDENTIAL=${f01.appCredential}`);
    }
  } finally {
    await pools.closeAll();
  }
});
