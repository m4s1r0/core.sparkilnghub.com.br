/**
 * CPF e CNPJ do contratante (SC-004, research.md R-13). O CNPJ aceita o formato alfanumérico da
 * Receita Federal: 12 posições `[0-9A-Z]` + 2 dígitos verificadores, calculados pelo módulo 11
 * com o valor de cada caractere = código ASCII − 48 (o que mantém o CNPJ numérico válido).
 */
export type PersonType = "fisica" | "juridica";
export type DocumentType = "cpf" | "cnpj";

export interface ValidDocument {
  type: DocumentType;
  normalized: string;
}

/** Sem pontuação nem espaços, em maiúsculas. */
export function normalizeDocument(value: string): string {
  return value.replace(/[\s./-]/g, "").toUpperCase();
}

const charValue = (char: string) => char.charCodeAt(0) - 48;

/** Dígito verificador módulo 11: resto < 2 → 0, senão 11 − resto. */
function checkDigit(body: string, weights: readonly number[]): number {
  let sum = 0;
  for (const [index, char] of [...body].entries()) sum += charValue(char) * (weights[index] ?? 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

const repeated = (value: string) => /^(.)\1+$/.test(value);

function validCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || repeated(value)) return false;
  const first = checkDigit(value.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(value.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
}

function validCnpj(value: string): boolean {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || repeated(value)) return false;
  const first = checkDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(value.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
}

/** CPF para pessoa física, CNPJ para jurídica; `null` se inválido ou do tipo errado. */
export function validateDocument(personType: PersonType, value: string): ValidDocument | null {
  const normalized = normalizeDocument(value);
  if (personType === "fisica") return validCpf(normalized) ? { type: "cpf", normalized } : null;
  return validCnpj(normalized) ? { type: "cnpj", normalized } : null;
}
