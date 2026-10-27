import { spawn } from "node:child_process";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { LEASE_MS } from "../../../src/modules/provisioning/tasks.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { serverRoot } from "../../../src/platform/paths.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, runProvisioning, stepRuns } from "../../support/f02.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

/** Sobe o processo filho e resolve quando ele avisa a pausa depois do efeito da etapa. */
function startWorker(taskId: string, pauseAfter: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(serverRoot, "tests", "support", "provisioning-worker.ts")],
    {
      cwd: serverRoot,
      env: {
        ...process.env,
        TEST_CORE_DB: env.databases.core,
        TEST_IDENTITY_DB: env.databases.identity,
        TASK_ID: taskId,
        PAUSE_AFTER: pauseAfter,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const paused = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes(`pausa:${pauseAfter}`)) resolve();
    });
    child.once("exit", (code) =>
      reject(new Error(`filho saiu (${code}) antes da pausa: ${stderr}`)),
    );
  });
  const exited = new Promise<NodeJS.Signals | number | null>((resolve) =>
    child.once("exit", (code, signal) => resolve(signal ?? code)),
  );
  return { child, paused, exited };
}

describe("trabalhador encerrado à força durante as migrações (NFR-014, T-02)", () => {
  it("SIGKILL na etapa 5; outro trabalhador retoma e conclui sem duplicidade", async () => {
    const { instanceId, taskId } = await requestViaService(env, await requester(env));
    const worker = startWorker(taskId, "aplicar_migracoes");
    await worker.paused;
    worker.child.kill("SIGKILL");
    await worker.exited;

    // O lease foi gravado pelo relógio real do filho: o "outro trabalhador" chega depois dele.
    env.clock.current = new Date(Date.now() + LEASE_MS + 5_000);
    expect(await runProvisioning(env, taskId)).toBe("concluida");

    expect((await getInstance(env.ctx, instanceId))?.state).toBe("PRONTA");
    const runs = await stepRuns(env, taskId);
    expect(runs.some((r) => r.step === "aplicar_migracoes" && r.status === "interrompida")).toBe(
      true,
    );
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instanceId)} AND status = 'verificado'`.execute(
      env.ctx.core,
    );
    expect(Number(rows[0]?.n)).toBe(3);
    const database = (await getInstance(env.ctx, instanceId))?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner", database);
    const [history] = await provisioner.query(
      "SELECT version, status FROM _spark_schema_history ORDER BY version",
    );
    expect(history).toEqual([
      { version: 1, status: "aplicada" },
      { version: 2, status: "aplicada" },
    ]);
  }, 120_000);
});
