import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "../../../src/modules/identity/totp.js";

// RFC 6238, apêndice B: segredo ASCII "12345678901234567890", HMAC-SHA1, 8 dígitos.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_VECTORS: [seconds: number, code: string][] = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP RFC 6238", () => {
  it.each(RFC_VECTORS)("vetor T=%i", (seconds, expected) => {
    expect(totpCode(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
    // 6 dígitos = mesmo truncamento dinâmico módulo 10^6 (RFC 4226 §5.3).
    expect(totpCode(RFC_SECRET, seconds * 1000)).toBe(expected.slice(2));
  });

  const now = 1_800_000_000_000;
  const step = Math.floor(now / 30_000);
  const secret = generateTotpSecret();

  it("aceita o passo atual e ±1 passo; recusa ±2", () => {
    expect(verifyTotp(secret, totpCode(secret, now), now, null)).toEqual({ ok: true, step });
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now, null)).toEqual({
      ok: true,
      step: step - 1,
    });
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now, null)).toEqual({
      ok: true,
      step: step + 1,
    });
    expect(verifyTotp(secret, totpCode(secret, now - 60_000), now, null).ok).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, now + 60_000), now, null).ok).toBe(false);
  });

  it("recusa reuso do mesmo passo e passos anteriores ao último aceito", () => {
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, now, step).ok).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now, step).ok).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now, step).ok).toBe(true);
  });

  it("recusa formato inválido", () => {
    expect(verifyTotp(secret, "12345", now, null).ok).toBe(false);
    expect(verifyTotp(secret, "abcdef", now, null).ok).toBe(false);
  });

  it("segredo de 20 bytes e base32 ida e volta", () => {
    expect(secret).toHaveLength(20);
    const text = base32Encode(secret);
    expect(text).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(text).equals(secret)).toBe(true);
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("URI otpauth com emissor SparkCore", () => {
    const uri = otpauthUri(Buffer.from("12345678901234567890"), "ana+x@example.test");
    expect(uri).toBe(
      "otpauth://totp/SparkCore:ana%2Bx%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=SparkCore&algorithm=SHA1&digits=6&period=30",
    );
  });
});

describe("códigos de recuperação", () => {
  it("dez códigos distintos de 10 caracteres base32, resumo sha256 sem distinguir caixa", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{10}$/);
    const first = codes[0] ?? "";
    expect(hashRecoveryCode(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(first.toLowerCase())).toBe(hashRecoveryCode(first));
  });
});
