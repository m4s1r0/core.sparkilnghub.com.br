import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppCredential } from "../../../src/modules/app-credentials/app-credentials.js";
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
  admin = await flow.admin("admin-usage-report@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function insertUsageEvent(options: {
  instanceId: string;
  eventId?: string;
  occurredAt: Date;
  receivedAt?: Date;
  kind?: string;
  count?: number;
}) {
  const receivedAt = options.receivedAt ?? env.clock.now();
  await sql`
    INSERT INTO instance_usage_event
      (id, instance_id, event_id, occurred_at, received_at, kind, count)
    VALUES (${uuidToBin(newId())}, ${uuidToBin(options.instanceId)}, ${options.eventId ?? crypto.randomUUID()},
            ${options.occurredAt}, ${receivedAt}, ${options.kind ?? "atendimentos_iniciados"},
            ${options.count ?? 1})
  `.execute(env.ctx.core);
}

function credentialFor(instanceId: string) {
  return createAppCredential(env.ctx, {
    productCode: "sparkref",
    label: "teste-report",
    scopes: ["utilizacao"],
    instanceId,
  }).then((c) => c.value);
}

describe("relatórios de utilização (US5, CA-SC-012, SC-040)", () => {
  it("GET /api/v1/instances/:id/usage — instância com dados → contagens corretas", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const from = "2026-01-01";
    const to = "2026-01-31";

    await insertUsageEvent({
      instanceId: inst,
      occurredAt: new Date("2026-01-15T10:00:00Z"),
      receivedAt: new Date("2026-01-15T10:05:00Z"),
      kind: "atendimentos_iniciados",
      count: 3,
    });
    await insertUsageEvent({
      instanceId: inst,
      occurredAt: new Date("2026-01-15T11:00:00Z"),
      receivedAt: new Date("2026-01-15T11:05:00Z"),
      kind: "atendimentos_iniciados",
      count: 2,
    });
    await insertUsageEvent({
      instanceId: inst,
      occurredAt: new Date("2026-01-20T09:00:00Z"),
      receivedAt: new Date("2026-01-20T09:05:00Z"),
      kind: "vendas_confirmadas",
      count: 1,
    });

    const response = await app.app.inject({
      method: "GET",
      url: `/api/v1/instances/${inst}/usage?from=${from}&to=${to}`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      instance_id: string;
      period_start: string;
      period_end: string;
      events: { kind: string; count: number }[];
      data_status: string;
    }>();
    expect(body.instance_id).toBe(inst);
    expect(body.period_start).toBe(from);
    expect(body.data_status).toBe("ok");
    const atendimentos = body.events.find((e) => e.kind === "atendimentos_iniciados");
    expect(atendimentos?.count).toBe(5);
    const vendas = body.events.find((e) => e.kind === "vendas_confirmadas");
    expect(vendas?.count).toBe(1);
  });

  it("GET /api/v1/instances/:id/usage — instância sem dados → dados_insuficientes (CA-SC-012)", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });

    const response = await app.app.inject({
      method: "GET",
      url: `/api/v1/instances/${inst}/usage?from=2026-01-01&to=2026-01-31`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ data_status: string; events: unknown[] }>();
    expect(body.data_status).toBe("dados_insuficientes");
    expect(body.events).toHaveLength(0);
  });

  it("evento atrasado → aparece no período de ocorrência (SC-040)", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    // occurred_at em janeiro, received_at em fevereiro (chegou tarde)
    await insertUsageEvent({
      instanceId: inst,
      occurredAt: new Date("2026-01-10T08:00:00Z"),
      receivedAt: new Date("2026-02-01T12:00:00Z"),
      kind: "usuarios_ativos",
      count: 10,
    });

    // Consulta pelo período de ocorrência (janeiro)
    const r = await app.app.inject({
      method: "GET",
      url: `/api/v1/instances/${inst}/usage?from=2026-01-01&to=2026-01-31`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ events: { kind: string; count: number }[]; data_status: string }>();
    const ua = body.events.find((e) => e.kind === "usuarios_ativos");
    expect(ua?.count).toBe(10);
    // Evento com received muito depois do occurred → atraso detectado
    expect(body.data_status).toBe("atraso_detectado");
  });

  it("relote não duplica contagem", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const eid = crypto.randomUUID();
    const occurred = new Date("2026-01-12T10:00:00Z");

    // Inserir via endpoint (usando credencial) para testar deduplicação real
    const cred = await credentialFor(inst);
    const bid = crypto.randomUUID();
    await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: bid,
        events: [
          {
            event_id: eid,
            occurred_at: occurred.toISOString(),
            kind: "atendimentos_concluidos",
            count: 7,
          },
        ],
      },
    });
    // Reenvio do mesmo batch
    await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: bid,
        events: [
          {
            event_id: eid,
            occurred_at: occurred.toISOString(),
            kind: "atendimentos_concluidos",
            count: 7,
          },
        ],
      },
    });

    const r = await app.app.inject({
      method: "GET",
      url: `/api/v1/instances/${inst}/usage?from=2026-01-01&to=2026-01-31`,
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
      },
    });
    const body = r.json<{ events: { kind: string; count: number }[] }>();
    const concluidos = body.events.find((e) => e.kind === "atendimentos_concluidos");
    // Deve contar apenas 7, não 14 (sem duplicação)
    expect(concluidos?.count).toBe(7);
  });

  it("GET /api/v1/usage — exportação CSV com cabeçalho correto (SC-041)", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    await insertUsageEvent({
      instanceId: inst,
      occurredAt: new Date("2026-01-10T08:00:00Z"),
      kind: "usuarios_ativos",
      count: 2,
    });

    const response = await app.app.inject({
      method: "GET",
      url: "/api/v1/usage?from=2026-01-01&to=2026-01-31",
      headers: {
        "sec-fetch-site": "same-origin",
        cookie: `sparkcore_session=${admin.cookie}`,
        accept: "text/csv",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const csv = response.body;
    expect(csv.length).toBeGreaterThan(0);
  });
});
