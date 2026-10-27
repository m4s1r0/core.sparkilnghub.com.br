/** Sufixos societários que não distinguem um contratante de outro (research.md R-13). */
const LEGAL_SUFFIXES = new Set(["ltda", "me", "epp", "eireli", "sa"]);

/**
 * Chave para alertar possíveis homônimos (SC-005): sem acentos, minúsculas, sem pontuação e sem
 * sufixos societários. Nunca vem do cliente e nunca funde cadastros.
 */
export function nameKey(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\bs\s*[/.]\s*a\b\.?/g, " sa ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1) ?? "")) words.pop();
  return words.join(" ");
}
