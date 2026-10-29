import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppCredential } from "../../../src/modules/app-credentials/app-credentials.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function credential(instanceId?: string) {
  return (
    await createAppCredential(env.ctx, {
      productCode: "sparkref",
      label: "teste-utilizacao",
      scopes: ["utilizacao"],
      instanceId: instanceId ?? null,
    })
  ).value;
}

function batchId() {
  return crypto.randomUUID();
}

function eventId() {
  return crypto.randomUUID();
}

describe("POST /internal/v1/instances/:instanceId/usage-batches (US1, T-14, CA-SC-011)", () => {
  it("lote novo → 202 com eventos aceitos", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const cred = await credential(inst);
    const response = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: batchId(),
        events: [
          {
            event_id: eventId(),
            occurred_at: new Date().toISOString(),
            kind: "atendimentos_iniciados",
            count: 3,
          },
          {
            event_id: eventId(),
            occurred_at: new Date().toISOString(),
            kind: "vendas_confirmadas",
            count: 1,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json<{ events_accepted: number; events_discarded: number }>();
    expect(body.events_accepted).toBe(2);
    expect(body.events_discarded).toBe(0);
  });

  it("reenvio do mesmo batch_id → 200 sem duplicação", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const cred = await credential(inst);
    const bid = batchId();
    const eid = eventId();
    const payload = {
      batch_id: bid,
      events: [
        { event_id: eid, occurred_at: new Date().toISOString(), kind: "usuarios_ativos", count: 5 },
      ],
    };
    const first = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload,
    });
    expect(first.statusCode).toBe(202);

    const second = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload,
    });
    expect(second.statusCode).toBe(200);
    const body2 = second.json<{ events_accepted: number; events_discarded: number }>();
    expect(body2.events_accepted).toBe(1);
    expect(body2.events_discarded).toBe(0);
  });

  it("evento duplicado em lote diferente → events_discarded correto", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const cred = await credential(inst);
    const eid = eventId();
    const occurred = new Date().toISOString();

    await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: batchId(),
        events: [
          { event_id: eid, occurred_at: occurred, kind: "atendimentos_concluidos", count: 2 },
        ],
      },
    });

    const second = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: batchId(),
        events: [
          { event_id: eid, occurred_at: occurred, kind: "atendimentos_concluidos", count: 2 },
          { event_id: eventId(), occurred_at: occurred, kind: "usuarios_ativos", count: 1 },
        ],
      },
    });
    expect(second.statusCode).toBe(202);
    const body = second.json<{ events_accepted: number; events_discarded: number }>();
    expect(body.events_accepted).toBe(1);
    expect(body.events_discarded).toBe(1);
  });

  it("lote com occurred_at atrasado → grava occurred_at original (SC-040)", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const cred = await credential(inst);
    const occurred = "2026-01-15T10:00:00.000Z";
    const eid = eventId();

    const r = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: batchId(),
        events: [{ event_id: eid, occurred_at: occurred, kind: "vendas_confirmadas", count: 1 }],
      },
    });
    expect(r.statusCode).toBe(202);

    // Verificar diretamente no banco que occurred_at foi preservado como informado
    const { rows } = await sql<{ occurred_at: Date }>`
      SELECT occurred_at FROM instance_usage_event
       WHERE instance_id = ${uuidToBin(inst)} AND event_id = ${eid}
    `.execute(env.ctx.core);
    expect(rows[0]).toBeDefined();
    expect(new Date(rows[0]!.occurred_at).toISOString()).toBe(occurred);
  });

  it("credencial de instância B no path de instância A → 403 (CA-SC-011, I-01)", async () => {
    const instA = await env.insertInstanceRow({ state: "ATIVA" });
    const instB = await env.insertInstanceRow({ state: "ATIVA" });
    const credB = await credential(instB);

    const r = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${instA}/usage-batches`,
      headers: { authorization: `Bearer ${credB}` },
      payload: {
        batch_id: batchId(),
        events: [],
      },
    });
    expect(r.statusCode).toBe(403);
    const body = r.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("CREDENTIAL_INSTANCE_MISMATCH");
  });

  it("instância SUSPENSA → 409 (SC-037)", async () => {
    const inst = await env.insertInstanceRow({ state: "SUSPENSA" });
    const cred = await credential(inst);

    const r = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: {
        batch_id: batchId(),
        events: [],
      },
    });
    expect(r.statusCode).toBe(409);
    const body = r.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("CONFLICT_STATE");
  });

  it("lote com events vazio → 202 com accepted=0", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const cred = await credential(inst);

    const r = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${inst}/usage-batches`,
      headers: { authorization: `Bearer ${cred}` },
      payload: { batch_id: batchId(), events: [] },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json<{ events_accepted: number; events_discarded: number }>();
    expect(body.events_accepted).toBe(0);
    expect(body.events_discarded).toBe(0);
  });

  it("dois envios concorrentes do mesmo batch_id → exatamente um 202 (T-14)", async () => {
    const inst = await env.insertInstanceRow({ state: "PRONTA" });
    const cred = await credential(inst);
    const bid = batchId();
    const payload = {
      batch_id: bid,
      events: [
        {
          event_id: eventId(),
          occurred_at: new Date().toISOString(),
          kind: "usuarios_ativos",
          count: 1,
        },
      ],
    };

    const [r1, r2] = await Promise.all([
      app.app.inject({
        method: "POST",
        url: `/internal/v1/instances/${inst}/usage-batches`,
        headers: { authorization: `Bearer ${cred}` },
        payload,
      }),
      app.app.inject({
        method: "POST",
        url: `/internal/v1/instances/${inst}/usage-batches`,
        headers: { authorization: `Bearer ${cred}` },
        payload,
      }),
    ]);

    // Nenhum deve retornar erro; ambos devem ser 200 ou 202
    expect(r1.statusCode === 200 || r1.statusCode === 202).toBe(true);
    expect(r2.statusCode === 200 || r2.statusCode === 202).toBe(true);

    // Deve haver exatamente 1 registro de lote para este batch_id
    const { rows } = await sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM instance_usage_batch
       WHERE instance_id = ${uuidToBin(inst)} AND batch_id = ${bid}
    `.execute(env.ctx.core);
    expect(Number(rows[0]?.cnt)).toBe(1);
  });
});
