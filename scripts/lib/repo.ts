import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz do repositório (scripts/lib → ../..). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
