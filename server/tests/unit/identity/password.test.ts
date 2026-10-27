import { describe, expect, it } from "vitest";
import { maskEmail, normalizeEmail } from "../../../src/modules/identity/email.js";
import {
  checkPasswordPolicy,
  hashPassword,
  needsRehash,
  PASSWORD_PARAMS_VERSION,
  verifyPassword,
} from "../../../src/modules/identity/password.js";

const identity = { email: "ana.souza+painel@example.test", displayName: "Ana Souza" };

describe("política de senha (FR-003, R-02)", () => {
  it("aceita 12+ caracteres fora da lista comum, sem regra de composição", () => {
    expect(checkPasswordPolicy("cavalo bateria grampo", identity)).toBeNull();
  });

  it("recusa curta, longa, comum (sem distinguir caixa) e igual ao e-mail ou ao nome", () => {
    expect(checkPasswordPolicy("curta123", identity)).toBe("PASSWORD_TOO_SHORT");
    expect(checkPasswordPolicy("x".repeat(129), identity)).toBe("PASSWORD_TOO_LONG");
    // Entradas da lista com 12+ caracteres (a maioria da lista é mais curta que o mínimo).
    expect(checkPasswordPolicy("Unbelievable", identity)).toBe("PASSWORD_COMMON");
    expect(checkPasswordPolicy("SCANDINAVIAN", identity)).toBe("PASSWORD_COMMON");
    expect(checkPasswordPolicy("1234567890ab", identity)).toBeNull();
    expect(checkPasswordPolicy("ANA.SOUZA+PAINEL@example.test", identity)).toBe(
      "PASSWORD_MATCHES_IDENTITY",
    );
    expect(
      checkPasswordPolicy("Ana Souza Ana", { ...identity, displayName: "Ana Souza Ana" }),
    ).toBe("PASSWORD_MATCHES_IDENTITY");
  });

  it("conta caracteres, não bytes", () => {
    expect(checkPasswordPolicy("çãéíõúàâêôü1", identity)).toBeNull();
  });
});

describe("hash Argon2id (FR-002, R-01)", () => {
  it("formato PHC com m=19456 t=2 p=1; verifica certa e errada", async () => {
    const hash = await hashPassword("cavalo bateria grampo");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "cavalo bateria grampo")).toBe(true);
    expect(await verifyPassword(hash, "cavalo bateria grampa")).toBe(false);
    expect(await verifyPassword("lixo", "x")).toBe(false);
  });

  it("refaz o hash quando a versão de parâmetros muda", () => {
    expect(needsRehash(PASSWORD_PARAMS_VERSION)).toBe(false);
    expect(needsRehash(PASSWORD_PARAMS_VERSION - 1)).toBe(true);
  });
});

describe("e-mail (COM-007)", () => {
  it("trim e minúsculas, preservando pontos e +sufixo", () => {
    expect(normalizeEmail("  Ana.Souza+Painel@Example.TEST ")).toBe(
      "ana.souza+painel@example.test",
    );
  });

  it("mascara para exibição sem revelar o endereço", () => {
    expect(maskEmail("ana.souza@example.test")).toBe("a***@example.test");
    expect(maskEmail("x@example.test")).toBe("x***@example.test");
  });
});
