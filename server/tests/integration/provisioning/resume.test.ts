import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { SimulatedCrash } from "../../../src/modules/provisioning/errors.js";
import { LEASE_MS, type Step } from "../../../src/modules/provisioning/tasks.js";
import { decryptSecret } from "../../../src/platform/crypto/index.js";
import { instanceUserName, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, runProvisioning, stepRuns } from "../../support/f02.js";

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

const STEPS: Step[] = [
  "criar_bancos",
  "criar_credencial",
  "aplicar_migracoes",
  "configurar",
  "preparar_convite",
  "verificar",
];

async function count(query: ReturnType<typeof sql<{ n: number }>>, db = env.ctx.core) {
  const { rows } = await query.execute(db);
  return Number(rows[0]?.n ?? 0);
}

describe("queda depois do efeito e retomada pelo próximo trabalhador (CS-004, CA-SC-006, T-02)", () => {
  for (const target of STEPS) {
    it(`etapa ${target}: retoma após o lease e chega a PRONTA sem duplicar nada`, async () => {
      const { instanceId, taskId } = await requestViaService(env, accountId);
      await expect(
        runProvisioning(env, taskId, {
          afterEffect: (step) => {
            if (step === target) throw new SimulatedCrash(step);
          },
        }),
      ).rejects.toBeInstanceOf(SimulatedCrash);

      // Antes do lease vencer, ninguém assume.
      expect(await runProvisioning(env, taskId)).toBeNull();
      env.clock.advance(LEASE_MS + 1_000);
      expect(await runProvisioning(env, taskId)).toBe("concluida");

      const instance = await getInstance(env.ctx, instanceId);
      expect(instance?.state).toBe("PRONTA");
      const id = uuidToBin(instanceId);
      expect(
        await count(sql`SELECT COUNT(*) AS n FROM instance_resource
                         WHERE instance_id = ${id} AND status = 'verificado'`),
      ).toBe(3);
      const provisioner = await env.mysql.connect("provisioner");
      const [dbs] = await provisioner.query(
        "SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
        [`${instance?.databaseName}%`],
      );
      expect(Number((dbs as { n: number }[])[0]?.n)).toBe(2);
      expect(
        await count(
          sql`SELECT COUNT(*) AS n FROM invitation WHERE instance_id = ${id}`,
          env.ctx.identity,
        ),
      ).toBe(1);

      // A senha guardada antes do CREATE USER continua a que vale (retomada não a perde).
      const { rows } = await sql<{ secret_enc: Buffer; secret_key_version: number }>`
        SELECT secret_enc, secret_key_version FROM instance_resource
         WHERE instance_id = ${id} AND kind = 'usuario_mysql'`.execute(env.ctx.core);
      const row = rows[0];
      if (!row) throw new Error("sem usuário");
      const password = decryptSecret(
        env.ctx.instanceKeyRing,
        row.secret_enc,
        row.secret_key_version,
        id,
      ).toString("utf8");
      const operational = await env.mysql.connectAs(
        instanceUserName(instanceId),
        password,
        instance?.databaseName,
      );
      await operational.query("SELECT 1 FROM _spark_instance");

      const runs = await stepRuns(env, taskId);
      expect(runs.some((r) => r.step === target && r.status === "interrompida")).toBe(true);
    });
  }

  it("reiniciar depois de concluída não executa etapa nenhuma (NFR-014)", async () => {
    const { taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId)).toBe("concluida");
    const before = (await stepRuns(env, taskId)).length;
    env.clock.advance(LEASE_MS * 2);
    expect(await runProvisioning(env, taskId)).toBeNull();
    expect((await stepRuns(env, taskId)).length).toBe(before);
  });
});
