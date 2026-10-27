import { describe, expect, it } from "vitest";
import { checkSlug, normalizeSlug } from "../../../src/modules/instances/slug.js";

describe("identificador de acesso (slug) — SC-015, research.md R-05", () => {
  it("normaliza acentos, caixa, espaços, sublinhados e hífens repetidos", () => {
    expect(normalizeSlug("Loja Centro!")).toBe("loja-centro");
    expect(normalizeSlug("  Pet São José  ")).toBe("pet-sao-jose");
    expect(normalizeSlug("banho__e___tosa")).toBe("banho-e-tosa");
    expect(normalizeSlug("--unidade--2--")).toBe("unidade-2");
    expect(normalizeSlug("ÁGUA&Ração")).toBe("aguaracao");
  });

  it("aceita 3 a 63 caracteres, começando por letra e terminando em letra ou dígito", () => {
    expect(checkSlug("Loja Centro!")).toEqual({ ok: true, slug: "loja-centro" });
    expect(checkSlug("a".repeat(63))).toEqual({ ok: true, slug: "a".repeat(63) });
    expect(checkSlug("ab")).toEqual({ ok: false, slug: "ab", reason: "TAMANHO" });
    expect(checkSlug("a".repeat(64))).toMatchObject({ ok: false, reason: "TAMANHO" });
    expect(checkSlug("2-lojas")).toMatchObject({ ok: false, reason: "FORMATO" });
    expect(checkSlug("!!!")).toMatchObject({ ok: false, reason: "TAMANHO" });
  });

  it("recusa palavras reservadas, mesmo com caixa ou acento diferente", () => {
    expect(checkSlug("admin")).toMatchObject({ ok: false, reason: "RESERVADO" });
    expect(checkSlug("WWW")).toMatchObject({ ok: false, reason: "RESERVADO" });
    expect(checkSlug("Convite")).toMatchObject({ ok: false, reason: "RESERVADO" });
    expect(checkSlug("sparkpet")).toMatchObject({ ok: false, reason: "RESERVADO" });
    expect(checkSlug("admin-loja")).toEqual({ ok: true, slug: "admin-loja" });
  });
});
