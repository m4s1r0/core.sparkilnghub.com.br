// npm run check:migrations — (1) migrações publicadas na base (lib/repo.ts baseRef) são imutáveis e os manifestos
// conferem com os arquivos (FR-019); (2) server/src não contém DROP DATABASE, exceto o validador
// de artefatos (constituição IV, v1.1.1).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadManifest } from "../server/src/platform/migrations/manifest.js";
import {
  checkImmutable,
  checkNoDropDatabase,
  MIGRATION_ROOTS,
  type MigrationProblem,
} from "./lib/check-migrations.js";
import { baseRef, repoRoot } from "./lib/repo.js";

const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const rel = (path: string) => relative(repoRoot, path).replaceAll("\\", "/");

function baseFiles(): Map<string, string> | null {
  try {
    git(["rev-parse", "--verify", baseRef]);
  } catch {
    return null;
  }
  const names = git(["ls-tree", "-r", "--name-only", baseRef, "--", ...MIGRATION_ROOTS])
    .split("\n")
    .filter(Boolean);
  return new Map(names.map((name) => [name, git(["show", `${baseRef}:${name}`])]));
}

const problems: MigrationProblem[] = [];

const current = new Map(
  MIGRATION_ROOTS.flatMap((root) => walk(join(repoRoot, root))).map((path) => [
    rel(path),
    readFileSync(path, "utf8"),
  ]),
);
const base = baseFiles();
if (base === null)
  console.warn(`${baseRef} indisponível: imutabilidade não verificada (rode git fetch)`);
else problems.push(...checkImmutable(current, base));

for (const dir of [
  "server/migrations/spark_core",
  "server/migrations/spark_identity",
  "server/migrations/access_projection",
  "server/reference-product",
]) {
  try {
    await loadManifest(join(repoRoot, dir));
  } catch (error) {
    problems.push({
      code: "MIGRATION_CHANGED",
      file: `${dir}/manifest.json`,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const sources = walk(join(repoRoot, "server", "src"))
  .filter((path) => /\.(ts|js|sql)$/.test(path))
  .map((path) => ({ path: rel(path), content: readFileSync(path, "utf8") }));
problems.push(...checkNoDropDatabase(sources));

if (problems.length > 0) {
  for (const p of problems)
    console.error(`${p.file}${p.line ? `:${p.line}` : ""}: ${p.code} — ${p.message}`);
  process.exit(1);
}
console.log(
  `check:migrations ok: ${current.size} arquivo(s) de migração${base ? `, ${base.size} publicado(s) em ${baseRef}` : ""}; sem DROP DATABASE em server/src`,
);
