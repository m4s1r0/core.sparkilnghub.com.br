import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Algorithm, hash, verify } from "@node-rs/argon2";
import { assetsDir } from "../../platform/paths.js";
import { normalizeEmail } from "./email.js";

/** Perfil mínimo da OWASP para Argon2id (research.md R-01). */
// `Algorithm` é const enum ambiente (inacessível com verbatimModuleSyntax): 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;
const PARAMS = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** Sobe quando PARAMS muda; a senha é refeita no próximo login bem-sucedido. */
export const PASSWORD_PARAMS_VERSION = 1;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export type PasswordProblem =
  "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "PASSWORD_COMMON" | "PASSWORD_MATCHES_IDENTITY";

let common: Set<string> | undefined;

/** Lista local de senhas comuns (server/assets/ORIGEM.md), carregada uma vez. */
function commonPasswords(): Set<string> {
  common ??= new Set(
    readFileSync(join(assetsDir, "common-passwords.txt"), "utf8")
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
  return common;
}

/**
 * Política de senha (FR-003, R-02): 12 a 128 caracteres, fora da lista comum e diferente do
 * e-mail e do nome de exibição. Sem regras de composição nem troca periódica.
 */
export function checkPasswordPolicy(
  password: string,
  identity: { email: string; displayName: string },
): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "PASSWORD_TOO_SHORT";
  if (length > PASSWORD_MAX) return "PASSWORD_TOO_LONG";
  const lower = password.trim().toLowerCase();
  if (commonPasswords().has(lower)) return "PASSWORD_COMMON";
  if (
    lower === normalizeEmail(identity.email) ||
    lower === identity.displayName.trim().toLowerCase()
  )
    return "PASSWORD_MATCHES_IDENTITY";
  return null;
}

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  PASSWORD_TOO_SHORT: `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`,
  PASSWORD_TOO_LONG: `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`,
  PASSWORD_COMMON: "Essa senha é comum demais. Escolha outra.",
  PASSWORD_MATCHES_IDENTITY: "A senha não pode ser igual ao seu e-mail ou nome.",
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, PARAMS);
}

/** `false` também para hash malformado: nunca lança para o fluxo de login. */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

export function needsRehash(paramsVersion: number): boolean {
  return paramsVersion !== PASSWORD_PARAMS_VERSION;
}

/**
 * Hash fixo para gastar o mesmo tempo quando a conta não existe: a resposta e a duração do login
 * não revelam se o e-mail está cadastrado (FR-004).
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("conta-inexistente-sparkcore");
  await verifyPassword(await dummyHash, password);
}
