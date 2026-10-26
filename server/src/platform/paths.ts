import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findUp(start: string, predicate: (dir: string) => boolean): string {
  let dir = start;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Diretório não encontrado a partir de ${start}`);
    dir = parent;
  }
}

function packageName(dir: string): string | undefined {
  const file = join(dir, "package.json");
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, "utf8")) as { name?: string }).name;
}

const here = dirname(fileURLToPath(import.meta.url));

/** Raiz do pacote `@sparkcore/server`, tanto em `src/` (tsx) quanto em `dist/src/` (build). */
export const serverRoot = findUp(here, (dir) => packageName(dir) === "@sparkcore/server");

/** Raiz do repositório (workspace `sparkcore`). */
export const repoRoot = findUp(
  resolve(serverRoot, ".."),
  (dir) => packageName(dir) === "sparkcore",
);

export const migrationsDir = (artifact: "spark_core" | "spark_identity") =>
  join(serverRoot, "migrations", artifact);

export const referenceProductDir = join(serverRoot, "reference-product");
