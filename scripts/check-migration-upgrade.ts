// npm run check:upgrade — migra a partir da versão publicada na base (lib/repo.ts baseRef) e compara com a
// migração do zero (FR-017, CS-005, constituição V). Usa o apoio dos testes (bancos t_<runid>_*,
// guarda de ambiente). Sem migrações na base: "sem versão anterior", saída 0.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EnvGuardError } from "../server/src/platform/config/env-guard.js";
import { MysqlTestContext } from "../server/tests/support/mysql.js";
import { baseRef, repoRoot } from "./lib/repo.js";
import { checkUpgradePath, loadManifest } from "./lib/upgrade.js";

const git = (args: string[]) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

/** Extrai server/migrations/<db> da base para uma pasta temporária; null se não houver. */
function extractBase(database: string, target: string): string | null {
  try {
    git(["rev-parse", "--verify", baseRef]);
  } catch {
    return null;
  }
  const prefix = `server/migrations/${database}/`;
  const files = git(["ls-tree", "-r", "--name-only", baseRef, "--", prefix])
    .split("\n")
    .filter(Boolean);
  if (!files.includes(`${prefix}manifest.json`)) return null;
  const dir = join(target, database);
  for (const file of files) {
    const path = join(dir, file.slice(prefix.length));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, git(["show", `${baseRef}:${file}`]));
  }
  return dir;
}

async function main() {
  const ctx = await MysqlTestContext.create();
  const temp = mkdtempSync(join(tmpdir(), "sparkcore-upgrade-"));
  let failed = false;
  try {
    for (const database of ["spark_core", "spark_identity", "access_projection"]) {
      const baseDir = extractBase(database, temp);
      const current = await loadManifest(join(repoRoot, "server", "migrations", database));
      const base = baseDir ? await loadManifest(baseDir) : null;
      const result = await checkUpgradePath(ctx, database, base, current);
      if (!base) {
        console.log(`${database}: sem versão anterior em ${baseRef} (passa trivialmente)`);
      } else if (result.differences.length > 0) {
        failed = true;
        console.error(
          `${database}: v${result.baseVersions}→v${result.currentVersions} difere da migração do zero nas tabelas: ${result.differences.join(", ")}`,
        );
      } else {
        console.log(
          `${database}: v${result.baseVersions}→v${result.currentVersions} igual à migração do zero`,
        );
      }
    }
  } finally {
    await ctx.cleanup();
    rmSync(temp, { recursive: true, force: true });
  }
  if (failed) process.exit(1);
  console.log("check:upgrade ok");
}

main().catch((error: unknown) => {
  if (error instanceof EnvGuardError) {
    console.error(`check:upgrade recusado: ${error.message}`);
    process.exit(error.exitCode);
  }
  console.error(`check:upgrade falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
