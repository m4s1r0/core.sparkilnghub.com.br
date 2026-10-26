// npm run check:secrets — gitleaks (imagem com versão fixada) sobre a árvore de trabalho, com as
// mesmas regras da CI (.gitleaks.toml). Exige Docker.
import { run } from "./lib/dev.js";
import { repoRoot } from "./lib/repo.js";

export const GITLEAKS_IMAGE = "zricethezav/gitleaks:v8.24.2";

run("docker", [
  "run",
  "--rm",
  "-v",
  `${repoRoot}:/repo`,
  GITLEAKS_IMAGE,
  "dir",
  "/repo",
  "--config",
  "/repo/.gitleaks.toml",
  "--redact",
  "--no-banner",
]).then(
  () => console.log("check:secrets ok: nenhum segredo encontrado"),
  () => {
    console.error(
      "check:secrets falhou: segredo encontrado (ver arquivo e linha acima) ou Docker indisponível",
    );
    process.exit(1);
  },
);
