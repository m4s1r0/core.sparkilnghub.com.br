// npx tsx scripts/e2e-invite.ts <email> — apoio dos testes E2E: cria convite de administrador da
// plataforma e imprime só o token. Ferramenta de desenvolvimento/CI fora do artefato de produção;
// recusa fora de development (constituição IV). Em produção o primeiro acesso é o bootstrap.
import { createPlatformInvitation } from "../server/src/modules/identity/invitations.js";
import { assertEnvironment, EnvGuardError } from "../server/src/platform/config/env-guard.js";
import { loadConfig } from "../server/src/platform/config/load.js";
import { createAppContext } from "../server/src/platform/context.js";
import { PoolRegistry } from "../server/src/platform/db/pools.js";
import { createLogger } from "../server/src/platform/logging/logger.js";

async function main() {
  const email = process.argv[2];
  if (!email?.endsWith("@example.test")) throw new Error("Uso: e2e-invite <conta>@example.test");
  const config = loadConfig({ credentials: ["migrator"] });
  const logger = createLogger({ name: "e2e-invite", level: "warn" });
  await assertEnvironment(["development"], "e2e-invite", { config, logger });
  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, { role: "migrator", logger });
    const { token } = await createPlatformInvitation(ctx, { email, createdBy: null });
    process.stdout.write(token);
  } finally {
    await pools.closeAll();
  }
}

main().catch((error: unknown) => {
  console.error(`e2e-invite: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(error instanceof EnvGuardError ? error.exitCode : 1);
});
