// npm run artifact:validate -- <diretório> — valida qualquer artefato de migração de produto
// (manifesto, checksums, construções proibidas), sem depender de banco ou .env
// (contracts/migration-artifact.md, contracts/commands.md).
import { resolve } from "node:path";
import { validateArtifact } from "../platform/migrations/artifact-validator.js";
import { loadManifest } from "../platform/migrations/manifest.js";
import { repoRoot } from "../platform/paths.js";
import { runCli } from "./run.js";

const dirArg = process.argv[2];
if (!dirArg) {
  console.error(
    "uso: npm run artifact:validate -- <diretório do artefato, ex.: produtos/tuteli/artifact>",
  );
  process.exit(2);
}

runCli("artifact:validate", async () => {
  const dir = resolve(repoRoot, dirArg);
  const loaded = await loadManifest(dir);
  validateArtifact(loaded);
  console.log(
    `artifact:validate ok: ${loaded.artifact} (${dirArg}) com ${loaded.migrations.length} versão(ões), checksums conferidos`,
  );
});
