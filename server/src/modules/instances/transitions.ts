import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import { setProjectionState } from "../access-projection/writer.js";
import { recordAudit } from "../audit/audit.js";
import type { InstanceState } from "./instances.js";

/**
 * Transições permitidas em F02 (escopo §5, research.md R-02). F03 amplia esta lista com
 * ativação, suspensão, manutenção e encerramento, cada uma com suas pré-condições.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  "CADASTRADA>PROVISIONANDO",
  "PROVISIONANDO>PRONTA",
  "PROVISIONANDO>FALHA_PROVISIONAMENTO",
  "FALHA_PROVISIONAMENTO>PROVISIONANDO",
]);

export interface TransitionActor {
  kind: "usuario" | "sistema";
  /** Conta (usuário) ou `null` (sistema; a tarefa vai em `taskId`). */
  id: string | null;
}

export interface TransitionRequest {
  instanceId: string;
  from: InstanceState;
  to: InstanceState;
  actor: TransitionActor;
  reason: string | null;
  taskId?: string | null;
  correlationId?: string | null;
  at: Date;
}

export const conflictState = () =>
  new AppError(409, "CONFLICT_STATE", "A instância não está no estado esperado para esta ação.");

/**
 * Executa uma transição dentro da transação recebida: trava a instância, confere o estado
 * esperado, atualiza e registra transição e auditoria. Duas transições concorrentes a partir do
 * mesmo estado: a segunda encontra o estado já mudado e recebe CONFLICT_STATE.
 */
export async function transition(trx: Kysely<unknown>, request: TransitionRequest): Promise<void> {
  if (!ALLOWED.has(`${request.from}>${request.to}`)) {
    throw new Error(`Transição não permitida em F02: ${request.from} → ${request.to}`);
  }
  await applyTransition(trx, request);
}

async function applyTransition(trx: Kysely<unknown>, request: TransitionRequest): Promise<void> {
  const id = uuidToBin(request.instanceId);
  const { rows } = await sql<{ state: InstanceState }>`
    SELECT state FROM instance WHERE id = ${id} FOR UPDATE`.execute(trx);
  if (rows[0]?.state !== request.from) throw conflictState();
  await sql`UPDATE instance SET state = ${request.to}, updated_at = ${request.at}
             WHERE id = ${id}`.execute(trx);
  const actorId = request.actor.id ? uuidToBin(request.actor.id) : null;
  await sql`INSERT INTO instance_transition (id, instance_id, from_state, to_state, actor_kind,
              actor_id, reason, task_id, correlation_id, created_at)
            VALUES (${uuidToBin(newId())}, ${id}, ${request.from}, ${request.to},
                    ${request.actor.kind}, ${actorId}, ${request.reason},
                    ${request.taskId ? uuidToBin(request.taskId) : null},
                    ${request.correlationId ?? null}, ${request.at})`.execute(trx);
  await recordAudit(trx, {
    actorKind: request.actor.kind,
    actorId: request.actor.id,
    action: "instancia.transicao",
    objectType: "instancia",
    objectId: request.instanceId,
    changes: { state: [request.from, request.to] },
    reason: request.reason,
    correlationId: request.correlationId ?? null,
    at: request.at,
  });
}

/**
 * Ativação das instâncias sintéticas pelas sementes (research.md R-18, plan.md nota 1):
 * `PRONTA → ATIVA` só para instância sintética, fora de produção e com administrador ativo — o
 * mesmo caminho de acesso que a ativação de F03 exigirá (SC-024). Não há rota que a exponha.
 */
export async function activateSyntheticInstance(
  ctx: AppContext,
  instanceId: string,
): Promise<void> {
  if (ctx.config.SPARK_ENV === "production") {
    throw new Error("Ativação sintética recusada em produção");
  }
  const { rows: marker } = await sql<{ environment: string }>`
    SELECT environment FROM environment_marker WHERE id = 1`.execute(ctx.core);
  if (marker[0]?.environment === "production") {
    throw new Error("Ativação sintética recusada: marcador de ambiente de produção");
  }
  const { rows } = await sql<{ synthetic: number; access_database_name: string }>`
    SELECT synthetic, access_database_name FROM instance
     WHERE id = ${uuidToBin(instanceId)}`.execute(ctx.core);
  const instance = rows[0];
  if (instance?.synthetic !== 1) throw new Error("Ativação sintética só para instância sintética");
  const { rows: admins } = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM membership
     WHERE instance_id = ${uuidToBin(instanceId)} AND role = 'administrador'
       AND status = 'ativo'`.execute(ctx.identity);
  if (Number(admins[0]?.n ?? 0) === 0) {
    throw new Error("Ativação sintética exige administrador ativo na instância");
  }
  await ctx.core.transaction().execute((trx) =>
    applyTransition(trx, {
      instanceId,
      from: "PRONTA",
      to: "ATIVA",
      actor: { kind: "sistema", id: null },
      reason: "sementes_sinteticas",
      at: ctx.clock(),
    }),
  );
  // Projeção depois da fonte: falha aqui deixa a instância ATIVA no Core e `pronta` na projeção,
  // o que só nega sessões; repetir as sementes corrige.
  await setProjectionState(ctx, { accessDatabaseName: instance.access_database_name }, "ativa");
}
