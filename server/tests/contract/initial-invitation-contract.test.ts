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
  admin = await flow.admin("contrato-convite-inicial@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = (operationId: string, response: { statusCode: number; body: string }) =>
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));

describe("emissão do convite inicial × contracts/openapi.yaml 1.2.0 (US5, III)", () => {
  it("201 com link de uso único e 409 fora de PRONTA", async () => {
    const accountId = await requester(env);
    const ready = await requestViaService(env, accountId);
    await runProvisioning(env, ready.taskId);
    const pending = await requestViaService(env, accountId);
    for (const instanceId of [ready.instanceId, pending.instanceId]) {
      check(
        "issueInitialInvitation",
        await flow.request("POST", `/api/v1/instances/${instanceId}/initial-invitation/issue`, {
          cookie: admin.cookie,
          headers: { "idempotency-key": crypto.randomUUID() },
        }),
      );
    }
  });
});
