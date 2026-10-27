import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  KeyRing,
  randomToken,
  sha256Hex,
  timingSafeEqualHex,
} from "../../../src/platform/crypto/index.js";

const key = (fill: number) => Buffer.alloc(32, fill);

describe("tokens e resumos", () => {
  it("token de 32 bytes em base64url, distinto a cada chamada", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("sha256 em hexadecimal", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("comparação de hex em tempo constante, falsa para tamanhos diferentes", () => {
    expect(timingSafeEqualHex("ab".repeat(32), "ab".repeat(32))).toBe(true);
    expect(timingSafeEqualHex("ab".repeat(32), "ac".repeat(32))).toBe(false);
    expect(timingSafeEqualHex("ab", "abcd")).toBe(false);
  });
});

describe("AES-256-GCM com versão de chave", () => {
  const ring = new KeyRing(1, key(1));
  const aad = Buffer.from("conta-1");

  it("cifra e decifra; iv aleatório gera cifras diferentes", () => {
    const plain = Buffer.from("segredo-totp-20-bytes");
    const a = encryptSecret(ring, plain, aad);
    const b = encryptSecret(ring, plain, aad);
    expect(a.keyVersion).toBe(1);
    expect(a.data.equals(b.data)).toBe(false);
    expect(a.data.length).toBe(12 + 16 + plain.length);
    expect(decryptSecret(ring, a.data, a.keyVersion, aad).equals(plain)).toBe(true);
  });

  it("falha com tag adulterada, dado associado diferente ou versão desconhecida", () => {
    const { data, keyVersion } = encryptSecret(ring, Buffer.from("x"), aad);
    const tampered = Buffer.from(data);
    tampered[13] = (tampered[13] ?? 0) ^ 0xff;
    expect(() => decryptSecret(ring, tampered, keyVersion, aad)).toThrow();
    expect(() => decryptSecret(ring, data, keyVersion, Buffer.from("conta-2"))).toThrow();
    expect(() => decryptSecret(ring, data, 2, aad)).toThrow(/versão de chave/);
  });

  it("decifra com a chave anterior durante a rotação", () => {
    const old = new KeyRing(1, key(1));
    const { data } = encryptSecret(old, Buffer.from("antigo"), aad);
    const rotated = new KeyRing(2, key(2), new Map([[1, key(1)]]));
    expect(decryptSecret(rotated, data, 1, aad).toString()).toBe("antigo");
    expect(encryptSecret(rotated, Buffer.from("novo"), aad).keyVersion).toBe(2);
  });

  it("recusa chave que não tem 32 bytes", () => {
    expect(() => new KeyRing(1, Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});
