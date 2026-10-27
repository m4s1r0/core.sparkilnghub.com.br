import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import type { InstanceRef } from "../instances/instance-ref.js";
import { readAccountState, readMemberState } from "./source.js";
import {
  type CoreEndReason,
  revokeMember,
  setInstanceRevision,
  updateAccountState,
  upsertMember,
} from "./writer.js";

export type SyncJobKind =
  | "revogar_sessoes_conta"
  | "revogar_vinculo"
  | "replicar_vinculo"
  | "revisao_instancia"
  | "reconciliar";

/** Resultado por instância de uma operação que alcança a projeção (FR-027, contrato `SyncOutcome`). */
export interface SyncOutcome {
  instances: { instanceId: string; status: "aplicada" | "pendente" }[];
}

export interface SyncTarget {
  kind: SyncJobKind;
  /** Identificadores da fonte; nunca define a instância alvo (data-model). */
  payload: Record<string, unknown>;
  /** Aplicação imediata; padrão: `runSyncJob`, a mesma rotina do trabalhador. */
  apply?: (instance: InstanceRef) => Promise<void>;
}

/** Reconciliação registrada aqui para evitar dependência circular com reconcile.ts. */
let reconcileHandler: ((ctx: AppContext, instance: InstanceRef) => Promise<unknown>) | undefined;
export function setReconcileHandler(
  handler: (ctx: AppContext, instance: InstanceRef) => Promise<unknown>,
): void {
  reconcileHandler = handler;
}

const text = (value: unknown, name: string): string => {
  if (typeof value !== "string") throw new Error(`payload sem ${name}`);
  return value;
};

/**
 * Executa um tipo de sincronização numa instância relendo o estado ATUAL da fonte: reaplicar uma
 * tarefa antiga nunca restaura um estado anterior. Usada na aplicação imediata e pelo trabalhador.
 */
export async function runSyncJob(
  ctx: AppContext,
  instance: InstanceRef,
  kind: SyncJobKind,
  payload: Record<string, unknown>,
): Promise<void> {
  if (payload.instanceId !== undefined && payload.instanceId !== instance.id) {
    throw new SyncPayloadError("payload cita outra instância");
  }
  switch (kind) {
    case "replicar_vinculo":
    case "revogar_vinculo": {
      const member = await readMemberState(ctx, text(payload.membershipId, "membershipId"));
      if (!member) return;
      if (member.instanceId !== instance.id) {
        throw new SyncPayloadError("vínculo de outra instância");
      }
      if (member.status === "revogado") await revokeMember(ctx, instance, member);
      else await upsertMember(ctx, instance, member);
      return;
    }
    case "revogar_sessoes_conta": {
      const account = await readAccountState(ctx, text(payload.accountId, "accountId"));
      if (!account) return;
      const reason = (payload.reason ?? null) as CoreEndReason | null;
      await updateAccountState(ctx, instance, account, reason);
      return;
    }
    case "revisao_instancia":
      await setInstanceRevision(ctx, instance);
      return;
    case "reconciliar":
      if (!reconcileHandler) throw new Error("reconciliação não registrada");
      await reconcileHandler(ctx, instance);
      return;
  }
}

/** Erro definitivo (não adianta repetir): a tarefa termina como `falhou`. */
export class SyncPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncPayloadError";
  }
}

export async function enqueueSyncJob(
  ctx: AppContext,
  instanceId: string,
  kind: SyncJobKind,
  payload: Record<string, unknown>,
  lastError: string | null = null,
): Promise<void> {
  const now = ctx.clock();
  await sql`INSERT INTO access_sync_job
      (id, instance_id, kind, payload, status, attempts, next_attempt_at, last_error, created_at)
    VALUES (${uuidToBin(newId())}, ${uuidToBin(instanceId)}, ${kind}, ${JSON.stringify(payload)},
            'pendente', 0, ${now}, ${lastError}, ${now})`.execute(ctx.core);
}

/** Mensagem segura para `last_error`: só o código do erro, nunca SQL ou valores (FR-016). */
export function safeError(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code.slice(0, 100);
  if (error instanceof SyncPayloadError) return error.message;
  return error instanceof Error ? error.name.slice(0, 100) : "ERRO";
}

/**
 * Aplica a sincronização em cada instância afetada antes de responder (FR-027). Instância
 * inacessível vira tarefa persistente e aparece como `pendente`; nunca como concluída.
 */
export async function syncToInstances(
  ctx: AppContext,
  instances: readonly InstanceRef[],
  target: SyncTarget,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { instances: [] };
  for (const instance of instances) {
    try {
      await (target.apply
        ? target.apply(instance)
        : runSyncJob(ctx, instance, target.kind, target.payload));
      outcome.instances.push({ instanceId: instance.id, status: "aplicada" });
    } catch (error) {
      ctx.logger.warn(
        { err: error, instanceId: instance.id, kind: target.kind },
        "Projeção de acesso inacessível; sincronização pendente",
      );
      await enqueueSyncJob(ctx, instance.id, target.kind, target.payload, safeError(error));
      outcome.instances.push({ instanceId: instance.id, status: "pendente" });
    }
  }
  return outcome;
}
