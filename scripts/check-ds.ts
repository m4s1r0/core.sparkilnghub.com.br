// npm run check:ds — consumo do design system apenas pela API pública (princípio VIII, FR-025) e
// registro de cada versão em docs/design-system-updates.md.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkSources, checkVendor } from "./lib/check-ds.js";
import { repoRoot } from "./lib/repo.js";

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const sources = walk(join(repoRoot, "web", "src"))
  .filter((path) => /\.(css|tsx?|jsx?)$/.test(path))
  .map((path) => ({
    path: relative(repoRoot, path).replaceAll("\\", "/"),
    content: readFileSync(path, "utf8"),
  }));

const vendorDir = join(repoRoot, "vendor", "design-system");
const packages = walk(vendorDir)
  .filter((path) => path.endsWith(".tgz"))
  .map((path) => ({
    file: relative(repoRoot, path).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  }));
const updatesPath = join(repoRoot, "docs", "design-system-updates.md");
const updates = existsSync(updatesPath) ? readFileSync(updatesPath, "utf8") : "";

const problems = [...checkSources(sources), ...checkVendor(packages, updates)];
if (problems.length > 0) {
  for (const p of problems) console.error(`${p.file}: ${p.code} — ${p.message}`);
  process.exit(1);
}
console.log(
  `check:ds ok: ${sources.length} arquivo(s) da interface, ${packages.length} pacote(s) registrados`,
);
