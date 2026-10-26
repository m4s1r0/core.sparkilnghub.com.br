// npm run check:adr — valida todas as ADRs de docs/adr/ (data-model.md) e as transições de status
// em relação à base (lib/repo.ts baseRef), quando disponível.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AdrStatus,
  type Problem,
  readAdr,
  validateAdr,
  validateTransition,
} from "./lib/adr.js";
import { baseRef, repoRoot } from "./lib/repo.js";

function statusOnMain(file: string): AdrStatus | null {
  try {
    const content = execFileSync("git", ["show", `${baseRef}:docs/adr/${file}`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return readAdr(content)?.status ?? null;
  } catch {
    return null; // arquivo novo ou base indisponível
  }
}

const dir = join(repoRoot, "docs", "adr");
const files = readdirSync(dir).filter((file) => /^\d{4}-.+\.md$/.test(file));
const problems: Problem[] = [];
const ids = new Map<string, string>();

for (const file of files) {
  const content = readFileSync(join(dir, file), "utf8");
  problems.push(...validateAdr(content, file));
  const adr = readAdr(content);
  if (adr?.id) {
    const other = ids.get(adr.id);
    if (other) {
      problems.push({
        file,
        code: "ADR_FIELD_FORBIDDEN",
        message: `id ${adr.id} repetido em ${other}`,
      });
    }
    ids.set(adr.id, file);
  }
  const previous = statusOnMain(file);
  if (previous && adr?.status) {
    const problem = validateTransition(previous, adr.status, file);
    if (problem) problems.push(problem);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`${p.file}: ${p.code} — ${p.message}`);
  console.error(`check:adr falhou: ${problems.length} problema(s) em ${files.length} ADR(s)`);
  process.exit(1);
}
console.log(`check:adr ok: ${files.length} ADR(s) válidas`);
