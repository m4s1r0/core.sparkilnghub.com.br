import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { binToUuid } from "../../../src/platform/ids.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { type Admin, AuthFlow, sessionCookieOf } from "../../support/auth-flow.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let ana: Admin;
const MIN = 60_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  ana = await flow.admin("ana@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const check = <R extends { statusCode: number; body: string }>(
  operationId: string,
  response: R,
): R => {
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));
  return response;
};

const invite = (admin: Admin, email: string, key = crypto.randomUUID()) =>
  flow.request("POST", "/api/v1/platform-admins/invitations", {
    cookie: admin.cookie,
    payload: { email },
    headers: { "idempotency-key": key },
  });

describe("US2 — equipe de administração da plataforma (FR-008, FR-009)", () => {
  let bruno: Admin;

  it("convite exige reautenticação recente e Idempotency-Key; repetição devolve o mesmo link", async () => {
    env.clock.advance(6 * MIN);
    const stale = check("invitePlatformAdmin", await invite(ana, "bruno@example.test"));
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ error: { code: "AUTH_REAUTH_REQUIRED" } });

    check("reauthenticate", await flow.reauth(ana));
    const missingKey = await flow.request("POST", "/api/v1/platform-admins/invitations", {
      cookie: ana.cookie,
      payload: { email: "bruno@example.test" },
    });
    expect(missingKey.statusCode).toBe(422);

    const key = crypto.randomUUID();
    const first = check("invitePlatformAdmin", await invite(ana, "bruno@example.test", key));
    expect(first.statusCode).toBe(201);
    const again = await invite(ana, "bruno@example.test", key);
    expect(again.json()).toEqual(first.json());
    const link = first.json<{ link: string }>().link;
    flow.nextStep();
    bruno = await flow.admin("bruno@example.test", link.slice(link.lastIndexOf("/") + 1));
  });

  it("lista ativos, inativos e convites pendentes sem segredos", async () => {
    await flow.reauth(ana);
    await invite(ana, "carla@example.test");
    const list = check(
      "listPlatformAdmins",
      await flow.request("GET", "/api/v1/platform-admins", { cookie: ana.cookie }),
    );
    const items = list.json<{ items: { email: string; status: string }[] }>().items;
    expect(items.map((i) => [i.email, i.status])).toEqual(
      expect.arrayContaining([
        ["ana@example.test", "ativo"],
        ["bruno@example.test", "ativo"],
        ["carla@example.test", "convite_pendente"],
      ]),
    );
    expect(list.body).not.toMatch(/token|hash|secret|password/i);
  });

  it("revogar convite pendente o invalida; repetir responde 204", async () => {
    await flow.reauth(ana);
    const created = await invite(ana, "daniel@example.test");
    const link = created.json<{ link: string }>().link;
    const token = link.slice(link.lastIndexOf("/") + 1);
    const list = await flow.request("GET", "/api/v1/platform-admins", { cookie: ana.cookie });
    const pending = list
      .json<{ items: { email: string; invitationId: string | null }[] }>()
      .items.find((i) => i.email === "daniel@example.test");
    const revoke = () =>
      flow.request("POST", `/api/v1/invitations/${pending?.invitationId}/revoke`, {
        cookie: ana.cookie,
        payload: { reason: "convite enviado por engano" },
      });
    expect(check("revokeInvitation", await revoke()).statusCode).toBe(204);
    expect((await revoke()).statusCode).toBe(204);
    const accept = await flow.acceptNew(token, "senha do daniel longa");
    expect(accept.statusCode).toBe(404);
    expect(accept.json()).toMatchObject({ error: { code: "INVITATION_INVALID" } });
  });

  it("inativar exige motivo e reautenticação e revoga as sessões do Core do alvo", async () => {
    env.clock.advance(6 * MIN);
    const brunoId = (await flow.request("GET", "/api/v1/session", { cookie: bruno.cookie })).json<{
      account: { id: string };
    }>().account.id;
    const stale = check(
      "deactivatePlatformAdmin",
      await flow.request("POST", `/api/v1/platform-admins/${brunoId}/deactivate`, {
        cookie: ana.cookie,
        payload: { reason: "saiu da equipe" },
      }),
    );
    expect(stale.statusCode).toBe(403);
    await flow.reauth(ana);
    const ok = check(
      "deactivatePlatformAdmin",
      await flow.request("POST", `/api/v1/platform-admins/${brunoId}/deactivate`, {
        cookie: ana.cookie,
        payload: { reason: "saiu da equipe" },
      }),
    );
    expect(ok.statusCode).toBe(204);
    expect(
      (await flow.request("GET", "/api/v1/session", { cookie: bruno.cookie })).statusCode,
    ).toBe(401);
    const login = await flow.login(bruno.email, bruno.password);
    expect(login.response.statusCode).toBe(401);
  });

  it("inativar o último administrador ativo é recusado, inclusive a si mesmo", async () => {
    await flow.reauth(ana);
    const anaId = (await flow.request("GET", "/api/v1/session", { cookie: ana.cookie })).json<{
      account: { id: string };
    }>().account.id;
    const refused = check(
      "deactivatePlatformAdmin",
      await flow.request("POST", `/api/v1/platform-admins/${anaId}/deactivate`, {
        cookie: ana.cookie,
        payload: { reason: "teste do último" },
      }),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: "CONFLICT_LAST_ADMIN" } });
  });

  it("reativar exige novo login (sessões antigas continuam encerradas)", async () => {
    await flow.reauth(ana);
    const brunoAccount = await sql<{ id: Buffer }>`SELECT id FROM account
       WHERE email_normalized = 'bruno@example.test'`.execute(env.ctx.identity);
    const brunoId = binToUuid(brunoAccount.rows[0]?.id ?? Buffer.alloc(16));
    const ok = check(
      "reactivatePlatformAdmin",
      await flow.request("POST", `/api/v1/platform-admins/${brunoId}/reactivate`, {
        cookie: ana.cookie,
        payload: { reason: "voltou à equipe" },
      }),
    );
    expect(ok.statusCode).toBe(204);
    expect(
      (await flow.request("GET", "/api/v1/session", { cookie: bruno.cookie })).statusCode,
    ).toBe(401);
    flow.nextStep();
    const login = await flow.login(bruno.email, bruno.password);
    expect(login.response.statusCode).toBe(200);
    expect(sessionCookieOf(login.response)).toBeDefined();
  });

  it("auditoria registra autor, alvo, valores anterior e novo e motivo", async () => {
    const { rows } = await sql<{
      type: string;
      actor_account_id: Buffer | null;
      target_account_id: Buffer | null;
      detail: { antes?: string; depois?: string; motivo?: string } | string;
    }>`SELECT type, actor_account_id, target_account_id, detail FROM security_event
        WHERE type IN ('admin_inativado', 'admin_reativado', 'convite_revogado')`.execute(
      env.ctx.identity,
    );
    const details = rows.map((r) =>
      typeof r.detail === "string" ? (JSON.parse(r.detail) as Record<string, unknown>) : r.detail,
    );
    expect(rows.every((r) => r.actor_account_id !== null)).toBe(true);
    expect(details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ antes: "ativo", depois: "inativo", motivo: "saiu da equipe" }),
        expect.objectContaining({ antes: "inativo", depois: "ativo", motivo: "voltou à equipe" }),
        expect.objectContaining({ motivo: "convite enviado por engano" }),
      ]),
    );
  });
});
