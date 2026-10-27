import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { getInstance } from "../instances/instances.js";
import { isRetryableCode } from "./errors.js";
import { latestTaskOf, type Step, type StepRunStatus } from "./tasks.js";

const iso = (date: Date | null) => (date ? date.toISOString() : null);

/** Tarefa e tentativas de etapa da instância (contracts/openapi.yaml `ProvisioningTask`). */
export async function provisioningView(ctx: AppContext, instanceId: string) {
  const instance = await getInstance(ctx, instanceId);
  const task = instance ? await latestTaskOf(ctx.core, instanceId) : null;
  if (!instance || !task) {
    throw new AppError(404, "NOT_FOUND", "Provisionamento não encontrado.");
  }
  const { rows } = await sql<{
    step: Step;
    run_number: number;
    attempt: number;
    status: StepRunStatus;
    started_at: Date;
    finished_at: Date | null;
    duration_ms: number | null;
    error_code: string | null;
  }>`SELECT step, run_number, attempt, status, started_at, finished_at, duration_ms, error_code
       FROM admin_task_step_run WHERE task_id = ${uuidToBin(task.id)}
      ORDER BY started_at, run_number, id`.execute(ctx.core);
  const failedStep = task.status === "concluida" ? null : task.currentStep;
  return {
    id: task.id,
    protocol: task.protocol,
    instanceId,
    instanceState: instance.state,
    status: task.status,
    currentStep: task.status === "concluida" ? null : task.currentStep,
    runNumber: task.runNumber,
    attempt: task.attempt,
    maxAttempts: ctx.config.PROVISIONING_MAX_ATTEMPTS,
    nextAttemptAt: task.status === "aguardando_repeticao" ? iso(task.nextAttemptAt) : null,
    artifactVersion: task.artifactVersion,
    error:
      task.errorCode && task.errorMessage && failedStep && task.status !== "em_execucao"
        ? {
            code: task.errorCode,
            message: task.errorMessage,
            step: failedStep,
            retryable: isRetryableCode(task.errorCode),
          }
        : null,
    steps: rows.map((row) => ({
      step: row.step,
      runNumber: row.run_number,
      attempt: row.attempt,
      status: row.status,
      startedAt: row.started_at.toISOString(),
      finishedAt: iso(row.finished_at),
      durationMs: row.duration_ms,
      errorCode: row.error_code,
    })),
    createdAt: task.createdAt.toISOString(),
    startedAt: iso(task.startedAt),
    finishedAt: iso(task.finishedAt),
  };
}
