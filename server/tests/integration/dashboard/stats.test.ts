import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidToBin } from "../../../src/platform/ids.js";
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
  admin = await flow.admin("admin-dashboard@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("GET /api/v1/dashboard/stats (US2, SC-038/039)", () => {
  it("retorna todos os campos obrigatórios com tipos corretos", async () => {
    const r = await flow.request("GET", "/api/v1/dashboard/stats", { cookie: admin.cookie });
    expect(r.statusCode).toBe(200);
    const body = r.json<{
      instances_by_state: Record<string, number>;
      pending_provisionings: number;
      failed_provisionings: number;
      instances_without_recent_usage: { last7d: number; last30d: number };
      instances_without_any_data: number;
      instances_with_telemetry_delay: number;
      instances_with_schema_issue: number;
      cleanup_last_run: string | null;
      cleanup_last_count: number | null;
      calculated_at: string;
    }>();
    expect(body.instances_by_state).toBeTypeOf("object");
    expect(body.pending_provisionings).toBeTypeOf("number");
    expect(body.failed_provisionings).toBeTypeOf("number");
    expect(typeof body.instances_without_recent_usage.last7d).toBe("number");
    expect(typeof body.instances_without_recent_usage.last30d).toBe("number");
    expect(body.instances_without_any_data).toBeTypeOf("number");
    expect(body.instances_with_telemetry_delay).toBeTypeOf("number");
    expect(body.instances_with_schema_issue).toBeTypeOf("number");
    expect(typeof body.cleanup_last_run === "string" || body.cleanup_last_run === null).toBe(true);
    expect(typeof body.cleanup_last_count === "number" || body.cleanup_last_count === null).toBe(
      true,
    );
    expect(new Date(body.calculated_at).getTime()).toBeGreaterThan(0);
  });

  it("instances_without_any_data conta instância ATIVA sem eventos", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });

    const r = await flow.request("GET", "/api/v1/dashboard/stats", { cookie: admin.cookie });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ instances_without_any_data: number }>();
    // A instância sem eventos deve incrementar o contador
    expect(body.instances_without_any_data).toBeGreaterThan(0);
    // Confirmar que a instância criada não tem eventos
    const { rows } = await sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM instance_usage_event
       WHERE instance_id = ${uuidToBin(inst)}
    `.execute(env.ctx.core);
    expect(Number(rows[0]?.cnt)).toBe(0);
  });

  it("instances_with_telemetry_delay detecta lote antigo (received_at - occurred_at > 24h)", async () => {
    const inst = await env.insertInstanceRow({ state: "ATIVA" });
    const now = env.clock.now();
    const oldOccurred = new Date(now.getTime() - 49 * 60 * 60 * 1000); // 49h atrás
    const eid = crypto.randomUUID();

    // Inserir evento com occurred_at muito anterior ao received_at
    await sql`
      INSERT INTO instance_usage_event
        (id, instance_id, event_id, occurred_at, received_at, kind, count)
      VALUES (${uuidToBin(crypto.randomUUID())}, ${uuidToBin(inst)}, ${eid},
              ${oldOccurred}, ${now}, 'usuarios_ativos', 1)
    `.execute(env.ctx.core);

    const r = await flow.request("GET", "/api/v1/dashboard/stats", { cookie: admin.cookie });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ instances_with_telemetry_delay: number }>();
    expect(body.instances_with_telemetry_delay).toBeGreaterThan(0);
  });

  it("sem sessão → 401", async () => {
    const r = await flow.request("GET", "/api/v1/dashboard/stats");
    expect(r.statusCode).toBe(401);
  });
});
