import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReferenceProductClient } from "../../../reference-product/client.js";
import { uuidToBin } from "../../../src/platform/ids.js";
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
let carla: { id: string; email: string; password: string };
const MIN = 60_000;

type Response = { statusCode: number; body: string; json<T>(): T };
const check = <R extends Response>(operationId: string, response: R): R => {
  expectMatchesContract(operationId, response.statusCode, bodyOf(response));
  return response;
};

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
  carla = await env.insertAccount({
    email: "carla@example.test",
    displayName: "[SINTÉTICO] Carla",
  });
  await env.insertMembership(carla.id, a.id, "colaborador");
  await env.insertMembership(carla.id, b.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const panel = (method: "GET" | "POST", path: string, payload?: unknown, key?: string | null) =>
  flow.request(method, path, {
    cookie: admin.cookie,
    ...(payload !== undefined ? { payload } : {}),
    headers: key === null || key === undefined ? {} : { "idempotency-key": key },
  });

async function productTokens() {
  const login = async (product: ReferenceProductClient) =>
    ((await product.login(carla.email, carla.password, "198.51.100.50")).body as { token: string })
      .token;
  return { a: await login(productA), b: await login(productB) };
}

describe("US5 — recuperação de acesso (FR-016, FR-023, COM-018, COM-019)", () => {
  let link: string;

  it("pedido de recuperação: mesma resposta exista a conta ou não; 6º pedido na hora → 429", async () => {
    const known = check(
      "requestRecovery",
      await flow.request("POST", "/api/v1/recovery-requests", { payload: { email: carla.email } }),
    );
    const unknown = await flow.request("POST", "/api/v1/recovery-requests", {
      payload: { email: "ninguem@example.test" },
    });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    for (let i = 0; i < 4; i += 1) {
      await flow.request("POST", "/api/v1/recovery-requests", {
        payload: { email: "ninguem@example.test" },
      });
    }
    const limited = check(
      "requestRecovery",
      await flow.request("POST", "/api/v1/recovery-requests", {
        payload: { email: "ninguem@example.test" },
      }),
    );
    expect(limited.statusCode).toBe(429);
  });

  it("fila de pedidos e busca exata de conta; detalhe com vínculos e pedidos pendentes", async () => {
    const queue = check("listRecoveryRequests", await panel("GET", "/api/v1/recovery-requests"));
    expect(queue.json<{ items: { email: string; accountId: string | null }[] }>().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: carla.email, accountId: carla.id }),
      ]),
    );
    const partial = check(
      "findAccounts",
      await panel("GET", "/api/v1/accounts?email=carla%40example"),
    );
    expect(partial.statusCode).toBe(422);
    const found = check(
      "findAccounts",
      await panel("GET", "/api/v1/accounts?email=CARLA%40example.test"),
    );
    expect(found.json<{ items: { accountId: string }[] }>().items.map((i) => i.accountId)).toEqual([
      carla.id,
    ]);
    const detail = check("getAccount", await panel("GET", `/api/v1/accounts/${carla.id}`));
    const body = detail.json<{
      account: { accountId: string; status: string };
      memberships: { instanceId: string }[];
      pendingRecoveryRequests: number;
    }>();
    expect(body.account).toMatchObject({ accountId: carla.id, status: "ativa" });
    expect(body.memberships.map((m) => m.instanceId)).toContain(a.id);
    expect(body.pendingRecoveryRequests).toBe(1);
  });

  it("link gerado pelo administrador exige reautenticação, vale 30 min e o novo invalida o anterior", async () => {
    env.clock.advance(6 * MIN);
    const stale = check(
      "issuePasswordReset",
      await panel("POST", `/api/v1/accounts/${carla.id}/password-reset`),
    );
    expect(stale.statusCode).toBe(403);
    await flow.reauth(admin);
    const first = check(
      "issuePasswordReset",
      await panel("POST", `/api/v1/accounts/${carla.id}/password-reset`),
    );
    expect(first.statusCode).toBe(201);
    const body = first.json<{ link: string; expiresAt: string }>();
    expect(new Date(body.expiresAt).getTime() - env.clock.now().getTime()).toBe(30 * MIN);
    const second = await panel("POST", `/api/v1/accounts/${carla.id}/password-reset`);
    link = second.json<{ link: string }>().link;
    const oldToken = body.link.slice(body.link.lastIndexOf("/") + 1);
    const old = check(
      "completePasswordReset",
      await flow.request("POST", `/api/v1/password-resets/${oldToken}`, {
        payload: { password: "nova senha da carla" },
      }),
    );
    expect(old.statusCode).toBe(404);
    const queue = await panel("GET", "/api/v1/recovery-requests");
    expect(queue.json<{ items: { email: string }[] }>().items.map((i) => i.email)).not.toContain(
      carla.email,
    );
  });

  it("troca de senha incrementa a revisão e encerra sessões do Core e de produto em A e B", async () => {
    const tokens = await productTokens();
    const token = link.slice(link.lastIndexOf("/") + 1);
    const weak = check(
      "completePasswordReset",
      await flow.request("POST", `/api/v1/password-resets/${token}`, {
        payload: { password: "curta" },
      }),
    );
    expect(weak.statusCode).toBe(422);
    const done = check(
      "completePasswordReset",
      await flow.request("POST", `/api/v1/password-resets/${token}`, {
        payload: { password: "nova senha da carla" },
      }),
    );
    expect(done.json<{ instances: { status: string }[] }>().instances.map((i) => i.status)).toEqual(
      ["aplicada", "aplicada"],
    );
    expect(await productA.validate(tokens.a, env.clock.now())).toBeNull();
    expect(await productB.validate(tokens.b, env.clock.now())).toBeNull();
    const again = await flow.request("POST", `/api/v1/password-resets/${token}`, {
      payload: { password: "outra senha qualquer" },
    });
    expect(again.statusCode).toBe(404);
    const { rows } = await sql<{ auth_revision: number }>`SELECT auth_revision FROM account
       WHERE id = ${uuidToBin(carla.id)}`.execute(env.ctx.identity);
    expect(rows[0]?.auth_revision).toBe(2);
    carla.password = "nova senha da carla";
    expect((await productA.login(carla.email, carla.password, "198.51.100.51")).status).toBe(201);
  });

  it("link vence em 30 min", async () => {
    await flow.reauth(admin);
    const issued = await panel("POST", `/api/v1/accounts/${carla.id}/password-reset`);
    const token = issued.json<{ link: string }>().link.split("/").pop() ?? "";
    env.clock.advance(31 * MIN);
    const late = await flow.request("POST", `/api/v1/password-resets/${token}`, {
      payload: { password: "senha tardia longa" },
    });
    expect(late.statusCode).toBe(404);
    // 31 min sem atividade também encerram a sessão do administrador (30 min): entra de novo.
    flow.nextStep();
    const relogin = await flow.login(admin.email, admin.password);
    await flow.mfa(relogin.cookie ?? "", { code: flow.code(admin.secret) });
    admin.cookie = relogin.cookie ?? "";
  });
});

describe("US5 — bloqueio global (FR-022, SC-012)", () => {
  it("prévia lista A e B; bloqueio exige motivo, reautenticação e Idempotency-Key", async () => {
    const preview = check(
      "previewBlock",
      await panel("GET", `/api/v1/accounts/${carla.id}/block-preview`),
    );
    expect(
      preview
        .json<{ instances: { instanceId: string }[] }>()
        .instances.map((i) => i.instanceId)
        .sort(),
    ).toEqual([a.id, b.id].sort());

    const tokens = await productTokens();
    env.clock.advance(6 * MIN);
    const stale = check(
      "blockAccount",
      await panel(
        "POST",
        `/api/v1/accounts/${carla.id}/block`,
        { reason: "incidente" },
        crypto.randomUUID(),
      ),
    );
    expect(stale.statusCode).toBe(403);
    await flow.reauth(admin);
    expect(
      (await panel("POST", `/api/v1/accounts/${carla.id}/block`, { reason: "incidente" }, null))
        .statusCode,
    ).toBe(422);
    const blocked = check(
      "blockAccount",
      await panel(
        "POST",
        `/api/v1/accounts/${carla.id}/block`,
        { reason: "incidente" },
        crypto.randomUUID(),
      ),
    );
    expect(
      blocked.json<{ instances: { instanceId: string; status: string }[] }>().instances,
    ).toEqual(
      expect.arrayContaining([
        { instanceId: a.id, status: "aplicada" },
        { instanceId: b.id, status: "aplicada" },
      ]),
    );
    expect(await productA.validate(tokens.a, env.clock.now())).toBeNull();
    expect(await productB.validate(tokens.b, env.clock.now())).toBeNull();
    expect((await productA.login(carla.email, carla.password, "198.51.100.52")).status).toBe(401);
  });

  it("desbloqueio exige estado bloqueado e não reabre sessões antigas", async () => {
    await flow.reauth(admin);
    const unblocked = check(
      "unblockAccount",
      await panel(
        "POST",
        `/api/v1/accounts/${carla.id}/unblock`,
        { reason: "incidente resolvido" },
        crypto.randomUUID(),
      ),
    );
    expect(unblocked.statusCode).toBe(200);
    const { rows } = await sql<{ account_status: string }>`SELECT account_status FROM access_member
       WHERE account_id = ${uuidToBin(carla.id)}`.execute(env.ctx.access(a.accessDatabaseName));
    expect(rows.every((r) => r.account_status === "ativa")).toBe(true);
    const again = check(
      "unblockAccount",
      await panel(
        "POST",
        `/api/v1/accounts/${carla.id}/unblock`,
        { reason: "de novo" },
        crypto.randomUUID(),
      ),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "CONFLICT_STATE" } });
    expect((await productA.login(carla.email, carla.password, "198.51.100.53")).status).toBe(201);
  });

  it("bloquear o último administrador da plataforma → 409", async () => {
    await flow.reauth(admin);
    const self = (await panel("GET", "/api/v1/session")).json<{ account: { id: string } }>().account
      .id;
    const refused = check(
      "blockAccount",
      await panel(
        "POST",
        `/api/v1/accounts/${self}/block`,
        { reason: "teste" },
        crypto.randomUUID(),
      ),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: "CONFLICT_LAST_ADMIN" } });
  });

  it("administrador local não tem rota para bloquear nem redefinir senha", async () => {
    const credential = await appCredential(env);
    for (const path of ["block", "password-reset", "unblock"]) {
      const response = await app.app.inject({
        method: "POST",
        url: `/internal/v1/instances/${a.slug}/accounts/${carla.id}/${path}`,
        headers: { authorization: `Bearer ${credential}` },
        payload: { reason: "tentativa" },
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
