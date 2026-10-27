import { createHmac, randomBytes, randomInt } from "node:crypto";
import { sha256Hex } from "../../platform/crypto/index.js";

const PERIOD_MS = 30_000;
const DIGITS = 6;
const WINDOW = 1;
const ISSUER = "SparkCore";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new TypeError("Base32 inválido");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo TOTP de 160 bits (tamanho do HMAC-SHA1, RFC 4226 §4). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/** HOTP (RFC 4226) com truncamento dinâmico. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Código TOTP (RFC 6238) no instante `timeMs`, passo de 30 s. */
export function totpCode(secret: Buffer, timeMs: number, digits = DIGITS): string {
  return hotp(secret, Math.floor(timeMs / PERIOD_MS), digits);
}

export type TotpResult = { ok: true; step: number } | { ok: false };

/**
 * Aceita o passo atual e um passo antes ou depois (relógio do celular, ±30 s). Passo igual ou
 * anterior ao último aceito é recusado: um código não serve duas vezes.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  timeMs: number,
  lastStep: number | null,
): TotpResult {
  if (!/^[0-9]{6}$/.test(code)) return { ok: false };
  const current = Math.floor(timeMs / PERIOD_MS);
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    if (hotp(secret, step, DIGITS) === code) return { ok: true, step };
  }
  return { ok: false };
}

export function otpauthUri(secret: Buffer, email: string): string {
  const label = `${ISSUER}:${encodeURIComponent(email)}`;
  const params = `secret=${base32Encode(secret)}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=30`;
  return `otpauth://totp/${label}?${params}`;
}

/** Dez códigos de uso único, 10 caracteres base32 (50 bits cada). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(Array.from({ length: 10 }, () => BASE32[randomInt(32)]).join(""));
  }
  return [...codes];
}

export function hashRecoveryCode(code: string): string {
  return sha256Hex(code.trim().toUpperCase());
}
