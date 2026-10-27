import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import { endAccountCoreSessions } from "./core-sessions.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { getInvitation, markInvitationRevoked } from "./invitations.js";
import { recordSecurityEvent } from "./security-events.js";

/** Linha da lista de administradores (contrato `PlatformAdmin`), sem segredos. */
export interface PlatformAdminItem {
  accountId: string | null;
  invitationId: string | null;
  displayName: string | null;
  email: string;
  status: "ativo" | "inativo" | "convite_pendente";
  lastLoginAt: string | null;
}

export async function listPlatformAdmins(ctx: AppContext): Promise<PlatformAdminItem[]> {
  const { rows: admins } = await sql<{
    account_id: Buffer;
    display_name: string;
    email_display: string;
    status: "ativo" | "inativo";
    last_login: Date | null;
  }>`SELECT p.account_id, a.display_name, a.email_display, p.status,
            (SELECT MAX(s.mfa_confirmed_at) FROM core_session s
              WHERE s.account_id = p.account_id) AS last_login
       FROM platform_role p JOIN account a ON a.id = p.account_id
      ORDER BY a.display_name`.execute(ctx.identity);
  const { rows: pending } = await sql<{ id: Buffer; email_normalized: string }>`
    SELECT id, email_normalized FROM invitation
     WHERE target = 'plataforma' AND status = 'pendente' AND expires_at > ${ctx.clock()}
     ORDER BY created_at`.execute(ctx.identity);
  return [
    ...admins.map((row) => ({
      accountId: binToUuid(row.account_id),
      invitationId: null,
      displayName: row.display_name,
      email: row.email_display,
      status: row.status,
      lastLoginAt: row.last_login?.toISOString() ?? null,
    })),
    ...pending.map((row) => ({
      accountId: null,
      invitationId: binToUuid(row.id),
      displayName: null,
      email: row.email_normalized,
      status: "convite_pendente" as const,
      lastLoginAt: null,
    })),
  ];
}

/**
 * Inativa o acesso de um administrador (FR-009, FR-014). Trava TODAS as linhas ativas de
 * `platform_role` antes de contar: duas inativações simultâneas dos dois últimos serializam e a
 * segunda vê só um ativo (COM-020, T-05, CS-004). As sessões do Core do alvo são encerradas.
 */
export async function deactivatePlatformAdmin(
  ctx: AppContext,
  actorId: string,
  targetId: string,
  reason: string,
  info: RequestInfo,
): Promise<void> {
  const now = ctx.clock();
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const { rows: active } = await sql<{ account_id: Buffer }>`
        SELECT account_id FROM platform_role WHERE status = 'ativo'
         ORDER BY account_id FOR UPDATE`.execute(trx);
      const target = uuidToBin(targetId);
      if (!active.some((row) => row.account_id.equals(target))) {
        const { rows } = await sql<{ status: string }>`
          SELECT status FROM platform_role WHERE account_id = ${target}`.execute(trx);
        if (rows[0]?.status === "inativo") return;
        throw identityErrors.notFound();
      }
      if (active.length <= 1) throw identityErrors.lastAdmin();
      await sql`UPDATE platform_role
                   SET status = 'inativo', changed_by = ${uuidToBin(actorId)}, changed_at = ${now},
                       change_reason = ${reason}
                 WHERE account_id = ${target}`.execute(trx);
      await endAccountCoreSessions(trx, now, targetId, "inativacao");
      await recordSecurityEvent(trx, {
        type: "admin_inativado",
        actorKind: "usuario",
        actorAccountId: actorId,
        targetAccountId: targetId,
        result: "sucesso",
        detail: { antes: "ativo", depois: "inativo", motivo: reason },
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
}

/** Reativa o acesso; sessões anteriores continuam encerradas (novo login obrigatório). */
export async function reactivatePlatformAdmin(
  ctx: AppContext,
  actorId: string,
  targetId: string,
  reason: string,
  info: RequestInfo,
): Promise<void> {
  const now = ctx.clock();
  await ctx.identity.transaction().execute(async (trx) => {
    const target = uuidToBin(targetId);
    const { rows } = await sql<{ status: string }>`
      SELECT status FROM platform_role WHERE account_id = ${target} FOR UPDATE`.execute(trx);
    if (!rows[0]) throw identityErrors.notFound();
    if (rows[0].status === "ativo") return;
    await sql`UPDATE platform_role
                 SET status = 'ativo', changed_by = ${uuidToBin(actorId)}, changed_at = ${now},
                     change_reason = ${reason}
               WHERE account_id = ${target}`.execute(trx);
    await endAccountCoreSessions(trx, now, targetId, "inativacao");
    await recordSecurityEvent(trx, {
      type: "admin_reativado",
      actorKind: "usuario",
      actorAccountId: actorId,
      targetAccountId: targetId,
      result: "sucesso",
      detail: { antes: "inativo", depois: "ativo", motivo: reason },
      correlationId: info.correlationId,
      ip: info.ip,
      userAgent: info.userAgent,
      at: now,
    });
  });
}

/**
 * Regra extra para revogar convite de instância (convite inicial que é o único caminho de acesso,
 * FR-021). Registrada pelo módulo de vínculos para evitar dependência circular.
 */
type RevokeGuard = (
  trx: AppContext["identity"],
  invitation: NonNullable<Awaited<ReturnType<typeof getInvitation>>>,
  now: Date,
) => Promise<void>;
let instanceRevokeGuard: RevokeGuard | undefined;
export function setInstanceRevokeGuard(guard: RevokeGuard): void {
  instanceRevokeGuard = guard;
}

/**
 * Revoga convite pendente (FR-016). Repetir sobre convite já revogado responde como sucesso;
 * aceito, expirado ou inexistente → 404. `instanceId` restringe ao convite daquela instância
 * (contrato de vínculos locais: convite de outra instância = inexistente).
 */
export async function revokeInvitation(
  ctx: AppContext,
  actorId: string | null,
  invitationId: string,
  reason: string,
  info: RequestInfo,
  options: { instanceId?: string } = {},
): Promise<void> {
  const now = ctx.clock();
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const invitation = await getInvitation(trx, invitationId, { forUpdate: true });
      if (
        !invitation ||
        (options.instanceId !== undefined && invitation.instanceId !== options.instanceId)
      ) {
        throw identityErrors.invitationInvalid();
      }
      if (invitation.status === "revogado") return;
      if (invitation.status !== "pendente" || invitation.expiresAt <= now) {
        throw identityErrors.invitationInvalid();
      }
      if (invitation.target === "instancia" && instanceRevokeGuard) {
        await instanceRevokeGuard(trx, invitation, now);
      }
      await markInvitationRevoked(trx, now, invitation.id, actorId, reason);
      await recordSecurityEvent(trx, {
        type: "convite_revogado",
        actorKind: "usuario",
        actorAccountId: actorId,
        instanceId: invitation.instanceId,
        result: "sucesso",
        detail: { convite: invitation.id, alvo: invitation.target, motivo: reason },
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
}
