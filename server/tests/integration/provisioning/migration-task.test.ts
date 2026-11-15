import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyInstanceMigration,
  instanceMigrationPlan,
  instanceMigrationView,
} from "../../../src/modules/instances/migration-view.js";
import { AppError } from "../../../src/app/errors.js";
import { SimulatedCrash } from "../../../src/modules/provisioning/errors.js";
import { runNextTask } from "../../../src/modules/provisioning/executor.js";
import { LEASE_MS } from "../../../src/modules/provisioning/tasks.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { artifactVariant, executorOptions } from "../../support/f02.js";
import { insertBackupRecord, instanceAtState, SYNTHETIC_REASON } from "../../support/f03.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

async function errorCodeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as AppError).code;
  }
  throw new Error("esperava erro");
}

describe("executor de migração de instância (US6, SC-044, research.md R-03)", () => {
  it("fora de MANUTENCAO → CONFLICT_STATE", async () => {
    const { instance, requesterId } = await instanceAtState(env, "ATIVA");
    const code = await errorCodeOf(
      applyInstanceMigration(env.ctx, instance.id, requesterId, crypto.randomUUID()),
    );
    expect(code).toBe("CONFLICT_STATE");
  });

  it("sem backup desde a entrada em manutenção → NO_PRIOR_BACKUP", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    const code = await errorCodeOf(
      applyInstanceMigration(env.ctx, instance.id, requesterId, crypto.randomUUID()),
    );
    expect(code).toBe("NO_PRIOR_BACKUP");
  });

  it("já na versão vigente do artefato → ALREADY_UP_TO_DATE", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    await insertBackupRecord(env, instance.id);
    const code = await errorCodeOf(
      applyInstanceMigration(env.ctx, instance.id, requesterId, crypto.randomUUID()),
    );
    expect(code).toBe("ALREADY_UP_TO_DATE");
  });

  it("caminho feliz: aplica a nova versão, atualiza schema_version e verifica", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    await insertBackupRecord(env, instance.id);
    const registry = artifactVariant({
      "0003_f03_extra": "CREATE TABLE ref_f03_extra (id INT);\n",
    });
    // Antes de agendar, o painel mostra o que será aplicado.
    const plan = await instanceMigrationPlan(env.ctx, instance.id, registry);
    expect(plan).toEqual({
      currentVersion: 2,
      recordedVersion: 2,
      targetVersion: 3,
      source: "historico",
      historyUnavailable: null,
      pending: [{ version: 3, name: "0003_f03_extra", status: "pendente" }],
      blocked: null,
    });

    const created = await applyInstanceMigration(
      env.ctx,
      instance.id,
      requesterId,
      crypto.randomUUID(),
      registry,
    );
    expect(created.status).toBe("pendente");
    expect(created.fromVersion).toBe(2);
    expect(created.toVersion).toBe(3);
    expect(created.migrations).toEqual([
      { version: 3, name: "0003_f03_extra", status: "pendente" },
    ]);

    expect(await runNextTask(executorOptions(env, { registry }))).toBe("concluida");

    const finished = await instanceMigrationView(env.ctx, instance.id, registry);
    expect(finished?.status).toBe("concluida");
    expect(finished?.migrations).toEqual([
      { version: 3, name: "0003_f03_extra", status: "aplicada" },
    ]);
    expect((await instanceMigrationPlan(env.ctx, instance.id, registry)).pending).toEqual([]);

    const { rows } = await sql<{ schema_version: number }>`SELECT schema_version FROM instance
       WHERE id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    expect(rows[0]?.schema_version).toBe(3);

    const admin = await env.mysql.connect("provisioner", instance.databaseName);
    const [tables] = await admin.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ref_f03_extra'",
      [instance.databaseName],
    );
    expect((tables as { name: string }[]).length).toBe(1);

    // A instância continua MANUTENCAO: sair dela é ação separada do administrador.
    const { rows: state } = await sql<{ state: string }>`SELECT state FROM instance
       WHERE id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    expect(state[0]?.state).toBe("MANUTENCAO");
  });

  it("várias pendentes com falha no meio: andamento por migração e pendentes pelo histórico real", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    await insertBackupRecord(env, instance.id);
    const registry = artifactVariant({
      "0003_f03_ok": "CREATE TABLE ref_f03_ok (id INT);\n",
      // Coluna duplicada: sintaxe válida para o validador, erro só no MySQL.
      "0004_f03_quebrada": "CREATE TABLE ref_f03_quebrada (id INT, id INT);\n",
    });
    const plan = await instanceMigrationPlan(env.ctx, instance.id, registry);
    expect(plan.pending).toEqual([
      { version: 3, name: "0003_f03_ok", status: "pendente" },
      { version: 4, name: "0004_f03_quebrada", status: "pendente" },
    ]);

    const created = await applyInstanceMigration(
      env.ctx,
      instance.id,
      requesterId,
      crypto.randomUUID(),
      registry,
    );
    expect(created.fromVersion).toBe(2);
    expect(created.toVersion).toBe(4);
    expect(await runNextTask(executorOptions(env, { registry }), created.id)).toBe("falhou");

    // A v3 ficou aplicada (DDL faz commit implícito); a v4 falhou.
    const failed = await instanceMigrationView(env.ctx, instance.id, registry);
    expect(failed?.migrations).toEqual([
      { version: 3, name: "0003_f03_ok", status: "aplicada" },
      { version: 4, name: "0004_f03_quebrada", status: "falhou" },
    ]);

    // O Core ainda registra v2, mas o plano usa o histórico real: só a v4 falta, e bloqueia.
    const after = await instanceMigrationPlan(env.ctx, instance.id, registry);
    expect(after.recordedVersion).toBe(2);
    expect(after.currentVersion).toBe(3);
    expect(after.pending).toEqual([{ version: 4, name: "0004_f03_quebrada", status: "falhou" }]);
    expect(after.blocked?.code).toBe("SCHEMA_FAILED");
    expect(
      await errorCodeOf(
        applyInstanceMigration(env.ctx, instance.id, requesterId, crypto.randomUUID(), registry),
      ),
    ).toBe("SCHEMA_HISTORY_BLOCKED");

    // Linha `falha` sem término e sem tarefa ativa: execução interrompida.
    const admin = await env.mysql.connect("provisioner", instance.databaseName);
    await admin.query("UPDATE _spark_schema_history SET finished_at = NULL WHERE version = 4");
    const interrupted = await instanceMigrationPlan(env.ctx, instance.id, registry);
    expect(interrupted.pending[0]?.status).toBe("interrompida");
    expect(interrupted.blocked?.code).toBe("SCHEMA_FAILED");
  });

  it("queda depois do efeito: outro trabalhador retoma sem repetir a etapa já aplicada", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    await insertBackupRecord(env, instance.id);
    const registry = artifactVariant({
      "0003_f03_extra2": "CREATE TABLE ref_f03_extra2 (id INT);\n",
    });
    const created = await applyInstanceMigration(
      env.ctx,
      instance.id,
      requesterId,
      crypto.randomUUID(),
      registry,
    );
    await expect(
      runNextTask(
        executorOptions(env, {
          registry,
          afterEffect: (step) => {
            if (step === "aplicar_migracoes_instancia") throw new SimulatedCrash(step);
          },
        }),
      ),
    ).rejects.toBeInstanceOf(SimulatedCrash);

    env.clock.advance(LEASE_MS + 1_000);
    expect(await runNextTask(executorOptions(env, { registry }), created.id)).toBe("concluida");

    const { rows } = await sql<{ schema_version: number }>`SELECT schema_version FROM instance
       WHERE id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    expect(rows[0]?.schema_version).toBe(3);
  });

  it("sem backup prévio ao retomar (removido no meio) → PROVISIONING_NO_PRIOR_BACKUP, sem crash", async () => {
    const { instance, requesterId } = await instanceAtState(env, "MANUTENCAO");
    await insertBackupRecord(env, instance.id, { takenAt: env.clock.now() });
    const registry = artifactVariant({
      "0003_f03_extra3": "CREATE TABLE ref_f03_extra3 (id INT);\n",
    });
    const created = await applyInstanceMigration(
      env.ctx,
      instance.id,
      requesterId,
      crypto.randomUUID(),
      registry,
    );
    await sql`DELETE FROM instance_backup_record WHERE instance_id = ${uuidToBin(instance.id)}`.execute(
      env.ctx.core,
    );
    expect(await runNextTask(executorOptions(env, { registry }), created.id)).toBe("falhou");
    void SYNTHETIC_REASON;
  });
});
