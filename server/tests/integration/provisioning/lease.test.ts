import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimTask,
  LEASE_MS,
  renewLease,
  startStepRun,
} from "../../../src/modules/provisioning/tasks.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, stepRuns, taskRow } from "../../support/f02.js";

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

describe("lease e tarefa única por instância (SC-022, RN-SC-002, NFR-014)", () => {
  it("dois trabalhadores disputando a mesma tarefa: só um obtém o lease", async () => {
    const { taskId } = await requestViaService(env, accountId);
    const [a, b] = await Promise.all([
      claimTask(env.ctx, newId(), taskId),
      claimTask(env.ctx, newId(), taskId),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimTask(env.ctx, newId(), taskId)).toBeNull();
  });

  it("heartbeat renova o lease; outro trabalhador não renova nem assume antes de vencer", async () => {
    const { taskId } = await requestViaService(env, accountId);
    const owner = newId();
    const claimed = await claimTask(env.ctx, owner, taskId);
    if (!claimed) throw new Error("sem lease");
    env.clock.advance(20_000);
    expect(await renewLease(env.ctx, taskId, owner)).toBe(true);
    expect(await renewLease(env.ctx, taskId, newId())).toBe(false);
    const row = await taskRow(env, taskId);
    expect(row.lease_until?.getTime()).toBe(env.clock.now().getTime() + LEASE_MS);
    env.clock.advance(LEASE_MS - 1_000);
    expect(await claimTask(env.ctx, newId(), taskId)).toBeNull();
  });

  it("lease vencido: outro trabalhador assume e a tentativa aberta vira interrompida", async () => {
    const { taskId } = await requestViaService(env, accountId);
    const first = await claimTask(env.ctx, newId(), taskId);
    if (!first) throw new Error("sem lease");
    await startStepRun(env.ctx, first, "criar_bancos", first.workerId ?? newId());
    env.clock.advance(LEASE_MS + 1_000);
    const second = newId();
    const taken = await claimTask(env.ctx, second, taskId);
    expect(taken?.workerId).toBe(second);
    const runs = await stepRuns(env, taskId);
    expect(runs.find((r) => r.step === "criar_bancos")?.status).toBe("interrompida");
  });

  it("segunda tarefa estrutural ativa para a mesma instância é recusada pelo índice único", async () => {
    const { instanceId } = await requestViaService(env, accountId);
    await expect(
      sql`INSERT INTO admin_task (id, instance_id, kind, status, run_number, attempt,
            next_attempt_at, artifact_code, artifact_version, manifest_sha256, requested_by,
            idempotency_key, request_hash, created_at)
          VALUES (${uuidToBin(newId())}, ${uuidToBin(instanceId)}, 'provisionamento', 'pendente',
                  1, 0, UTC_TIMESTAMP(6), 'sparkref', 2, ${"0".repeat(64)},
                  ${uuidToBin(accountId)}, ${crypto.randomUUID()}, ${"0".repeat(64)},
                  UTC_TIMESTAMP(6))`.execute(env.ctx.core),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });
});
