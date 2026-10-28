import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "../../../src/app/errors.js";
import {
  hasBackupSince,
  latestBackup,
  recordBackupResult,
} from "../../../src/modules/instances/backup.js";
import { newId } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { insertBackupRecord, instanceAtState } from "../../support/f03.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

describe("backup.ts (research.md R-05, SC-042)", () => {
  it("sem nenhum registro, não há sucesso implícito", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    expect(await latestBackup(env.ctx, instance.id)).toEqual({
      lastSuccessfulAt: null,
      lastResult: null,
      origin: null,
    });
  });

  it("última linha de sucesso aparece como o backup mais recente", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const takenAt = env.clock.now();
    await recordBackupResult(env.ctx, {
      instanceId: instance.id,
      result: "sucesso",
      origin: "mysqldump diário",
      detail: null,
      takenAt,
    });
    const status = await latestBackup(env.ctx, instance.id);
    expect(status.lastResult).toBe("sucesso");
    expect(status.origin).toBe("mysqldump diário");
    expect(status.lastSuccessfulAt?.getTime()).toBe(takenAt.getTime());
  });

  it("uma falha mais recente que um sucesso anterior não vira sucesso implícito", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    await insertBackupRecord(env, instance.id, {
      result: "sucesso",
      takenAt: new Date(env.clock.now().getTime() - 60_000),
    });
    await insertBackupRecord(env, instance.id, { result: "falha", takenAt: env.clock.now() });
    const status = await latestBackup(env.ctx, instance.id);
    expect(status.lastResult).toBe("falha");
    expect(status.lastSuccessfulAt).not.toBeNull();
    expect(status.lastSuccessfulAt?.getTime()).toBeLessThan(env.clock.now().getTime());
  });

  it("instância inexistente recusa gravar", async () => {
    await expect(
      recordBackupResult(env.ctx, {
        instanceId: newId(),
        result: "sucesso",
        origin: "teste",
        detail: null,
        takenAt: env.clock.now(),
      }),
    ).rejects.toThrow(AppError);
  });

  it("hasBackupSince confere a data de corte usada pelo executor de migração", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const cutoff = env.clock.now();
    expect(await hasBackupSince(env.ctx, instance.id, cutoff)).toBe(false);
    await insertBackupRecord(env, instance.id, {
      result: "sucesso",
      takenAt: new Date(cutoff.getTime() + 1000),
    });
    expect(await hasBackupSince(env.ctx, instance.id, cutoff)).toBe(true);
  });
});
