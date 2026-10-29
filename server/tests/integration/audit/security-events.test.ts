import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordSecurityEvent } from "../../../src/modules/identity/security-events.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-security-events@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function insertEvent(
  options: {
    type?: string;
    result?: "sucesso" | "falha" | "negado";
    instanceId?: string | null;
    actorAccountId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    createdAt?: Date;
  } = {},
) {
  const now = options.createdAt ?? env.clock.now();
  await recordSecurityEvent(env.ctx.identity, {
    type: (options.type ?? "login") as "login",
    actorKind: "usuario",
    actorAccountId: options.actorAccountId ?? null,
    instanceId: options.instanceId ?? null,
    result: options.result ?? "sucesso",
    ip: options.ip ?? "127.0.0.1",
    userAgent: options.userAgent ?? "TestAgent/1.0",
    at: now,
  });
}

describe("GET /api/v1/security-events (US3, SC-033, SC-035, CA-SC-011)", () => {
  it("listagem paginada retorna estrutura correta", async () => {
    await insertEvent({ result: "sucesso" });
    await insertEvent({ result: "falha" });

    const r = await flow.request("GET", "/api/v1/security-events?page=1&pageSize=10", {
      cookie: admin.cookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      items: unknown[];
      total: number;
      page: number;
      page_size: number;
    }>();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBeGreaterThanOrEqual(2);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(10);
  });

  it("filtro por result=falha retorna apenas falhas", async () => {
    await insertEvent({ result: "falha" });
    await insertEvent({ result: "sucesso" });

    const r = await flow.request("GET", "/api/v1/security-events?result=falha&pageSize=100", {
      cookie: admin.cookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ items: { result: string }[] }>();
    for (const item of body.items) {
      expect(item.result).toBe("falha");
    }
  });

  it("filtro por instance_id retorna apenas eventos da instância (T-04, CA-SC-011)", async () => {
    const instA = await env.insertInstanceRow({ state: "ATIVA" });
    const instB = await env.insertInstanceRow({ state: "ATIVA" });
    await insertEvent({ instanceId: instA, result: "sucesso" });
    await insertEvent({ instanceId: instB, result: "sucesso" });

    const response = await app.app.inject({
      method: "GET",
      url: `/api/v1/security-events?instance_id=${instA}&pageSize=100`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { instance_id: string | null }[] }>();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.instance_id).toBe(instA);
    }
  });

  it("CSV exportado contém cabeçalho e neutraliza fórmulas (SC-041)", async () => {
    await insertEvent({ result: "sucesso", userAgent: "=cmd|'/C calc'!A1" });

    const response = await app.app.inject({
      method: "GET",
      url: "/api/v1/security-events?pageSize=100",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
        accept: "text/csv",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const csv = response.body;
    expect(csv).toContain("Data/Hora");
    expect(csv).toContain("Tipo");
    expect(csv).toContain("Resultado");
    // Neutralização: células que começam com = são prefixadas com '
    expect(csv).not.toMatch(/(?:^|,)=cmd/m);
  });

  it("evento com ip NULL não falha serialização (SC-033 — pós-limpeza)", async () => {
    await sql`
      INSERT INTO security_event
        (id, type, actor_kind, result, ip, user_agent, created_at)
      VALUES (${uuidToBin(newId())}, 'login', 'usuario', 'sucesso', NULL, NULL, ${env.clock.now()})
    `.execute(env.ctx.identity);

    const r = await flow.request("GET", "/api/v1/security-events?pageSize=100", {
      cookie: admin.cookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ items: { ip: string | null }[] }>();
    const withNull = body.items.filter((i) => i.ip === null);
    expect(withNull.length).toBeGreaterThan(0);
  });

  it("SC-035: não há rota PUT ou DELETE para security_event", async () => {
    const putR = await app.app.inject({
      method: "PUT",
      url: "/api/v1/security-events",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    const deleteR = await app.app.inject({
      method: "DELETE",
      url: "/api/v1/security-events",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(putR.statusCode).toBe(404);
    expect(deleteR.statusCode).toBe(404);
  });

  it("sem sessão → 401", async () => {
    const r = await app.app.inject({
      method: "GET",
      url: "/api/v1/security-events",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(r.statusCode).toBe(401);
  });
});
