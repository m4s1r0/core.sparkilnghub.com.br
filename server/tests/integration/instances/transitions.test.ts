import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import {
  activateSyntheticInstance,
  transition,
} from "../../../src/modules/instances/transitions.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

const system = { kind: "sistema" as const, id: null };

async function transitions(instanceId: string) {
  const { rows } = await sql<{
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    task_id: Buffer | null;
  }>`SELECT from_state, to_state, actor_kind, task_id FROM instance_transition
      WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY created_at, id`.execute(env.ctx.core);
  return rows;
}

describe("transições de estado da instância (R-02, RN-SC-001)", () => {
  it("aceita as transições de F02 e registra cada uma na mesma transação", async () => {
    const id = await env.insertInstanceRow({ state: "CADASTRADA" });
    const taskId = newId();
    for (const [from, to] of [
      ["CADASTRADA", "PROVISIONANDO"],
      ["PROVISIONANDO", "FALHA_PROVISIONAMENTO"],
      ["FALHA_PROVISIONAMENTO", "PROVISIONANDO"],
      ["PROVISIONANDO", "PRONTA"],
    ] as const) {
      await env.ctx.core.transaction().execute((trx) =>
        transition(trx, {
          instanceId: id,
          from,
          to,
          actor: system,
          reason: null,
          taskId,
          at: env.clock.now(),
        }),
      );
    }
    expect((await getInstance(env.ctx, id))?.state).toBe("PRONTA");
    const rows = await transitions(id);
    expect(rows.map((r) => [r.from_state, r.to_state])).toEqual([
      ["CADASTRADA", "PROVISIONANDO"],
      ["PROVISIONANDO", "FALHA_PROVISIONAMENTO"],
      ["FALHA_PROVISIONAMENTO", "PROVISIONANDO"],
      ["PROVISIONANDO", "PRONTA"],
    ]);
    expect(
      rows.every((r) => r.actor_kind === "sistema" && r.task_id?.equals(uuidToBin(taskId))),
    ).toBe(true);
  });

  it("estado diferente do esperado → CONFLICT_STATE sem gravar nada", async () => {
    const id = await env.insertInstanceRow({ state: "PRONTA" });
    await expect(
      env.ctx.core.transaction().execute((trx) =>
        transition(trx, {
          instanceId: id,
          from: "PROVISIONANDO",
          to: "FALHA_PROVISIONAMENTO",
          actor: system,
          reason: null,
          at: env.clock.now(),
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT_STATE", statusCode: 409 });
    expect((await getInstance(env.ctx, id))?.state).toBe("PRONTA");
    expect(await transitions(id)).toEqual([]);
  });

  it("recusa transição fora da máquina de F02", async () => {
    const id = await env.insertInstanceRow({ state: "PRONTA" });
    await expect(
      env.ctx.core.transaction().execute((trx) =>
        transition(trx, {
          instanceId: id,
          from: "PRONTA",
          to: "SUSPENSA",
          actor: system,
          reason: null,
          at: env.clock.now(),
        }),
      ),
    ).rejects.toThrow(/não permitida/);
  });

  it("duas transições concorrentes a partir do mesmo estado: exatamente uma vence", async () => {
    const id = await env.insertInstanceRow({ state: "CADASTRADA" });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        env.ctx.core.transaction().execute((trx) =>
          transition(trx, {
            instanceId: id,
            from: "CADASTRADA",
            to: "PROVISIONANDO",
            actor: system,
            reason: null,
            at: env.clock.now(),
          }),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT_STATE" });
    expect(await transitions(id)).toHaveLength(1);
  });

  it("activateSyntheticInstance exige instância sintética PRONTA com administrador ativo", async () => {
    const created = await env.createInstance("ativacao-sintetica");
    const withoutAdmin = created.id;
    await sql`UPDATE instance SET state = 'PRONTA' WHERE id = ${uuidToBin(withoutAdmin)}`.execute(
      env.ctx.core,
    );
    const access = env.ctx.access(created.accessDatabaseName);
    await sql`UPDATE access_instance SET state = 'pronta'`.execute(access);
    await expect(activateSyntheticInstance(env.ctx, withoutAdmin)).rejects.toThrow(
      /administrador ativo/,
    );

    const account = await env.insertAccount();
    await env.insertMembership(account.id, withoutAdmin, "administrador");
    await activateSyntheticInstance(env.ctx, withoutAdmin);
    expect((await getInstance(env.ctx, withoutAdmin))?.state).toBe("ATIVA");
    expect(await transitions(withoutAdmin)).toContainEqual(
      expect.objectContaining({ from_state: "PRONTA", to_state: "ATIVA", actor_kind: "sistema" }),
    );
    const { rows: projection } = await sql<{ state: string }>`
      SELECT state FROM access_instance`.execute(access);
    expect(projection[0]?.state).toBe("ativa");

    const real = await env.insertInstanceRow({ state: "PRONTA" });
    await sql`UPDATE instance SET synthetic = FALSE WHERE id = ${uuidToBin(real)}`.execute(
      env.ctx.core,
    );
    await env.insertMembership(account.id, real, "administrador");
    await expect(activateSyntheticInstance(env.ctx, real)).rejects.toThrow(/sintética/);

    const production = {
      ...env.ctx,
      config: { ...env.ctx.config, SPARK_ENV: "production" as const },
    };
    const other = await env.insertInstanceRow({ state: "PRONTA" });
    await env.insertMembership(account.id, other, "administrador");
    await expect(activateSyntheticInstance(production, other)).rejects.toThrow(/produção/);
  });
});
