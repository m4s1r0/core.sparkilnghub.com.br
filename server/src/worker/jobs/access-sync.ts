import { sql } from "kysely";
import {
  runSyncJob,
  safeError,
  SyncPayloadError,
  type SyncJobKind,
} from "../../modules/access-projection/sync.js";
import { getInstance } from "../../modules/instances/instances.js";
import type { AppContext } from "../../platform/context.js";
import { binToUuid } from "../../platform/ids.js";

const LEASE_MS = 60_000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 60 * 60_000;

interface JobRow {
  id: Buffer;
  instance_id: Buffer;
  kind: SyncJobKind;
  payload: unknown;
  attempts: number;
}

/** Repetição exponencial a partir de 30 s, limitada a 1 h entre tentativas (R-10). */
export const retryDelayMs = (attempts: number) =>
  Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);

/** Reserva uma tarefa vencida (ou com lease expirado) sem disputar com outro trabalhador. */
async function claim(ctx: AppContext): Promise<JobRow | null> {
  const now = ctx.clock();
  return ctx.core.transaction().execute(async (trx) => {
    const { rows } = await sql<JobRow>`
      SELECT id, instance_id, kind, payload, attempts FROM access_sync_job
       WHERE (status = 'pendente' AND next_attempt_at <= ${now})
          OR (status = 'em_execucao' AND lease_until < ${now})
       ORDER BY next_attempt_at
       LIMIT 1 FOR UPDATE SKIP LOCKED`.execute(trx);
    const job = rows[0];
    if (!job) return null;
    await sql`UPDATE access_sync_job
                 SET status = 'em_execucao', attempts = attempts + 1,
                     lease_until = ${new Date(now.getTime() + LEASE_MS)}
               WHERE id = ${job.id}`.execute(trx);
    return { ...job, attempts: job.attempts + 1 };
  });
}

async function finish(
  ctx: AppContext,
  job: JobRow,
  status: "concluido" | "falhou" | "pendente",
  error: unknown = null,
): Promise<void> {
  const now = ctx.clock();
  const next = new Date(now.getTime() + retryDelayMs(job.attempts));
  await sql`UPDATE access_sync_job
               SET status = ${status}, lease_until = NULL,
                   last_error = ${error === null ? null : safeError(error)},
                   next_attempt_at = ${status === "pendente" ? next : now},
                   finished_at = ${status === "pendente" ? null : now}
             WHERE id = ${job.id}`.execute(ctx.core);
}

/**
 * Processa as tarefas vencidas de sincronização da projeção de acesso. Cada tarefa relê a fonte
 * e escreve só no banco de acesso da própria instância (`instance_id` da tarefa, nunca o
 * payload). Erro de payload é definitivo (`falhou`); demais erros voltam para `pendente`.
 */
export async function processDueJobs(ctx: AppContext, limit = 20): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const job = await claim(ctx);
    if (!job) break;
    processed += 1;
    const instanceId = binToUuid(job.instance_id);
    try {
      const instance = await getInstance(ctx, instanceId);
      if (!instance) throw new SyncPayloadError("instância inexistente");
      const payload =
        typeof job.payload === "string"
          ? (JSON.parse(job.payload) as Record<string, unknown>)
          : (job.payload as Record<string, unknown>);
      await runSyncJob(ctx, instance, job.kind, payload);
      await finish(ctx, job, "concluido");
    } catch (error) {
      const definitive = error instanceof SyncPayloadError;
      ctx.logger.warn(
        { err: error, instanceId, kind: job.kind, attempts: job.attempts, definitive },
        "Tarefa de sincronização da projeção falhou",
      );
      await finish(ctx, job, definitive ? "falhou" : "pendente", error);
    }
  }
  return processed;
}
