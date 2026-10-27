import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { recordAudit } from "../audit/audit.js";
import { conflictState } from "../instances/transitions.js";
import { provisioningView } from "./view.js";

/**
 * Nova execução de uma instância em `FALHA_PROVISIONAMENTO` (SC-023, FR-026): a mesma tarefa volta
 * a `pendente` com nova execução e tentativas zeradas; o histórico das execuções anteriores fica
 * intacto. A transição para `PROVISIONANDO` é feita pelo trabalhador ao retomar. Não há como
 * editar SQL, credencial, etapa ou estado técnico.
 */
export async function retryProvisioning(
  ctx: AppContext,
  instanceId: string,
  input: { reason: string },
  actor: { accountId: string; correlationId: string },
) {
  const now = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    const id = uuidToBin(instanceId);
    const { rows } = await sql<{ state: string }>`SELECT state FROM instance WHERE id = ${id}
       FOR UPDATE`.execute(trx);
    if (!rows[0]) {
      // Inexistente segue para o 404 da visão, depois da transação.
      return;
    }
    if (rows[0].state !== "FALHA_PROVISIONAMENTO") throw conflictState();
    const { rows: tasks } = await sql<{ id: Buffer; run_number: number }>`
      SELECT id, run_number FROM admin_task WHERE instance_id = ${id} AND status = 'falhou'
       ORDER BY seq DESC LIMIT 1 FOR UPDATE`.execute(trx);
    const task = tasks[0];
    if (!task) throw conflictState();
    await sql`UPDATE admin_task
                 SET status = 'pendente', run_number = run_number + 1, attempt = 0,
                     current_step = NULL, next_attempt_at = ${now}, lease_until = NULL,
                     worker_id = NULL, error_code = NULL, error_message = NULL, finished_at = NULL
               WHERE id = ${task.id}`.execute(trx);
    await recordAudit(trx, {
      actorKind: "usuario",
      actorId: actor.accountId,
      action: "provisionamento.repetido",
      objectType: "instancia",
      objectId: instanceId,
      changes: { runNumber: [task.run_number, task.run_number + 1] },
      reason: input.reason,
      correlationId: actor.correlationId,
      at: now,
    });
  });
  return provisioningView(ctx, instanceId);
}
