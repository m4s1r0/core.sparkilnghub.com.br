// npm run verify — as mesmas etapas da CI, em sequência; para na primeira falha indicando a etapa
// (FR-017, FR-018, FR-020). Cobertura percentual não é critério (US3 cenário 6).
import { spawnSync } from "node:child_process";
import { spawnArgs } from "./lib/dev.js";
import { repoRoot } from "./lib/repo.js";

export const STEPS = [
  "typecheck",
  "lint",
  "format:check",
  "test:scripts",
  "check:adr",
  "gate",
  "check:ds",
  "check:secrets",
  "check:migrations",
  "ref:validate",
  "test:unit",
  "test:component",
  "test:integration",
  "check:upgrade",
  "test:contract",
  "test:e2e",
] as const;

const started = Date.now();
for (const [index, step] of STEPS.entries()) {
  const t0 = Date.now();
  console.log(`\n▶ [${index + 1}/${STEPS.length}] ${step}`);
  const [cmd, argv, shell] = spawnArgs("npm", ["run", "-s", step]);
  const result = spawnSync(cmd, argv, { cwd: repoRoot, stdio: "inherit", ...shell });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.status !== 0) {
    console.error(`\n✖ verify falhou na etapa "${step}" (${seconds}s, saída ${result.status}).`);
    process.exit(1);
  }
  console.log(`✔ ${step} (${seconds}s)`);
}
console.log(
  `\n✔ verify ok: ${STEPS.length} etapas em ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
