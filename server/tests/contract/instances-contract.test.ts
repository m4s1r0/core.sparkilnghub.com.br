import { afterAll, beforeAll, describe, it } from "vitest";
import { type Admin, AuthFlow } from "../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../support/contract.js";
import { F01TestEnv } from "../support/f01.js";
import { buildF01App, type F01App } from "../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../support/f02.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("contrato-instancias@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = (operationId: string, response: { statusCode: number; body: string }) =>
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));

describe("consulta e edição de instâncias × contracts/openapi.yaml 1.2.0 (US6, III)", () => {
  it("lista, detalhe (com convite inicial) e edição seguem o contrato", async () => {
    const cookie = admin.cookie;
    const { instanceId, taskId } = await requestViaService(env, await requester(env));
    check("listInstances", await flow.request("GET", "/api/v1/instances", { cookie }));
    check("getInstance", await flow.request("GET", `/api/v1/instances/${instanceId}`, { cookie }));
    await runProvisioning(env, taskId);
    const detail = await flow.request("GET", `/api/v1/instances/${instanceId}`, { cookie });
    check("getInstance", detail);
    const version = detail.json<{ version: number }>().version;
    const payload = { displayName: "Contrato", notes: null, validFrom: null, validUntil: null };
    check(
      "updateInstance",
      await flow.request("PUT", `/api/v1/instances/${instanceId}`, {
        cookie,
        payload: { ...payload, version },
      }),
    );
    check(
      "updateInstance",
      await flow.request("PUT", `/api/v1/instances/${instanceId}`, {
        cookie,
        payload: { ...payload, version },
      }),
    );
    check(
      "getInstance",
      await flow.request("GET", `/api/v1/instances/${crypto.randomUUID()}`, { cookie }),
    );
  });
});
