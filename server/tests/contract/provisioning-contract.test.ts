import { afterAll, beforeAll, describe, it } from "vitest";
import { type Admin, AuthFlow } from "../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../support/contract.js";
import { F01TestEnv } from "../support/f01.js";
import { buildF01App, type F01App } from "../support/f01-app.js";
import { requestBody, runProvisioning, trackInstance } from "../support/f02.js";
import { appCredential } from "../support/product.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("contrato-provisionamento@example.test");
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

describe("solicitação, provisionamento e conexão × contracts/openapi.yaml 1.2.0 (US3, III)", () => {
  it("respostas seguem o contrato em sucesso, conflito, validação e inexistência", async () => {
    const cookie = admin.cookie;
    check("listTimezones", await flow.request("GET", "/api/v1/instances/timezones", { cookie }));
    const body = requestBody();
    check(
      "previewInstance",
      await flow.request("POST", "/api/v1/instances/preview", { cookie, payload: body }),
    );
    const created = check(
      "requestInstance",
      await flow.request("POST", "/api/v1/instances", {
        cookie,
        payload: body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    const { instance, task } = created.json<{
      instance: { id: string; slug: string };
      task: { id: string };
    }>();
    await trackInstance(env, instance.id);
    check(
      "requestInstance",
      await flow.request("POST", "/api/v1/instances", {
        cookie,
        payload: body,
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    check(
      "requestInstance",
      await flow.request("POST", "/api/v1/instances", {
        cookie,
        payload: { ...body, slug: "admin" },
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    );
    check(
      "getProvisioning",
      await flow.request("GET", `/api/v1/instances/${instance.id}/provisioning`, { cookie }),
    );
    await runProvisioning(env, task.id);
    check(
      "getProvisioning",
      await flow.request("GET", `/api/v1/instances/${instance.id}/provisioning`, { cookie }),
    );
    check(
      "getProvisioning",
      await flow.request("GET", `/api/v1/instances/${crypto.randomUUID()}/provisioning`, {
        cookie,
      }),
    );

    const credential = await appCredential(env, "sparkref", ["connection"]);
    const connection = (slug: string) =>
      app.app.inject({
        method: "GET",
        url: `/internal/v1/instances/${slug}/connection`,
        headers: { authorization: `Bearer ${credential}` },
      });
    check("getInstanceConnection", await connection(instance.slug));
    check("getInstanceConnection", await connection("nao-existe"));
  });
});
