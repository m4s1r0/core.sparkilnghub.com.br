import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeMembership } from "../../../src/modules/memberships/memberships.js";
import { binToUuid, uuidToBin } from "../../../src/platform/ids.js";
import type { ReferenceProductClient } from "../../../reference-product/client.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
let a: TestInstance;
let b: TestInstance;
let productA: ReferenceProductClient;
let productB: ReferenceProductClient;
const MIN = 60_000;
const info = { ip: "127.0.0.1", userAgent: null, correlationId: crypto.randomUUID() };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("plataforma@example.test");
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
  const credential = await appCredential(env);
  productA = await productFor(env, app, a, credential);
  productB = await productFor(env, app, b, credential);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

type Response = { statusCode: number; body: string; json<T>(): T };
const check = <R extends Response>(operationId: string, response: R): R => {
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));
  return response;
};

const panel = (
  path: string,
  payload?: unknown,
  options: { key?: string | null; method?: "GET" | "POST" } = {},
) =>
  flow.request(options.method ?? (payload === undefined ? "GET" : "POST"), path, {
    cookie: admin.cookie,
    ...(payload !== undefined ? { payload } : {}),
    headers: options.key === null ? {} : { "idempotency-key": options.key ?? crypto.randomUUID() },
  });

async function invite(
  instance: TestInstance,
  email: string,
  role = "colaborador",
  initial = false,
) {
  const response = check(
    "inviteMember",
    await panel(`/api/v1/instances/${instance.id}/invitations`, { email, role, initial }),
  );
  if (response.statusCode !== 201)
    throw new Error(`convite ${response.statusCode} ${response.body}`);
  const link = response.json<{ link: string }>().link;
  return link.slice(link.lastIndexOf("/") + 1);
}

async function members(instance: TestInstance) {
  const response = check("listMembers", await panel(`/api/v1/instances/${instance.id}/members`));
  return response.json<{
    items: {
      membershipId: string | null;
      invitationId: string | null;
      displayName: string | null;
      emailMasked: string | null;
      role: string;
      status: string;
      version: number | null;
    }[];
  }>().items;
}

const memberOf = async (instance: TestInstance, displayName: string) =>
  (await members(instance)).find((m) => m.displayName === displayName && m.status === "ativo");

describe("US4 — convites e vínculos pelo painel (FR-016 a FR-021)", () => {
  it("convite exige reautenticação e Idempotency-Key; aceite com conta nova concede só aquele papel", async () => {
    env.clock.advance(6 * MIN);
    const stale = check(
      "inviteMember",
      await panel(`/api/v1/instances/${a.id}/invitations`, {
        email: "carla@example.test",
        role: "colaborador",
      }),
    );
    expect(stale.statusCode).toBe(403);
    await flow.reauth(admin);
    const noKey = await panel(
      `/api/v1/instances/${a.id}/invitations`,
      { email: "carla@example.test", role: "colaborador" },
      { key: null },
    );
    expect(noKey.statusCode).toBe(422);

    const token = await invite(a, "carla@example.test");
    const preview = await flow.request("GET", `/api/v1/invitations/${token}`);
    expect(preview.json()).toMatchObject({ target: "instancia", roleLabel: "Colaborador" });
    const accepted = check(
      "acceptInvitation",
      await flow.request("POST", `/api/v1/invitations/${token}/accept`, {
        payload: { displayName: "[SINTÉTICO] Carla", password: "senha da carla longa" },
      }),
    );
    expect(accepted.json()).toEqual({ next: "done" });
    expect(
      (
        await flow.request("POST", `/api/v1/invitations/${token}/accept`, {
          payload: { displayName: "[SINTÉTICO] Carla", password: "senha da carla longa" },
        })
      ).statusCode,
    ).toBe(404);

    const carla = await memberOf(a, "[SINTÉTICO] Carla");
    expect(carla).toMatchObject({ role: "colaborador", version: 1 });
    expect(
      (await productA.login("carla@example.test", "senha da carla longa", "198.51.100.1")).status,
    ).toBe(201);
    expect(
      (await productB.login("carla@example.test", "senha da carla longa", "198.51.100.1")).status,
    ).toBe(401);
  });

  it("conta existente aceita com a senha atual, sem trocá-la; 10 falhas → 429", async () => {
    await flow.reauth(admin);
    const token = await invite(b, "carla@example.test");
    const preview = (await flow.request("GET", `/api/v1/invitations/${token}`)).json<{
      accountExists: boolean;
    }>();
    expect(preview.accountExists).toBe(true);
    for (let i = 0; i < 10; i += 1) {
      await flow.request("POST", `/api/v1/invitations/${token}/accept`, {
        payload: { currentPassword: "senha errada" },
      });
    }
    const locked = await flow.request("POST", `/api/v1/invitations/${token}/accept`, {
      payload: { currentPassword: "senha da carla longa" },
    });
    expect(locked.statusCode).toBe(429);
    env.clock.advance(16 * MIN);
    const ok = await flow.request("POST", `/api/v1/invitations/${token}/accept`, {
      payload: { currentPassword: "senha da carla longa" },
    });
    expect(ok.json()).toEqual({ next: "done" });
    expect(
      (await productB.login("carla@example.test", "senha da carla longa", "198.51.100.2")).status,
    ).toBe(201);
  });

  it("reenvio invalida o anterior; convites simultâneos geram um só vínculo", async () => {
    await flow.reauth(admin);
    const first = await invite(a, "dora@example.test");
    const second = await invite(a, "dora@example.test");
    expect((await flow.request("GET", `/api/v1/invitations/${first}`)).statusCode).toBe(404);
    expect((await flow.request("GET", `/api/v1/invitations/${second}`)).statusCode).toBe(200);

    const tokens = await Promise.all([
      invite(a, "eva@example.test"),
      invite(a, "eva@example.test"),
    ]);
    await Promise.all(
      tokens.map((token) =>
        flow.request("POST", `/api/v1/invitations/${token}/accept`, {
          payload: { displayName: "[SINTÉTICO] Eva", password: "senha da eva longa" },
        }),
      ),
    );
    const eva = (await members(a)).filter(
      (m) => m.displayName === "[SINTÉTICO] Eva" && m.status === "ativo",
    );
    expect(eva).toHaveLength(1);
  });

  it("mudança de papel: versão desatualizada → 409; idempotência repete o resultado", async () => {
    await flow.reauth(admin);
    const carla = await memberOf(a, "[SINTÉTICO] Carla");
    const path = `/api/v1/instances/${a.id}/members/${carla?.membershipId}/role`;
    const stale = check(
      "changeMemberRole",
      await panel(path, { role: "administrador", reason: "promoção", version: 99 }),
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "CONFLICT_VERSION" } });
    const key = crypto.randomUUID();
    const body = { role: "administrador", reason: "promoção", version: carla?.version };
    const ok = check("changeMemberRole", await panel(path, body, { key }));
    expect(ok.json()).toEqual({ instances: [{ instanceId: a.id, status: "aplicada" }] });
    expect((await panel(path, body, { key })).json()).toEqual(ok.json());
    const reused = await panel(path, { ...body, reason: "outro motivo" }, { key });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ error: { code: "CONFLICT_IDEMPOTENCY_KEY_REUSED" } });
    expect(await memberOf(a, "[SINTÉTICO] Carla")).toMatchObject({
      role: "administrador",
      version: 2,
    });
  });

  it("revogar o vínculo em A encerra só as sessões de A; a conta continua em B (CA-SC-004)", async () => {
    await flow.reauth(admin);
    const sessionA = (
      await productA.login("carla@example.test", "senha da carla longa", "198.51.100.3")
    ).body as { token: string };
    const sessionB = (
      await productB.login("carla@example.test", "senha da carla longa", "198.51.100.3")
    ).body as { token: string };
    // Carla é administradora em A: Eva vira administradora antes, para A não ficar sem caminho.
    const eva = await memberOf(a, "[SINTÉTICO] Eva");
    await panel(`/api/v1/instances/${a.id}/members/${eva?.membershipId}/role`, {
      role: "administrador",
      reason: "segunda administradora",
      version: eva?.version,
    });
    const carla = await memberOf(a, "[SINTÉTICO] Carla");
    const revoked = check(
      "revokeMember",
      await panel(`/api/v1/instances/${a.id}/members/${carla?.membershipId}/revoke`, {
        reason: "saiu do estabelecimento",
        version: carla?.version,
      }),
    );
    expect(revoked.json()).toEqual({ instances: [{ instanceId: a.id, status: "aplicada" }] });
    expect(await productA.validate(sessionA.token, env.clock.now())).toBeNull();
    expect(await productB.validate(sessionB.token, env.clock.now())).not.toBeNull();
    const { rows } = await sql<{ end_reason: string }>`SELECT end_reason FROM access_session
       WHERE end_reason IS NOT NULL`.execute(env.ctx.access(a.accessDatabaseName));
    expect(rows.map((r) => r.end_reason)).toContain("vinculo_revogado");
  });

  it("último administrador da instância: rebaixar ou revogar → 409", async () => {
    await flow.reauth(admin);
    const eva = await memberOf(a, "[SINTÉTICO] Eva");
    const demote = check(
      "changeMemberRole",
      await panel(`/api/v1/instances/${a.id}/members/${eva?.membershipId}/role`, {
        role: "colaborador",
        reason: "teste",
        version: eva?.version,
      }),
    );
    expect(demote.statusCode).toBe(409);
    expect(demote.json()).toMatchObject({ error: { code: "CONFLICT_LAST_ADMIN" } });
    const revoke = await panel(`/api/v1/instances/${a.id}/members/${eva?.membershipId}/revoke`, {
      reason: "teste",
      version: eva?.version,
    });
    expect(revoke.json()).toMatchObject({ error: { code: "CONFLICT_LAST_ADMIN" } });
  });

  it("100 rodadas concorrentes: a instância nunca fica sem administrador (T-05, CS-004)", async () => {
    const c = await env.createInstance("ref-c");
    const x = await env.insertAccount();
    const y = await env.insertAccount();
    const mx = await env.insertMembership(x.id, c.id, "administrador");
    const my = await env.insertMembership(y.id, c.id, "administrador");
    const version = async (id: string) => {
      const { rows } = await sql<{ version: number }>`SELECT version FROM membership
         WHERE id = ${uuidToBin(id)}`.execute(env.ctx.identity);
      return rows[0]?.version ?? 0;
    };
    for (let round = 0; round < 100; round += 1) {
      const [vx, vy] = [await version(mx), await version(my)];
      const results = await Promise.allSettled([
        revokeMembership(env.ctx, y.id, c, mx, { reason: "rodada", version: vx }, info),
        revokeMembership(env.ctx, x.id, c, my, { reason: "rodada", version: vy }, info),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM membership
         WHERE instance_id = ${uuidToBin(c.id)} AND status = 'ativo' AND role = 'administrador'`.execute(
        env.ctx.identity,
      );
      expect(Number(rows[0]?.n)).toBe(1);
      await sql`UPDATE membership SET status = 'ativo' WHERE instance_id = ${uuidToBin(c.id)}`.execute(
        env.ctx.identity,
      );
    }
  });

  it("convite inicial válido conta como caminho de acesso; revogá-lo sendo o único → 409", async () => {
    await flow.reauth(admin);
    const d = await env.createInstance("ref-d");
    const only = await env.insertAccount({ displayName: "[SINTÉTICO] Única" });
    const membershipId = await env.insertMembership(only.id, d.id, "administrador");
    await invite(d, "inicial@example.test", "administrador", true);
    // Com o convite inicial pendente, a única administradora pode ser revogada.
    const revoked = await panel(`/api/v1/instances/${d.id}/members/${membershipId}/revoke`, {
      reason: "substituída pelo convite inicial",
      version: 1,
    });
    expect(revoked.statusCode).toBe(200);
    const pending = (await members(d)).find((m) => m.status === "convite_pendente");
    expect(pending?.emailMasked).toBe("i***@example.test");
    const refused = check(
      "revokeInvitation",
      await panel(`/api/v1/invitations/${pending?.invitationId}/revoke`, { reason: "teste" }),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: "CONFLICT_LAST_ADMIN" } });
  });

  it("revogar convite de instância pendente o invalida", async () => {
    await flow.reauth(admin);
    const token = await invite(b, "fabio@example.test");
    const pending = (await members(b)).find((m) => m.emailMasked === "f***@example.test");
    const response = await panel(`/api/v1/invitations/${pending?.invitationId}/revoke`, {
      reason: "não vai mais trabalhar aqui",
    });
    expect(response.statusCode).toBe(204);
    expect((await flow.request("GET", `/api/v1/invitations/${token}`)).statusCode).toBe(404);
  });

  it("auditoria: papel, revogação e convites com autor, alvo, instância, antes/depois e motivo", async () => {
    const { rows } = await sql<{
      type: string;
      actor_account_id: Buffer | null;
      instance_id: Buffer | null;
      detail: unknown;
    }>`SELECT type, actor_account_id, instance_id, detail FROM security_event
        WHERE type IN ('papel_alterado', 'vinculo_revogado', 'convite_criado', 'convite_revogado')`.execute(
      env.ctx.identity,
    );
    const roleChange = rows.find((r) => r.type === "papel_alterado");
    expect(roleChange?.instance_id && binToUuid(roleChange.instance_id)).toBe(a.id);
    expect(JSON.stringify(roleChange?.detail)).toMatch(/colaborador.*administrador|antes/);
    expect(rows.filter((r) => r.type === "vinculo_revogado").every((r) => r.actor_account_id)).toBe(
      true,
    );
  });
});
