import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app/build-app.js";
import { SystemStatusService } from "../../src/modules/system/probe.js";
import { registerSystemRoutes } from "../../src/modules/system/routes.js";
import { PoolRegistry } from "../../src/platform/db/pools.js";
import { newId, uuidToBin } from "../../src/platform/ids.js";
import { createLogger } from "../../src/platform/logging/logger.js";
import { MysqlTestContext } from "../support/mysql.js";

let ctx: MysqlTestContext;
const workerId = newId();
const pools: PoolRegistry[] = [];

async function appWith(port?: number) {
  const config = port === undefined ? ctx.config : { ...ctx.config, MYSQL_PORT: port };
  const registry = new PoolRegistry(config);
  pools.push(registry);
  const app = await buildApp({
    config,
    logger: createLogger({ level: "silent" }),
    register: (instance) =>
      registerSystemRoutes(instance, new SystemStatusService(config, registry)),
  });
  await app.ready();
  return app;
}

const FORBIDDEN = /SELECT|INSERT|spark_core_web|password|\n\s+at /i;

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
  // Sinal de vida de um trabalhador sintético, removido no fim.
  const worker = await ctx.connect("worker", "spark_core");
  await worker.query(
    `INSERT INTO worker_heartbeat (worker_id, hostname, app_version, started_at, last_seen_at)
     VALUES (?, 'teste', '0.0.0', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
    [uuidToBin(workerId)],
  );
});

afterAll(async () => {
  const worker = await ctx.connect("worker", "spark_core");
  await worker.query("DELETE FROM worker_heartbeat WHERE worker_id = ?", [uuidToBin(workerId)]);
  await Promise.all(pools.map((p) => p.closeAll()));
  await ctx?.cleanup();
});

describe("GET /api/v1/system/status", () => {
  it("com MySQL saudável responde 200 e quatro componentes", async () => {
    const app = await appWith();
    const response = await app.inject({ method: "GET", url: "/api/v1/system/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      status: string;
      components: { name: string; status: string }[];
    }>();
    expect(body.status).toBe("SAUDAVEL");
    expect(body.components.map((c) => [c.name, c.status])).toEqual([
      ["server", "SAUDAVEL"],
      ["worker", "SAUDAVEL"],
      ["spark_core", "SAUDAVEL"],
      ["spark_identity", "SAUDAVEL"],
    ]);
    expect(response.headers["x-correlation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  it("com banco inacessível responde 503, Retry-After e DB_UNREACHABLE sem detalhes internos", async () => {
    const app = await appWith(1);
    const response = await app.inject({ method: "GET", url: "/api/v1/system/status" });
    expect(response.statusCode).toBe(503);
    expect(response.headers["retry-after"]).toBe("10");
    const body = response.json<{ components: { name: string; reason: string | null }[] }>();
    const reasons = Object.fromEntries(body.components.map((c) => [c.name, c.reason]));
    expect(reasons.spark_core).toBe("DB_UNREACHABLE");
    expect(reasons.spark_identity).toBe("DB_UNREACHABLE");
    expect(response.body).not.toMatch(FORBIDDEN);
    await app.close();
  });
});

describe("GET /health/live", () => {
  it("responde 200 mesmo com banco indisponível", async () => {
    const app = await appWith(1);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});
