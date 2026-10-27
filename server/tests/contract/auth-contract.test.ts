import { afterAll, beforeAll, describe, it } from "vitest";
import { bodyOf, expectMatchesContract } from "../support/contract.js";
import { F01TestEnv } from "../support/f01.js";
import { buildF01App, type F01App } from "../support/f01-app.js";
import { AuthFlow, sessionCookieOf } from "../support/auth-flow.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = (operationId: string, response: { statusCode: number; body: string }) =>
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));

describe("respostas de autenticação × contracts/openapi.yaml (CS-002, III)", () => {
  it("convite, aceite, cadastro de TOTP, sessão, login, segundo fator e logout", async () => {
    const token = await flow.bootstrapToken("contrato@example.test");
    check("inspectInvitation", await flow.request("GET", `/api/v1/invitations/${token}`));
    check("inspectInvitation", await flow.request("GET", `/api/v1/invitations/${"y".repeat(43)}`));
    check("acceptInvitation", await flow.acceptNew(token, "curta"));

    const accepted = await flow.acceptNew(token, "senha de contrato longa");
    check("acceptInvitation", accepted);
    check("acceptInvitation", await flow.acceptNew(token, "senha de contrato longa"));
    const cookie = sessionCookieOf(accepted) ?? "";

    check("currentSession", await flow.request("GET", "/api/v1/session", { cookie }));
    check("currentSession", await flow.request("GET", "/api/v1/session"));

    const start = await flow.request("POST", "/api/v1/account/mfa/enrollment", { cookie });
    check("startMfaEnrollment", start);
    check(
      "confirmMfaEnrollment",
      await flow.request("POST", "/api/v1/account/mfa/enrollment/confirm", {
        cookie,
        payload: { code: "000000" },
      }),
    );
    const { secret } = await flow.enroll(cookie);
    check(
      "startMfaEnrollment",
      await flow.request("POST", "/api/v1/account/mfa/enrollment", { cookie }),
    );

    flow.nextStep();
    check("login", (await flow.login("contrato@example.test", "senha errada qualquer")).response);
    const login = await flow.login("contrato@example.test", "senha de contrato longa");
    check("login", login.response);
    check("confirmMfa", await flow.mfa(login.cookie ?? "", { code: "000000" }));
    check("confirmMfa", await flow.mfa(login.cookie ?? "", { code: flow.code(secret) }));
    // Situação do sistema: sem sessão → 401; com sessão plena → 200 (T037).
    check("getSystemStatus", await flow.request("GET", "/api/v1/system/status"));
    check(
      "getSystemStatus",
      await flow.request("GET", "/api/v1/system/status", { cookie: login.cookie }),
    );
    check("logout", await flow.request("POST", "/api/v1/auth/logout", { cookie: login.cookie }));

    for (let i = 0; i < 10; i += 1)
      await flow.login("limite@example.test", "senha errada qualquer");
    check("login", (await flow.login("limite@example.test", "senha errada qualquer")).response);
  });
});
