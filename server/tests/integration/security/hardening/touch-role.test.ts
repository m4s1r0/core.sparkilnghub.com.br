import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../../src/modules/instances/instances.js";
import { changeMemberRole } from "../../../../src/modules/memberships/memberships.js";
import { F01TestEnv, type TestInstance } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";
import { appCredential } from "../../../support/product.js";

/**
 * SEC-04 / SEC-BASE-04 — contrato v1.4: o touch devolve o papel e a situação do vínculo lidos da
 * projeção, para o produto autorizar pelo papel atual e não pelo papel guardado no login.
 */
let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let credential: string;
let owner: { id: string; email: string; password: string };
let bia: { id: string; email: string; password: string };
let biaMembership: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("touch-a");
  credential = await appCredential(env, "sparkref", ["sessions"], a.id);
  owner = await env.insertAccount();
  bia = await env.insertAccount();
  await env.insertMembership(owner.id, a.id, "administrador");
  biaMembership = await env.insertMembership(bia.id, a.id, "administrador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function login(account: { email: string; password: string }): Promise<string> {
  const response = await app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${a.slug}/sessions`,
    headers: { authorization: `Bearer ${credential}` },
    payload: { email: account.email, password: account.password, clientIp: "198.51.100.40" },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ token: string }>().token;
}

const touch = (token: string) =>
  app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${a.slug}/sessions/touch`,
    headers: { authorization: `Bearer ${credential}`, "x-instance-session": token },
  });

describe("SEC-04 — touch v1.4 devolve papel e situação do vínculo", () => {
  it("sessão válida → 200 { role, membershipStatus }", async () => {
    const response = await touch(await login(bia));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ role: "administrador", membershipStatus: "ativo" });
  });

  it("rebaixamento no Core é visto no touch seguinte da sessão já aberta", async () => {
    const token = await login(bia);
    expect((await touch(token)).json<{ role: string }>().role).toBe("administrador");
    const instance = await getInstance(env.ctx, a.id);
    if (!instance) throw new Error("instância");
    await changeMemberRole(
      env.ctx,
      owner.id,
      instance,
      biaMembership,
      { role: "colaborador", reason: "rebaixamento de teste", version: 1 },
      { ip: "198.51.100.41", userAgent: null, correlationId: crypto.randomUUID() },
    );
    const after = await touch(token);
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual({ role: "colaborador", membershipStatus: "ativo" });
  });

  it("sessão inválida continua 401 sem corpo de papel", async () => {
    const response = await touch("y".repeat(43));
    expect(response.statusCode).toBe(401);
    expect(response.json()).not.toHaveProperty("role");
  });
});
