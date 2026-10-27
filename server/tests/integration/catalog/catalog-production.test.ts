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
