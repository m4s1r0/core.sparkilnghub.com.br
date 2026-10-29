import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listProducts } from "../../../src/modules/catalog/catalog.js";
import type { ProvisionerRegistry } from "../../../src/modules/catalog/provisioners.js";
import { referenceProductDir } from "../../../src/platform/paths.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-catalogo@example.test");
  // O catálogo de teste nasce com sparkref (apoio); sparkpet vem da migração 0004.
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

interface Product {
  code: string;
  status: string;
  provisioner: string | null;
  deployedVersion: number | null;
  provisionable: boolean;
  notProvisionableReason: string | null;
  version: number;
}

const checked = <R extends { statusCode: number; body: string }>(operation: string, r: R): R => {
  expectMatchesContract(operation, r.statusCode, bodyOf(r));
  return r;
};

const product = async (code: string) =>
  checked(
    "getProduct",
    await flow.request("GET", `/api/v1/products/${code}`, { cookie: admin.cookie }),
  ).json<Product>();

describe("catálogo de produtos (US2, SC-007 a SC-009)", () => {
  it("Tuteli e produto de referência são provisionáveis com artefato publicado", async () => {
    const list = checked(
      "listProducts",
      await flow.request("GET", "/api/v1/products", { cookie: admin.cookie }),
    ).json<{ items: Product[] }>();
    const pet = list.items.find((p) => p.code === "sparkpet");
    expect(pet).toMatchObject({
      provisionable: true,
      notProvisionableReason: null,
      provisioner: "sparkpet-v1",
    });
    expect(pet?.deployedVersion).toBeGreaterThanOrEqual(1);
    const ref = list.items.find((p) => p.code === "sparkref");
    expect(ref).toMatchObject({ provisionable: true, notProvisionableReason: null });
    expect(ref?.deployedVersion).toBeGreaterThanOrEqual(2);
    expect(ref?.provisioner).toBe("sparkref-v1");
  });

  it("artefato com checksum divergente → ARTEFATO_INVALIDO, sem caminho nem SQL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "artefato-quebrado-"));
    cpSync(referenceProductDir, dir, { recursive: true });
    writeFileSync(join(dir, "migrations", "0002_ref_item.sql"), "CREATE TABLE alterada (id INT);");
    const registry: ProvisionerRegistry = {
      sparkref: { id: "sparkref-v1", artifactDir: dir, environments: ["development"] },
    };
    const items = await listProducts(env.ctx, registry);
    const ref = items.find((p) => p.code === "sparkref");
    expect(ref).toMatchObject({
      provisionable: false,
      notProvisionableReason: "ARTEFATO_INVALIDO",
    });
    expect(JSON.stringify(ref)).not.toContain(dir);
    expect(JSON.stringify(ref)).not.toMatch(/CREATE TABLE/);
  });

  it("inativar bloqueia novas solicitações sem mudar instâncias; reativar volta", async () => {
    const instance = await env.insertInstanceRow({ state: "ATIVA" });
    const before = await product("sparkref");
    const inactivated = checked(
      "inactivateProduct",
      await flow.request("POST", "/api/v1/products/sparkref/inactivate", {
        cookie: admin.cookie,
        payload: { reason: "teste de inativação", version: before.version },
      }),
    );
    expect(inactivated.json<Product>()).toMatchObject({
      status: "inativo",
      provisionable: false,
      notProvisionableReason: "PRODUTO_INATIVO",
    });
    const { rows } = await sql<{ state: string }>`
      SELECT state FROM instance WHERE id = UNHEX(REPLACE(${instance}, '-', ''))`.execute(
      env.ctx.core,
    );
    expect(rows[0]?.state).toBe("ATIVA");

    const reactivated = checked(
      "reactivateProduct",
      await flow.request("POST", "/api/v1/products/sparkref/reactivate", {
        cookie: admin.cookie,
        payload: { reason: "teste de reativação", version: before.version + 1 },
      }),
    );
    expect(reactivated.json<Product>()).toMatchObject({ status: "ativo", provisionable: true });
  });

  it("edição de nome e descrição com versão; código e provisionador não são aceitos", async () => {
    const current = await product("sparkpet");
    const ok = checked(
      "updateProduct",
      await flow.request("PUT", "/api/v1/products/sparkpet", {
        cookie: admin.cookie,
        payload: { name: "Tuteli", description: "Gestão de pet shops", version: current.version },
      }),
    );
    expect(ok.json<Product>()).toMatchObject({ version: current.version + 1 });
    const stale = await flow.request("PUT", "/api/v1/products/sparkpet", {
      cookie: admin.cookie,
      payload: { name: "Outro", description: "x", version: current.version },
    });
    expect(stale.statusCode).toBe(409);
    for (const extra of [{ code: "outro" }, { provisioner: "https://exemplo/x.sql" }]) {
      const refused = await flow.request("PUT", "/api/v1/products/sparkpet", {
        cookie: admin.cookie,
        payload: { name: "Tuteli", description: "x", version: current.version + 1, ...extra },
      });
      expect(refused.statusCode).toBe(422);
    }
    const { rows } = await sql<{ action: string }>`
      SELECT action FROM core_audit_event WHERE object_type = 'produto'
       ORDER BY created_at, id`.execute(env.ctx.core);
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(["produto.editado", "produto.inativado", "produto.reativado"]),
    );
  });

  it("produto inexistente → 404", async () => {
    const response = await flow.request("GET", "/api/v1/products/naoexiste", {
      cookie: admin.cookie,
    });
    expect(response.statusCode).toBe(404);
  });
});
