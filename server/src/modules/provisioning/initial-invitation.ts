import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { uuidToBin } from "../../platform/ids.js";
import { recordAudit } from "../audit/audit.js";
import { createInvitationTx, invitationLink } from "../identity/invitations.js";
import { recordSecurityEvent } from "../identity/security-events.js";
import { hasActiveAdmin } from "../instances/eligibility.js";
import { getInstance } from "../instances/instances.js";
import { conflictState } from "../instances/transitions.js";

export type InitialInvitationStatus =
  "aguardando_emissao" | "emitido" | "expirado" | "aceito" | "revogado" | "inexistente";

/**
 * Situação do convite inicial (research.md R-12), independente da prontidão técnica (FR-036):
 * calculada do convite inicial mais recente da instância.
 */
export async function initialInvitationStatus(
  ctx: AppContext,
  instanceId: string,
): Promise<{ status: InitialInvitationStatus; expiresAt: string | null }> {
  const { rows } = await sql<{
    status: "pendente" | "aceito" | "revogado" | "expirado";
    link_issued_at: Date | null;
    expires_at: Date;
  }>`SELECT status, link_issued_at, expires_at FROM invitation
      WHERE target = 'instancia' AND instance_id = ${uuidToBin(instanceId)} AND is_initial = TRUE
      ORDER BY (status = 'aceito') DESC, created_at DESC, id DESC LIMIT 1`.execute(ctx.identity);
  const row = rows[0];
  if (!row) return { status: "inexistente", expiresAt: null };
  if (row.status === "aceito") return { status: "aceito", expiresAt: null };
  if (row.status === "revogado") return { status: "revogado", expiresAt: null };
  if (row.status === "expirado" || row.expires_at <= ctx.clock()) {
    return { status: "expirado", expiresAt: row.expires_at.toISOString() };
  }
  if (row.link_issued_at === null) return { status: "aguardando_emissao", expiresAt: null };
  return { status: "emitido", expiresAt: row.expires_at.toISOString() };
}

/**
 * Emissão (e reemissão) do link do convite inicial de uma instância `PRONTA` (FR-035, D-07): o
 * reenvio de F01 revoga o pendente e cria outro de 48 h; o link aparece uma única vez. Não toca
 * em banco, credencial nem migrações da instância (FR-036).
 */
export async function issueInitialInvitation(
  ctx: AppContext,
  instanceId: string,
  actor: { accountId: string; correlationId: string; ip?: string },
): Promise<{ link: string; expiresAt: string }> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  if (!instance.initialAdminEmail) throw conflictState();
  // F03 (FR-032, SC-024): além de PRONTA, também permitida em ATIVA sem administrador ativo —
  // deixa de ser permitida assim que houver um.
  const eligibleState =
    instance.state === "PRONTA" ||
    (instance.state === "ATIVA" && !(await hasActiveAdmin(ctx, instanceId)));
  if (!eligibleState) throw conflictState();
  const email = instance.initialAdminEmail;
  const now = ctx.clock();
  const created = await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM invitation
         WHERE target = 'instancia' AND instance_id = ${uuidToBin(instanceId)}
           AND is_initial = TRUE AND status = 'aceito'`.execute(trx);
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw new AppError(
          409,
          "CONFLICT_INITIAL_INVITATION_ACCEPTED",
          "O convite inicial já foi aceito. Gerencie os vínculos da instância.",
        );
      }
      const result = await createInvitationTx(trx, now, {
        target: "instancia",
        instanceId,
        role: "administrador",
        email,
        isInitial: true,
        createdBy: actor.accountId,
      });
      await recordSecurityEvent(trx, {
        type: result.replaced ? "convite_reenviado" : "convite_criado",
        actorKind: "usuario",
        actorAccountId: actor.accountId,
        instanceId,
        result: "sucesso",
        detail: { alvo: "instancia", convite: result.invitation.id, inicial: true },
        correlationId: actor.correlationId,
        ip: actor.ip ?? null,
        at: now,
      });
      return result;
    }),
  );
  await recordAudit(ctx.core, {
    actorKind: "usuario",
    actorId: actor.accountId,
    action: "convite_inicial.emitido",
    objectType: "instancia",
    objectId: instanceId,
    changes: { invitation: [null, created.invitation.id] },
    correlationId: actor.correlationId,
    at: now,
  });
  return {
    link: invitationLink(ctx.config, created.token),
    expiresAt: created.invitation.expiresAt.toISOString(),
  };
}
