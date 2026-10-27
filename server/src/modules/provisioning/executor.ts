import { sql } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import {
  type ProvisionerRegistry,
  PROVISIONERS,
  resolveProvisioner,
} from "../catalog/provisioners.js";
import { getInstance, type Instance } from "../instances/instances.js";
import { transition } from "../instances/transitions.js";
import { backoffMs, classify, ProvisioningFailure, SimulatedCrash } from "./errors.js";
import {
  applyMigrations,
  configure,
  createCredential,
  createDatabases,
  prepareInvitation,
  type StepContext,
  type StepOutcome,
  verify,
} from "./steps.js";
import {
  claimTask,
  finishedSteps,
  finishStepRun,
  HEARTBEAT_MS,
  renewLease,
  startStepRun,
  type Step,
  type Task,
} from "./tasks.js";

export interface ExecutorOptions {
  /** Contexto com `spark_core`/`spark_identity` (credencial `worker`) e a chave das instâncias. */
  ctx: AppContext;
  /** Configuração com a credencial `provisioner`. */
  config: Config;
  workerId: string;
  registry?: ProvisionerRegistry;
  /** Só em testes: interrompe depois do efeito de uma etapa (R-19). */
  afterEffect?: (step: Step) => void | Promise<void>;
}

export type RunOutcome = "concluida" | "aguardando_repeticao" | "falhou" | "lease_perdido";

const STRUCTURAL: readonly [Step, (sc: StepContext) => Promise<StepOutcome>][] = [
  ["criar_bancos", createDatabases],
  ["criar_credencial", createCredential],
  ["aplicar_migracoes", applyMigrations],
  ["configurar", configure],
  ["preparar_convite", prepareInvitation],
  ["verificar", verify],
];

class LeaseLost extends Error {}

/** Pega a próxima tarefa vencida (ou a indicada) e a executa; `null` se não há nada a fazer. */
export async function runNextTask(
  options: ExecutorOptions,
  onlyTaskId?: string,
): Promise<RunOutcome | null> {
  const task = await claimTask(options.ctx, options.workerId, onlyTaskId);
  if (!task) return null;
  return executeTask(options, task);
}

/**
 * Executa a tarefa a partir da primeira etapa não concluída nesta execução (R-06). Cada etapa
 * verifica o efeito antes de repetir, então retomar depois de uma queda não duplica nada.
 */
async function executeTask(options: ExecutorOptions, claimed: Task): Promise<RunOutcome> {
  const { ctx, workerId } = options;
  let task = claimed;
  let lost = false;
  const heartbeat = setInterval(() => {
    void renewLease(ctx, task.id, workerId).then(
      (ok) => {
        if (!ok) lost = true;
      },
      () => undefined,
    );
  }, HEARTBEAT_MS);
  let run: { id: string; startedAt: Date; step: Step } | null = null;
  const log = (step: Step, result: string, extra: Record<string, unknown> = {}) =>
    ctx.logger.info(
      {
        event: "provisioning_step",
        taskId: task.id,
        instanceId: task.instanceId,
        step,
        attempt: task.attempt + 1,
        result,
        ...extra,
      },
      "etapa de provisionamento",
    );

  const step = async (name: Step, body: () => Promise<StepOutcome>) => {
    if (lost) throw new LeaseLost();
    const started = await startStepRun(ctx, task, name, workerId);
    run = { ...started, step: name };
    const outcome = await body();
    await finishStepRun(ctx, started, outcome);
    run = null;
    log(name, outcome, { durationMs: ctx.clock().getTime() - started.startedAt.getTime() });
    // A conferência inicial roda em toda retomada: não pode zerar as tentativas da etapa que
    // vinha falhando, senão o limite nunca é atingido (FR-025).
    if (name === "validar") return;
    await sql`UPDATE admin_task SET attempt = 0 WHERE id = ${uuidToBin(task.id)}`.execute(ctx.core);
    task = { ...task, attempt: 0 };
  };

  try {
    let instance = await currentInstance(ctx, task.instanceId);
    await enterProvisioning(ctx, task, instance);
    instance = await currentInstance(ctx, task.instanceId);

    // Etapa 1 conferida de novo a cada retomada: o artefato implantado ainda é o fixado (R-07).
    let manifest: StepContext["manifest"] | null = null;
    await step("validar", async () => {
      const resolved = await resolveProvisioner(
        task.artifactCode,
        ctx.config.SPARK_ENV,
        options.registry ?? PROVISIONERS,
      );
      if (!resolved.ok) throw new ProvisioningFailure("PROVISIONING_ARTIFACT_INVALID");
      if (resolved.manifestSha256 !== task.manifestSha256) {
        throw new ProvisioningFailure("PROVISIONING_ARTIFACT_CHANGED");
      }
      manifest = resolved.manifest;
      return "ignorada";
    });
    if (!manifest) throw new ProvisioningFailure("PROVISIONING_ARTIFACT_INVALID");

    const done = await finishedSteps(ctx.core, task.id, task.runNumber);
    for (const [name, body] of STRUCTURAL) {
      if (done.has(name)) continue;
      const sc: StepContext = {
        ctx,
        config: options.config,
        task,
        instance,
        manifest,
        ...(options.afterEffect ? { afterEffect: options.afterEffect } : {}),
      };
      await step(name, () => body(sc));
    }

    await step("concluir", async () => {
      await ctx.core.transaction().execute(async (trx) => {
        await transition(trx, {
          instanceId: task.instanceId,
          from: "PROVISIONANDO",
          to: "PRONTA",
          actor: { kind: "sistema", id: null },
          reason: null,
          taskId: task.id,
          at: ctx.clock(),
        });
        await sql`UPDATE admin_task
                     SET status = 'concluida', current_step = NULL, lease_until = NULL,
                         error_code = NULL, error_message = NULL, finished_at = ${ctx.clock()}
                   WHERE id = ${uuidToBin(task.id)}`.execute(trx);
      });
      return "concluida";
    });
    ctx.logger.info(
      {
        event: "provisioning_finished",
        taskId: task.id,
        instanceId: task.instanceId,
        durationMs: ctx.clock().getTime() - task.createdAt.getTime(),
      },
      "provisionamento concluído",
    );
    return "concluida";
  } catch (error) {
    if (error instanceof SimulatedCrash) throw error;
    if (error instanceof LeaseLost) return "lease_perdido";
    return await fail(options, task, run, error);
  } finally {
    clearInterval(heartbeat);
  }
}

async function currentInstance(ctx: AppContext, id: string): Promise<Instance> {
  const instance = await getInstance(ctx, id);
  if (!instance) throw new Error("Instância da tarefa não encontrada");
  return instance;
}

/** `CADASTRADA → PROVISIONANDO` na primeira execução; `FALHA → PROVISIONANDO` na repetição. */
async function enterProvisioning(ctx: AppContext, task: Task, instance: Instance) {
  if (instance.state === "PROVISIONANDO") return;
  if (instance.state !== "CADASTRADA" && instance.state !== "FALHA_PROVISIONAMENTO") {
    throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", `estado ${instance.state}`);
  }
  await ctx.core.transaction().execute((trx) =>
    transition(trx, {
      instanceId: instance.id,
      from: instance.state,
      to: "PROVISIONANDO",
      actor: { kind: "sistema", id: null },
      reason: task.runNumber > 1 ? "nova_execucao" : null,
      taskId: task.id,
      at: ctx.clock(),
    }),
  );
}

/**
 * Falha transitória com tentativas restantes → `aguardando_repeticao` com espera progressiva;
 * senão a tarefa falha e a instância vai a `FALHA_PROVISIONAMENTO` (FR-025). A mensagem gravada é
 * segura; o detalhe técnico vai só ao log.
 */
async function fail(
  options: ExecutorOptions,
  task: Task,
  run: { id: string; startedAt: Date; step: Step } | null,
  error: unknown,
): Promise<RunOutcome> {
  const { ctx } = options;
  const classified = classify(error);
  const now = ctx.clock();
  if (run) {
    await finishStepRun(ctx, run, "falhou", {
      code: classified.code,
      message: classified.message,
    });
  }
  const attempt = task.attempt + 1;
  ctx.logger.warn(
    {
      event: "provisioning_step",
      taskId: task.id,
      instanceId: task.instanceId,
      step: run?.step ?? task.currentStep,
      attempt,
      result: "falhou",
      errorCode: classified.code,
      cause:
        (error as { code?: string }).code ??
        (error instanceof ProvisioningFailure ? error.detail : undefined),
    },
    "falha no provisionamento",
  );
  if (classified.transient && attempt < ctx.config.PROVISIONING_MAX_ATTEMPTS) {
    await sql`UPDATE admin_task
                 SET status = 'aguardando_repeticao', attempt = ${attempt},
                     next_attempt_at = ${new Date(now.getTime() + backoffMs(attempt))},
                     lease_until = NULL, worker_id = NULL,
                     error_code = ${classified.code}, error_message = ${classified.message}
               WHERE id = ${uuidToBin(task.id)}`.execute(ctx.core);
    return "aguardando_repeticao";
  }
  await ctx.core.transaction().execute(async (trx) => {
    await sql`UPDATE admin_task
                 SET status = 'falhou', attempt = ${attempt}, lease_until = NULL, worker_id = NULL,
                     error_code = ${classified.code}, error_message = ${classified.message},
                     finished_at = ${now}
               WHERE id = ${uuidToBin(task.id)}`.execute(trx);
    const { rows } = await sql<{ state: string }>`SELECT state FROM instance
       WHERE id = ${uuidToBin(task.instanceId)}`.execute(trx);
    if (rows[0]?.state === "PROVISIONANDO") {
      await transition(trx, {
        instanceId: task.instanceId,
        from: "PROVISIONANDO",
        to: "FALHA_PROVISIONAMENTO",
        actor: { kind: "sistema", id: null },
        reason: classified.code,
        taskId: task.id,
        at: now,
      });
    }
  });
  return "falhou";
}
