import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reactivateInstance, suspendInstance } from "../../../src/modules/instances/transitions.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { instanceAtState } from "../../support/f03.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

async function coreState(instanceId: string): Promise<string | undefined> {
  const { rows } = await sql<{ state: string }>`
    SELECT state FROM instance WHERE id = ${uuidToBin(instanceId)}`.execute(env.ctx.core);
  return rows[0]?.state;
}

async function projectionState(accessDatabaseName: string): Promise<string | undefined> {
  const { rows } = await sql<{ state: string }>`SELECT state FROM access_instance`.execute(
    env.ctx.access(accessDatabaseName),
  );
  return rows[0]?.state;
}

describe("ordem de escrita entre o Core e a projeção de acesso (research.md R-01)", () => {
  it("revogar (suspender): falha na escrita da projeção não grava a transição nem muda o Core", async () => {
    const { instance, actor } = await instanceAtState(env, "ATIVA");
    await env.setWriterAccess(instance, false);
    const freshCtx = env.freshContext();
    await expect(suspendInstance(freshCtx, instance.id, actor, "teste")).rejects.toThrow();
    await env.setWriterAccess(instance, true);

    expect(await coreState(instance.id)).toBe("ATIVA");
    expect(await projectionState(instance.accessDatabaseName)).toBe("ativa");
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_transition
       WHERE instance_id = ${uuidToBin(instance.id)} AND to_state = 'SUSPENSA'`.execute(
      env.ctx.core,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("conceder (reativar): falha na escrita da projeção deixa o Core já no novo estado, mas a projeção continua negando", async () => {
    const { instance, actor } = await instanceAtState(env, "SUSPENSA");
    await env.setWriterAccess(instance, false);
    const freshCtx = env.freshContext();
    await expect(reactivateInstance(freshCtx, instance.id, actor)).rejects.toThrow();
    await env.setWriterAccess(instance, true);

    // O Core já registrou a transição (a escrita dele veio antes da projeção, por desenho).
    expect(await coreState(instance.id)).toBe("ATIVA");
    // A projeção não mudou: continua negando sessão, mesmo com o Core mostrando ATIVA.
    expect(await projectionState(instance.accessDatabaseName)).toBe("suspensa");
  });

  it("caminho feliz nos dois sentidos: Core e projeção terminam de acordo", async () => {
    const { instance: suspended, actor: suspendActor } = await instanceAtState(env, "ATIVA");
    await suspendInstance(env.ctx, suspended.id, suspendActor, "teste");
    expect(await coreState(suspended.id)).toBe("SUSPENSA");
    expect(await projectionState(suspended.accessDatabaseName)).toBe("suspensa");

    const { instance: reactivated, actor: reactivateActor } = await instanceAtState(
      env,
      "SUSPENSA",
    );
    await reactivateInstance(env.ctx, reactivated.id, reactivateActor);
    expect(await coreState(reactivated.id)).toBe("ATIVA");
    expect(await projectionState(reactivated.accessDatabaseName)).toBe("ativa");
  });
});
