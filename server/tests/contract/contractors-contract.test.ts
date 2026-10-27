import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  admin = await flow.admin("contrato-contratantes@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = <R extends { statusCode: number; body: string }>(
  operationId: string,
  response: R,
) => {
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));
  return response;
};

describe("contratantes × contracts/openapi.yaml 1.2.0 (US1, III)", () => {
  it("todas as respostas de /api/v1/contractors* seguem o contrato", async () => {
    const payload = {
      legalName: "Contrato Pet Ltda",
      displayName: "Contrato Pet",
      personType: "fisica",
      document: "529.982.247-25",
      contactName: "Pessoa",
      email: "contrato@example.test",
    };
    const created = check(
      "createContractor",
      await flow.request("POST", "/api/v1/contractors", {
        cookie: admin.cookie,
        payload,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    const { id, version } = created.json<{ id: string; version: number }>();
    check(
      "createContractor",
      await flow.request("POST", "/api/v1/contractors", {
        cookie: admin.cookie,
        payload,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    check(
      "listContractors",
      await flow.request("GET", "/api/v1/contractors", { cookie: admin.cookie }),
    );
    check(
      "findSimilarContractors",
      await flow.request("GET", "/api/v1/contractors/similar?legalName=Contrato", {
        cookie: admin.cookie,
      }),
    );
    check(
      "getContractor",
      await flow.request("GET", `/api/v1/contractors/${id}`, { cookie: admin.cookie }),
    );
    check(
      "getContractor",
      await flow.request("GET", `/api/v1/contractors/${crypto.randomUUID()}`, {
        cookie: admin.cookie,
      }),
    );
    check(
      "updateContractor",
      await flow.request("PUT", `/api/v1/contractors/${id}`, {
        cookie: admin.cookie,
        payload: { ...payload, version },
      }),
    );
    check(
      "inactivateContractor",
      await flow.request("POST", `/api/v1/contractors/${id}/inactivate`, {
        cookie: admin.cookie,
        payload: { reason: "teste de contrato", version: version + 1 },
      }),
    );
    check(
      "reactivateContractor",
      await flow.request("POST", `/api/v1/contractors/${id}/reactivate`, {
        cookie: admin.cookie,
        payload: { reason: "teste de contrato", version: version + 2 },
      }),
    );
  });

  it("campo desconhecido no corpo → 422 VALIDATION_FAILED", async () => {
    const response = check(
      "createContractor",
      await flow.request("POST", "/api/v1/contractors", {
        cookie: admin.cookie,
        payload: {
          legalName: "Campo Extra",
          displayName: "Campo Extra",
          personType: "juridica",
          contactName: "Pessoa",
          email: "extra@example.test",
          nameKey: "forjado",
        },
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    expect(response.statusCode).toBe(422);
  });
});
