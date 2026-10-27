import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requestInstance } from "../../../src/modules/instances/request.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { requestBody, requester, runProvisioning, trackInstance } from "../../support/f02.js";

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

const actor = () => ({ accountId, correlationId: crypto.randomUUID() });
const ROUNDS = 100;

describe("solicitação repetida e concorrente (CS-003, T-01, CA-SC-005, COM-025, COM-026)", () => {
  it(`${ROUNDS} rodadas: mesma chave → mesma instância; chaves diferentes no mesmo slug → uma vence`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const body = requestBody();
      const key = crypto.randomUUID();
      const results = await Promise.allSettled([
        requestInstance(env.ctx, body, actor(), key),
        requestInstance(env.ctx, body, actor(), key),
        requestInstance(env.ctx, body, actor(), key),
        requestInstance(env.ctx, body, actor(), crypto.randomUUID()),
        requestInstance(env.ctx, body, actor(), crypto.randomUUID()),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
      const rejected = results
        .filter((r) => r.status === "rejected")
        .map((r) => (r.reason as { code?: string }).code);
      expect(new Set(ok.map((v) => v.instance.id)).size).toBe(1);
      expect(new Set(ok.map((v) => v.task.protocol)).size).toBe(1);
      expect(rejected.every((code) => code === "CONFLICT_SLUG_TAKEN")).toBe(true);
      const { rows } = await sql<{ instances: number; tasks: number }>`
        SELECT (SELECT COUNT(*) FROM instance WHERE slug = ${body.slug}) AS instances,
               (SELECT COUNT(*) FROM admin_task t JOIN instance i ON i.id = t.instance_id
                 WHERE i.slug = ${body.slug}) AS tasks`.execute(env.ctx.core);
      expect(rows[0]).toEqual({ instances: 1, tasks: 1 });
    }
  }, 300_000);

  it("mesma chave com corpo diferente → CONFLICT_IDEMPOTENCY_MISMATCH", async () => {
    const key = crypto.randomUUID();
    const body = requestBody();
    await requestInstance(env.ctx, body, actor(), key);
    await expect(
      requestInstance(env.ctx, { ...body, displayName: "Outro nome" }, actor(), key),
    ).rejects.toMatchObject({ code: "CONFLICT_IDEMPOTENCY_MISMATCH", statusCode: 409 });
  });

  it("reenvio após o provisionamento: um banco, um _acc, um usuário e um convite", async () => {
    const key = crypto.randomUUID();
    const body = requestBody();
    const first = await requestInstance(env.ctx, body, actor(), key);
    await trackInstance(env, first.instance.id);
    expect(await runProvisioning(env, first.task.id)).toBe("concluida");
    const again = await requestInstance(env.ctx, body, actor(), key);
    expect(again.instance.id).toBe(first.instance.id);
    expect(again.task.protocol).toBe(first.task.protocol);
    expect(await runProvisioning(env, first.task.id)).toBeNull();

    const hex = first.instance.id.replaceAll("-", "");
    const provisioner = await env.mysql.connect("provisioner");
    const [dbs] = await provisioner.query(
      "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
      [`sparkref\\_${hex}%`],
    );
    expect((dbs as { name: string }[]).map((d) => d.name).sort()).toEqual([
      `sparkref_${hex}`,
      `sparkref_${hex}_acc`,
    ]);
    const { rows: resources } = await sql<{ n: number }>`SELECT COUNT(*) AS n
       FROM instance_resource WHERE instance_id = ${uuidToBin(first.instance.id)}`.execute(
      env.ctx.core,
    );
    expect(Number(resources[0]?.n)).toBe(3);
    const { rows: invites } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM invitation
       WHERE instance_id = ${uuidToBin(first.instance.id)}`.execute(env.ctx.identity);
    expect(Number(invites[0]?.n)).toBe(1);
  });
});
