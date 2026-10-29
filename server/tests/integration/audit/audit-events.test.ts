import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "../../../src/modules/audit/audit.js";
import { newId } from "../../../src/platform/ids.js";
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
  admin = await flow.admin("admin-audit-events@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function insertAuditEvent(
  options: {
    action?: string;
    objectType?: string;
    objectId?: string;
    actorId?: string | null;
    changes?: Record<string, readonly [unknown, unknown]>;
    reason?: string | null;
  } = {},
) {
  const now = env.clock.now();
  await recordAudit(env.ctx.core, {
    actorKind: options.actorId ? "usuario" : "sistema",
    actorId: options.actorId ?? null,
    action: (options.action ?? "instancia.transicao") as "instancia.transicao",
    objectType: (options.objectType ?? "instancia") as "instancia",
    objectId: options.objectId ?? newId(),
    ...(options.changes !== undefined ? { changes: options.changes } : {}),
    reason: options.reason ?? null,
    at: now,
  });
}

describe("GET /api/v1/audit-events (US4, CA-SC-010, SC-035)", () => {
  it("listagem paginada retorna estrutura correta", async () => {
    await insertAuditEvent({ objectType: "instancia" });
    await insertAuditEvent({ objectType: "produto" });

    const r = await flow.request("GET", "/api/v1/audit-events?page=1&pageSize=10", {
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

  it("filtro por object_type retorna apenas eventos do tipo", async () => {
    await insertAuditEvent({ objectType: "contratante" });
    await insertAuditEvent({ objectType: "produto" });

    const response = await app.app.inject({
      method: "GET",
      url: "/api/v1/audit-events?object_type=contratante&pageSize=100",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { object_type: string }[] }>();
    for (const item of body.items) {
      expect(item.object_type).toBe("contratante");
    }
  });

  it("CSV exportado contém cabeçalho e neutraliza fórmulas (SC-041)", async () => {
    await insertAuditEvent({
      objectType: "instancia",
      reason: "=SUM(1+1)",
    });

    const response = await app.app.inject({
      method: "GET",
      url: "/api/v1/audit-events?pageSize=100",
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
    expect(csv).toContain("Ação");
    expect(csv).toContain("Entidade");
    // Neutralização: células que começam com = são prefixadas com '
    expect(csv).not.toMatch(/(?:^|,)=SUM/m);
  });

  it("CA-SC-010: ator inativado não quebra serialização", async () => {
    // Inserir evento com actor_id cujo account foi marcado como inativo
    const account = await env.insertAccount({ status: "inativa" });
    await insertAuditEvent({
      actorId: account.id,
      action: "produto.editado",
      objectType: "produto",
    });

    const response = await app.app.inject({
      method: "GET",
      url: `/api/v1/audit-events?object_type=produto&pageSize=100`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: { actor_id: string | null }[] }>();
    const withActor = body.items.find((i) => i.actor_id === account.id);
    expect(withActor).toBeDefined();
  });

  it("SC-035: não há rota PUT ou DELETE para audit-events", async () => {
    const putR = await app.app.inject({
      method: "PUT",
      url: "/api/v1/audit-events",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    const deleteR = await app.app.inject({
      method: "DELETE",
      url: "/api/v1/audit-events",
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
      url: "/api/v1/audit-events",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(r.statusCode).toBe(401);
  });
});
