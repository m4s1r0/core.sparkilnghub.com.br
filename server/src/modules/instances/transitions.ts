import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import {
  type CoreEndReason,
  setProjectionState,
  setProjectionStateAndEndSessions,
  type ProjectionState,
} from "../access-projection/writer.js";
import { recordAudit } from "../audit/audit.js";
import { checkInstanceEligibility, type EligibilityReason } from "./eligibility.js";
import { checkInstanceHealth, type HealthCheckResult } from "./health.js";
import {
  getInstance,
  INSTANCE_COLUMNS,
  type Instance,
  type InstanceRow,
  type InstanceState,
  toInstance,
} from "./instances.js";

/**
 * Transições permitidas (escopo §5, research.md R-02). F02 só exercia as quatro primeiras; F03
 * acrescenta ativação, suspensão, reativação, manutenção e encerramento, cada uma com suas
 * pré-condições em `activateInstance`…`terminateInstance`.
 */
const ALLOWED: ReadonlySet<string> = new Set([
  "CADASTRADA>PROVISIONANDO",
  "PROVISIONANDO>PRONTA",
  "PROVISIONANDO>FALHA_PROVISIONAMENTO",
  "FALHA_PROVISIONAMENTO>PROVISIONANDO",
  "PRONTA>ATIVA",
  "ATIVA>SUSPENSA",
  "SUSPENSA>ATIVA",
  "ATIVA>MANUTENCAO",
  "MANUTENCAO>ATIVA",
  "SUSPENSA>ENCERRADA",
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
  await recordTransition(trx, request);
}

/** Grava a mudança de estado, a transição e a auditoria; o chamador já travou e conferiu a linha. */
async function recordTransition(trx: Kysely<unknown>, request: TransitionRequest): Promise<void> {
  const id = uuidToBin(request.instanceId);
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

/** Trava e lê a instância inteira (para a projeção); confere o estado esperado sob a trava. */
async function lockInstance(
  trx: Kysely<unknown>,
  instanceId: string,
  expected: InstanceState,
): Promise<Instance> {
  const { rows } = await sql<InstanceRow>`SELECT ${INSTANCE_COLUMNS} FROM instance
     WHERE id = ${uuidToBin(instanceId)} FOR UPDATE`.execute(trx);
  const row = rows[0];
  if (!row || row.state !== expected) throw conflictState();
  return toInstance(row);
}

const ELIGIBILITY_MESSAGES: Record<EligibilityReason, string> = {
  CONTRACTOR_INACTIVE: "O contratante está inativo.",
  SCHEMA_INCOMPATIBLE:
    "A versão do schema aplicado não é compatível com a versão vigente do produto.",
  NO_ADMIN_PATH: "Não há administrador ativo nem convite inicial pendente válido para a instância.",
};

export const instanceNotEligible = (reason: EligibilityReason) =>
  new AppError(409, "INSTANCE_NOT_ELIGIBLE", ELIGIBILITY_MESSAGES[reason]);

export type LifecycleDirection = "conceder" | "revogar";

export interface LifecycleTransitionInput {
  /** `revogar`: grava a projeção antes do Core. `conceder`: grava o Core antes da projeção
   * (research.md R-01) — uma falha entre as duas escritas nunca abre acesso indevido. */
  direction: LifecycleDirection;
  instanceId: string;
  from: InstanceState;
  to: InstanceState;
  actor: TransitionActor;
  reason: string | null;
  correlationId?: string | null;
  /** `null` quando a transição não muda a projeção de acesso (encerrar: já `suspensa`). */
  projectionState: ProjectionState | null;
  /** Só `revogar`: também encerra toda sessão aberta na mesma escrita (CA-SC-009). */
  endSessionsReason?: CoreEndReason;
}

/**
 * Núcleo das transições de ciclo de F03 (research.md R-01). Trava a instância, confere o estado
 * esperado e, pela direção, escreve a projeção de acesso antes ou depois do Core — nunca na
 * ordem errada, para que uma falha entre as duas escritas deixe o sistema sempre fechado.
 */
export async function writeLifecycleTransition(
  ctx: AppContext,
  input: LifecycleTransitionInput,
): Promise<Instance> {
  if (!ALLOWED.has(`${input.from}>${input.to}`)) {
    throw new Error(`Transição não permitida: ${input.from} → ${input.to}`);
  }
  const at = ctx.clock();
  const request: TransitionRequest = {
    instanceId: input.instanceId,
    from: input.from,
    to: input.to,
    actor: input.actor,
    reason: input.reason,
    correlationId: input.correlationId ?? null,
    at,
  };
  if (input.direction === "revogar") {
    await ctx.core.transaction().execute(async (trx) => {
      const instance = await lockInstance(trx, input.instanceId, input.from);
      if (input.projectionState) {
        if (input.endSessionsReason) {
          await setProjectionStateAndEndSessions(
            ctx,
            instance,
            input.projectionState,
            input.endSessionsReason,
          );
        } else {
          await setProjectionState(ctx, instance, input.projectionState);
        }
      }
      await recordTransition(trx, request);
    });
  } else {
    const instance = await ctx.core.transaction().execute(async (trx) => {
      const locked = await lockInstance(trx, input.instanceId, input.from);
      await recordTransition(trx, request);
      return locked;
    });
    if (input.projectionState) await setProjectionState(ctx, instance, input.projectionState);
  }
  const updated = await getInstance(ctx, input.instanceId);
  if (!updated) throw new Error("Instância não encontrada depois da transição");
  return updated;
}

/**
 * US1 (SC-029): só `PRONTA`, com contratante elegível, schema compatível e caminho válido para o
 * primeiro administrador (`checkInstanceEligibility`).
 */
export async function activateInstance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
  reason: string | null = null,
): Promise<Instance> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  const eligibility = await checkInstanceEligibility(ctx, instance);
  if (!eligibility.eligible) throw instanceNotEligible(eligibility.reason);
  return writeLifecycleTransition(ctx, {
    direction: "conceder",
    instanceId,
    from: "PRONTA",
    to: "ATIVA",
    actor,
    reason,
    projectionState: "ativa",
  });
}

/**
 * US2 (SC-025 a SC-028): só `ATIVA`. Revoga a projeção antes do Core — a partir da confirmação,
 * toda nova autorização na instância é negada (`FR-005`); uma transação já autorizada antes
 * conclui sem interrupção (`FR-006`, sem matar conexão nem transação em curso).
 */
export async function suspendInstance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
  reason: string,
): Promise<Instance> {
  return writeLifecycleTransition(ctx, {
    direction: "revogar",
    instanceId,
    from: "ATIVA",
    to: "SUSPENSA",
    actor,
    reason,
    projectionState: "suspensa",
    endSessionsReason: "suspensao",
  });
}

/**
 * US3 (SC-029, CA-SC-009): só `SUSPENSA`, mesma elegibilidade de `activateInstance`. Não
 * restaura sessão revogada, não altera senha nem executa cobrança — não há código aqui que faça
 * qualquer uma das três coisas.
 */
export async function reactivateInstance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
  reason: string | null = null,
): Promise<Instance> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  const eligibility = await checkInstanceEligibility(ctx, instance);
  if (!eligibility.eligible) throw instanceNotEligible(eligibility.reason);
  return writeLifecycleTransition(ctx, {
    direction: "conceder",
    instanceId,
    from: "SUSPENSA",
    to: "ATIVA",
    actor,
    reason,
    projectionState: "ativa",
  });
}

/** US4 (SC-030): só `ATIVA`. Mesma ordem de revogação de `suspendInstance`. */
export async function enterMaintenance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
  reason: string,
): Promise<Instance> {
  return writeLifecycleTransition(ctx, {
    direction: "revogar",
    instanceId,
    from: "ATIVA",
    to: "MANUTENCAO",
    actor,
    reason,
    projectionState: "manutencao",
  });
}

export interface MaintenanceExitResult {
  /** `null` quando a checagem de saúde reprova: a instância permanece `MANUTENCAO`. */
  instance: Instance | null;
  health: HealthCheckResult;
}

/**
 * US4 (SC-030, FR-014): só `MANUTENCAO`. A checagem de saúde é sempre executada e registrada;
 * só com `healthy = true` a transição `MANUTENCAO → ATIVA` ocorre.
 */
export async function exitMaintenance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
): Promise<MaintenanceExitResult> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  if (instance.state !== "MANUTENCAO") throw conflictState();
  const health = await checkInstanceHealth(ctx, instance, "saida_manutencao");
  if (!health.healthy) return { instance: null, health };
  const updated = await writeLifecycleTransition(ctx, {
    direction: "conceder",
    instanceId,
    from: "MANUTENCAO",
    to: "ATIVA",
    actor,
    reason: null,
    projectionState: "ativa",
  });
  return { instance: updated, health };
}

export interface TerminateInstanceInput {
  reason: string;
  exportReference: string | null;
  retentionPolicy: string;
}

/**
 * US7 (SC-031, RN-SC-004): só `SUSPENSA`, terminal. A projeção permanece `suspensa` (já nega
 * acesso; `ENCERRADA` não precisa de um quinto valor na projeção, research.md R-06). Nenhuma
 * exclusão de recurso físico nem alteração de `instance_resource`.
 */
export async function terminateInstance(
  ctx: AppContext,
  instanceId: string,
  actor: TransitionActor,
  input: TerminateInstanceInput,
): Promise<Instance> {
  const at = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    await lockInstance(trx, instanceId, "SUSPENSA");
    await recordTransition(trx, {
      instanceId,
      from: "SUSPENSA",
      to: "ENCERRADA",
      actor,
      reason: input.reason,
      correlationId: null,
      at,
    });
    await sql`INSERT INTO instance_termination
        (id, instance_id, reason, export_reference, retention_policy, actor_id, created_at)
      VALUES (${uuidToBin(newId())}, ${uuidToBin(instanceId)}, ${input.reason},
              ${input.exportReference}, ${input.retentionPolicy},
              ${actor.id ? uuidToBin(actor.id) : null}, ${at})`.execute(trx);
  });
  const updated = await getInstance(ctx, instanceId);
  if (!updated) throw new Error("Instância não encontrada depois do encerramento");
  return updated;
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
