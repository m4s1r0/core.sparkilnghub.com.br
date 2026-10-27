import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { instanceDatabaseName } from "../../platform/ids.js";
import { accessDatabaseName } from "../../platform/migrations/apply-artifact.js";
import { recordAudit } from "../audit/audit.js";
import { protocolOf, type TaskStatus } from "../instances/query.js";

/** Etapas da tarefa de provisionamento, na ordem (FR-021, research.md R-06). */
export const STEPS = [
  "validar",
  "reservar",
  "criar_bancos",
  "criar_credencial",
  "aplicar_migracoes",
  "configurar",
  "preparar_convite",
  "verificar",
  "concluir",
] as const;
export type Step = (typeof STEPS)[number];

export type StepRunStatus = "em_execucao" | "concluida" | "falhou" | "interrompida" | "ignorada";

/** Lease de 60 s renovado a cada 20 s (research.md R-03). */
export const LEASE_MS = 60_000;
export const HEARTBEAT_MS = 20_000;

export interface Task {
  id: string;
  seq: number;
  protocol: string;
  instanceId: string;
  status: TaskStatus;
  currentStep: Step | null;
  runNumber: number;
  attempt: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  workerId: string | null;
  artifactCode: string;
  artifactVersion: number;
  manifestSha256: string;
  requestedBy: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

interface TaskRow {
  id: Buffer;
  seq: number;
  instance_id: Buffer;
  status: TaskStatus;
  current_step: Step | null;
  run_number: number;
  attempt: number;
  next_attempt_at: Date;
  lease_until: Date | null;
  worker_id: Buffer | null;
  artifact_code: string;
  artifact_version: number;
  manifest_sha256: string;
  requested_by: Buffer;
  request_hash: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

const TASK_COLUMNS = sql`id, seq, instance_id, status, current_step, run_number, attempt,
  next_attempt_at, lease_until, worker_id, artifact_code, artifact_version, manifest_sha256,
  requested_by, request_hash, error_code, error_message, created_at, started_at, finished_at`;

const toTask = (row: TaskRow): Task => ({
  id: binToUuid(row.id),
  seq: Number(row.seq),
  protocol: protocolOf(row.seq),
  instanceId: binToUuid(row.instance_id),
  status: row.status,
  currentStep: row.current_step,
  runNumber: row.run_number,
  attempt: row.attempt,
  nextAttemptAt: row.next_attempt_at,
  leaseUntil: row.lease_until,
  workerId: row.worker_id ? binToUuid(row.worker_id) : null,
  artifactCode: row.artifact_code,
  artifactVersion: row.artifact_version,
  manifestSha256: row.manifest_sha256,
  requestedBy: binToUuid(row.requested_by),
  errorCode: row.error_code,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

export async function getTask(db: Kysely<unknown>, id: string): Promise<Task | null> {
  const { rows } = await sql<TaskRow>`SELECT ${TASK_COLUMNS} FROM admin_task
     WHERE id = ${uuidToBin(id)}`.execute(db);
  return rows[0] ? toTask(rows[0]) : null;
}

/** Última tarefa da instância (protocolo exibido no painel). */
export async function latestTaskOf(db: Kysely<unknown>, instanceId: string): Promise<Task | null> {
  const { rows } = await sql<TaskRow>`SELECT ${TASK_COLUMNS} FROM admin_task
     WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY seq DESC LIMIT 1`.execute(db);
  return rows[0] ? toTask(rows[0]) : null;
}

export interface ProvisioningRequest {
  contractorId: string;
  productCode: string;
  databasePrefix: string;
  displayName: string;
  slug: string;
  timezone: string;
  initialAdminEmail: string;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
  artifactVersion: number;
  manifestSha256: string;
  idempotencyKey: string;
  requestHash: string;
  /** Dados sintéticos: tudo fora de produção (NFR-016); limpos por `dev:reset`. */
  synthetic: boolean;
  /** UUID fixo só para as sementes (instâncias A e B); o painel sempre gera um novo. */
  instanceId?: string;
}

export interface RequestActor {
  accountId: string;
  correlationId: string;
}

export const slugTaken = () =>
  new AppError(409, "CONFLICT_SLUG_TAKEN", "Este identificador de acesso já está em uso.", {
    field: "/slug",
  });

const idempotencyMismatch = () =>
  new AppError(
    409,
    "CONFLICT_IDEMPOTENCY_MISMATCH",
    "Esta chave de idempotência já foi usada com outros dados.",
  );

/** Tarefa já criada com esta chave (R-04): mesma chave e mesmos dados → mesma resposta. */
async function byIdempotencyKey(
  db: Kysely<unknown>,
  accountId: string,
  key: string,
): Promise<TaskRow | null> {
  const { rows } = await sql<TaskRow>`SELECT ${TASK_COLUMNS} FROM admin_task
     WHERE requested_by = ${uuidToBin(accountId)} AND idempotency_key = ${key}`.execute(db);
  return rows[0] ?? null;
}

function replay(row: TaskRow, requestHash: string): { instanceId: string; taskId: string } {
  if (row.request_hash !== requestHash) throw idempotencyMismatch();
  return { instanceId: binToUuid(row.instance_id), taskId: binToUuid(row.id) };
}

async function recordStepRun(
  db: Kysely<unknown>,
  data: {
    taskId: string;
    runNumber: number;
    step: Step;
    attempt: number;
    status: StepRunStatus;
    workerId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
  },
): Promise<string> {
  const id = newId();
  const duration =
    data.finishedAt === null ? null : data.finishedAt.getTime() - data.startedAt.getTime();
  await sql`INSERT INTO admin_task_step_run (id, task_id, run_number, step, attempt, status,
              worker_id, started_at, finished_at, duration_ms)
            VALUES (${uuidToBin(id)}, ${uuidToBin(data.taskId)}, ${data.runNumber}, ${data.step},
                    ${data.attempt}, ${data.status},
                    ${data.workerId ? uuidToBin(data.workerId) : null}, ${data.startedAt},
                    ${data.finishedAt}, ${duration})`.execute(db);
  return id;
}

/**
 * Solicitação de provisionamento numa única transação de `spark_core` (R-04, FR-018 a FR-020):
 * instância `CADASTRADA`, transição, auditoria, tarefa `pendente` com a chave de idempotência e as
 * etapas `validar` e `reservar` já concluídas. Concorrência: o índice único da chave e o de
 * `(produto, slug)` decidem; quem perde relê a chave (mesma solicitação) ou recebe conflito.
 */
export async function createProvisioningRequest(
  ctx: AppContext,
  data: ProvisioningRequest,
  actor: RequestActor,
): Promise<{ instanceId: string; taskId: string; created: boolean }> {
  const existing = await byIdempotencyKey(ctx.core, actor.accountId, data.idempotencyKey);
  if (existing) return { ...replay(existing, data.requestHash), created: false };

  const instanceId = data.instanceId ?? newId();
  const taskId = newId();
  const database = instanceDatabaseName(data.databasePrefix, instanceId);
  const now = ctx.clock();
  try {
    await retryOnDeadlock(() =>
      ctx.core.transaction().execute(async (trx) => {
        const id = uuidToBin(instanceId);
        await sql`INSERT INTO instance (id, contractor_id, product_code, slug, display_name,
                    timezone, initial_admin_email, state, database_name, access_database_name,
                    authorization_revision, notes, valid_from, valid_until, synthetic, version,
                    created_by, created_at, updated_at)
                  VALUES (${id}, ${uuidToBin(data.contractorId)}, ${data.productCode}, ${data.slug},
                          ${data.displayName}, ${data.timezone}, ${data.initialAdminEmail},
                          'CADASTRADA', ${database}, ${accessDatabaseName(database)}, 1,
                          ${data.notes}, ${data.validFrom}, ${data.validUntil}, ${data.synthetic}, 1,
                          ${uuidToBin(actor.accountId)}, ${now}, ${now})`.execute(trx);
        await sql`INSERT INTO instance_transition (id, instance_id, from_state, to_state,
                    actor_kind, actor_id, reason, task_id, correlation_id, created_at)
                  VALUES (${uuidToBin(newId())}, ${id}, NULL, 'CADASTRADA', 'usuario',
                          ${uuidToBin(actor.accountId)}, 'solicitacao', ${uuidToBin(taskId)},
                          ${actor.correlationId}, ${now})`.execute(trx);
        await sql`INSERT INTO admin_task (id, instance_id, kind, status, current_step, run_number,
                    attempt, next_attempt_at, artifact_code, artifact_version, manifest_sha256,
                    requested_by, idempotency_key, request_hash, created_at)
                  VALUES (${uuidToBin(taskId)}, ${id}, 'provisionamento', 'pendente', NULL, 1, 0,
                          ${now}, ${data.productCode}, ${data.artifactVersion},
                          ${data.manifestSha256}, ${uuidToBin(actor.accountId)},
                          ${data.idempotencyKey}, ${data.requestHash}, ${now})`.execute(trx);
        for (const step of ["validar", "reservar"] as const) {
          await recordStepRun(trx, {
            taskId,
            runNumber: 1,
            step,
            attempt: 1,
            status: "concluida",
            workerId: null,
            startedAt: now,
            finishedAt: now,
          });
        }
        await recordAudit(trx, {
          actorKind: "usuario",
          actorId: actor.accountId,
          action: "instancia.solicitada",
          objectType: "instancia",
          objectId: instanceId,
          changes: {
            contractorId: [null, data.contractorId],
            productCode: [null, data.productCode],
            slug: [null, data.slug],
            displayName: [null, data.displayName],
            timezone: [null, data.timezone],
            initialAdminEmail: [null, data.initialAdminEmail],
          },
          correlationId: actor.correlationId,
          at: now,
        });
      }),
    );
  } catch (error) {
    if ((error as { code?: string }).code !== "ER_DUP_ENTRY") throw error;
    // Outra solicitação venceu: com a mesma chave, é a mesma solicitação (T-01).
    const winner = await byIdempotencyKey(ctx.core, actor.accountId, data.idempotencyKey);
    if (winner) return { ...replay(winner, data.requestHash), created: false };
    throw slugTaken();
  }
  return { instanceId, taskId, created: true };
}

/**
 * Pega uma tarefa vencida com lease (R-03): `pendente`, `aguardando_repeticao` cuja espera
 * terminou, ou `em_execucao` com lease vencido (trabalhador que caiu). `SKIP LOCKED` evita disputa
 * entre trabalhadores; a tentativa aberta de quem caiu vira `interrompida`.
 */
export async function claimTask(
  ctx: AppContext,
  workerId: string,
  onlyTaskId?: string,
): Promise<Task | null> {
  return ctx.core.transaction().execute(async (trx) => {
    const now = ctx.clock();
    const { rows } = await sql<TaskRow>`SELECT ${TASK_COLUMNS} FROM admin_task
       WHERE status IN ('pendente', 'aguardando_repeticao', 'em_execucao')
         AND next_attempt_at <= ${now}
         AND (lease_until IS NULL OR lease_until < ${now})
         ${onlyTaskId ? sql`AND id = ${uuidToBin(onlyTaskId)}` : sql``}
       ORDER BY next_attempt_at, seq
       LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(trx);
    const row = rows[0];
    if (!row) return null;
    if (row.status === "em_execucao") {
      await sql`UPDATE admin_task_step_run SET status = 'interrompida', finished_at = ${now}
                 WHERE task_id = ${row.id} AND status = 'em_execucao'`.execute(trx);
    }
    await sql`UPDATE admin_task
                 SET status = 'em_execucao', lease_until = ${new Date(now.getTime() + LEASE_MS)},
                     worker_id = ${uuidToBin(workerId)}, started_at = COALESCE(started_at, ${now})
               WHERE id = ${row.id}`.execute(trx);
    const claimed = await getTask(trx, binToUuid(row.id));
    if (!claimed) throw new Error("Tarefa sumiu durante o lease");
    return claimed;
  });
}

/** Renova o lease; `false` se outro trabalhador o assumiu (a execução deve parar). */
export async function renewLease(ctx: AppContext, taskId: string, workerId: string) {
  const now = ctx.clock();
  const result = await sql`UPDATE admin_task SET lease_until = ${new Date(now.getTime() + LEASE_MS)}
     WHERE id = ${uuidToBin(taskId)} AND worker_id = ${uuidToBin(workerId)}
       AND status = 'em_execucao'`.execute(ctx.core);
  return Number(result.numAffectedRows ?? 0) === 1;
}

/** Etapas já concluídas (ou verificadas) na execução atual. */
export async function finishedSteps(
  db: Kysely<unknown>,
  taskId: string,
  runNumber: number,
): Promise<Set<Step>> {
  const { rows } = await sql<{ step: Step }>`SELECT DISTINCT step FROM admin_task_step_run
     WHERE task_id = ${uuidToBin(taskId)} AND run_number = ${runNumber}
       AND status IN ('concluida', 'ignorada')`.execute(db);
  return new Set(rows.map((r) => r.step));
}

export async function startStepRun(
  ctx: AppContext,
  task: Task,
  step: Step,
  workerId: string,
): Promise<{ id: string; startedAt: Date }> {
  const startedAt = ctx.clock();
  await sql`UPDATE admin_task SET current_step = ${step} WHERE id = ${uuidToBin(task.id)}`.execute(
    ctx.core,
  );
  const id = await recordStepRun(ctx.core, {
    taskId: task.id,
    runNumber: task.runNumber,
    step,
    attempt: task.attempt + 1,
    status: "em_execucao",
    workerId,
    startedAt,
    finishedAt: null,
  });
  return { id, startedAt };
}

export async function finishStepRun(
  ctx: AppContext,
  run: { id: string; startedAt: Date },
  status: Exclude<StepRunStatus, "em_execucao">,
  error?: { code: string; message: string },
): Promise<void> {
  const finishedAt = ctx.clock();
  await sql`UPDATE admin_task_step_run
               SET status = ${status}, finished_at = ${finishedAt},
                   duration_ms = ${finishedAt.getTime() - run.startedAt.getTime()},
                   error_code = ${error?.code ?? null}, error_message = ${error?.message ?? null}
             WHERE id = ${uuidToBin(run.id)} AND status = 'em_execucao'`.execute(ctx.core);
}
