import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProduct, listProducts } from "../../../src/modules/catalog/catalog.js";
import { resolveProvisioner } from "../../../src/modules/catalog/provisioners.js";
import type { AppContext } from "../../../src/platform/context.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;
let production: AppContext;

beforeAll(async () => {
  env = await F01TestEnv.create();
  production = Object.create(env.ctx, {
    config: { value: { ...env.ctx.config, SPARK_ENV: "production" } },
  }) as AppContext;
});
afterAll(async () => {
  await env?.cleanup();
});

describe("produto de referência fora do catálogo de produção (FR-010, constituição III)", () => {
  it("lista sem sparkref, detalhe 404 e provisionador recusado", async () => {
    const codes = (await listProducts(production)).map((p) => p.code);
    expect(codes).toContain("sparkpet");
    expect(codes).not.toContain("sparkref");
    await expect(getProduct(production, "sparkref")).rejects.toMatchObject({ statusCode: 404 });
    expect(await resolveProvisioner("sparkref", "production")).toEqual({
      ok: false,
      reason: "AMBIENTE_NAO_PERMITIDO",
    });
  });

  it("fora de produção o mesmo produto é provisionável", async () => {
    const resolved = await resolveProvisioner("sparkref", "development");
    expect(resolved.ok).toBe(true);
  });
});

describe("Cortivo no catálogo, em todos os ambientes (spec 009, US1.4, US4)", () => {
  it("aparece em produção como produto real, ativo e não de referência", async () => {
    const codes = (await listProducts(production)).map((p) => p.code);
    expect(codes).toContain("cortivo");
    await expect(getProduct(production, "cortivo")).resolves.toMatchObject({
      code: "cortivo",
      name: "Cortivo",
      description: "Gestão para barbearias",
      status: "ativo",
    });
  });

  it("o provisionador cortivo-v2 está disponível em development, homologation e production", async () => {
    for (const environment of ["development", "homologation", "production"] as const) {
      const resolved = await resolveProvisioner("cortivo", environment);
      expect(resolved).toMatchObject({ ok: true, version: 2 });
      if (resolved.ok) expect(resolved.provisioner.id).toBe("cortivo-v2");
    }
  });

  it("registrar o Cortivo não altera a resolução de sparkpet nem de sparkref", async () => {
    const pet = await resolveProvisioner("sparkpet", "production");
    expect(pet).toMatchObject({ ok: true });
    if (pet.ok) expect(pet.provisioner.id).toBe("sparkpet-v1");
    expect(await resolveProvisioner("sparkref", "production")).toEqual({
      ok: false,
      reason: "AMBIENTE_NAO_PERMITIDO",
    });
  });
});
