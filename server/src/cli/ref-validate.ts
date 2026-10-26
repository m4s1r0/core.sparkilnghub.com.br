import { validateArtifact } from "../platform/migrations/artifact-validator.js";
import { loadManifest } from "../platform/migrations/manifest.js";
import { referenceProductDir } from "../platform/paths.js";
import { runCli } from "./run.js";

runCli("ref:validate", async () => {
  const loaded = await loadManifest(referenceProductDir);
  validateArtifact(loaded);
  console.log(
    `ref:validate ok: ${loaded.artifact} com ${loaded.migrations.length} versão(ões), checksums conferidos`,
  );
});
