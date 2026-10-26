import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz do repositório (scripts/lib → ../..). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Referência publicada contra a qual migrações e ADRs são comparadas: a branch base da PR na CI
 * (`GITHUB_BASE_REF`) ou `origin/main` localmente. `BASE_REF` permite sobrescrever.
 */
export const baseRef =
  process.env.BASE_REF ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main");
