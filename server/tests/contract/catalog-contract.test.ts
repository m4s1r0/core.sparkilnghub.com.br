import { afterAll, beforeAll, describe, it } from "vitest";
import { type Admin, AuthFlow } from "../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../support/contract.js";
import { F01TestEnv } from "../support/f01.js";
import { buildF01App, type F01App } from "../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("contrato-catalogo@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = (operationId: string, response: { statusCode: number; body: string }) =>
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));

describe("catálogo × contracts/openapi.yaml 1.2.0 (US2, III)", () => {
  it("respostas de /api/v1/products* seguem o contrato", async () => {
    const cookie = admin.cookie;
    check("listProducts", await flow.request("GET", "/api/v1/products", { cookie }));
    check("getProduct", await flow.request("GET", "/api/v1/products/sparkpet", { cookie }));
    check("getProduct", await flow.request("GET", "/api/v1/products/naoexiste", { cookie }));
    check(
      "updateProduct",
      await flow.request("PUT", "/api/v1/products/sparkpet", {
        cookie,
        payload: { name: "Tuteli", description: "Gestão de pet shops", version: 1 },
      }),
    );
    check(
      "updateProduct",
      await flow.request("PUT", "/api/v1/products/sparkpet", {
        cookie,
        payload: { name: "Tuteli", description: "Gestão de pet shops", version: 1 },
      }),
    );
    check(
      "inactivateProduct",
      await flow.request("POST", "/api/v1/products/sparkref/inactivate", {
        cookie,
        payload: { reason: "contrato", version: 1 },
      }),
    );
    check(
      "reactivateProduct",
      await flow.request("POST", "/api/v1/products/sparkref/reactivate", {
        cookie,
        payload: { reason: "contrato", version: 2 },
      }),
    );
  });
});
