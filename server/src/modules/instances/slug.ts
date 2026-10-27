import { readFileSync } from "node:fs";
import { reservedSlugsFile } from "../../platform/paths.js";

const PATTERN = /^[a-z][a-z0-9-]{1,61}[a-z0-9]$/;

let reserved: ReadonlySet<string> | undefined;
const reservedSlugs = () =>
  (reserved ??= new Set(
    readFileSync(reservedSlugsFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ));

/**
 * Identificador de acesso (research.md R-05): sem acentos, minúsculas, espaço e `_` viram `-`,
 * outros símbolos somem, hífens repetidos colapsam e saem das pontas.
 */
export function normalizeSlug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type SlugCheck =
  | { ok: true; slug: string }
  | { ok: false; slug: string; reason: "TAMANHO" | "FORMATO" | "RESERVADO" };

/** Normaliza e confere tamanho (3–63), formato e palavras reservadas (SC-015). */
export function checkSlug(value: string): SlugCheck {
  const slug = normalizeSlug(value);
  if (slug.length < 3 || slug.length > 63) return { ok: false, slug, reason: "TAMANHO" };
  if (!PATTERN.test(slug)) return { ok: false, slug, reason: "FORMATO" };
  if (reservedSlugs().has(slug)) return { ok: false, slug, reason: "RESERVADO" };
  return { ok: true, slug };
}
