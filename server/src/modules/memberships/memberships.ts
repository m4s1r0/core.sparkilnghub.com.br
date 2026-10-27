import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { syncToInstances, type SyncOutcome } from "../access-projection/sync.js";
import { setAfterInstanceAccept, setInstanceAcceptor } from "../identity/accept-invitation.js";
import { maskEmail } from "../identity/email.js";
import { identityErrors, type RequestInfo } from "../identity/errors.js";
import { createInvitationTx, invitationLink, type Invitation } from "../identity/invitations.js";
import { setInstanceRevokeGuard } from "../identity/platform-admins.js";
import { recordSecurityEvent } from "../identity/security-events.js";
import { getInstance, type InstanceRef } from "../instances/instance-ref.js";

export type ProductRole = "administrador" | "colaborador";

/** Linha da lista de vínculos (contrato `Member`). */
export interface MemberItem {
  membershipId: string | null;
  invitationId: string | null;
  displayName: string | null;
  emailMasked: string | null;
  role: ProductRole;
  status: "ativo" | "revogado" | "convite_pendente";
  version: number | null;
}

interface MembershipRow {
  id: Buffer;
  account_id: Buffer;
  role: ProductRole;
  status: "ativo" | "revogado";
  version: number;
}

const event = (info: RequestInfo) => ({
  correlationId: info.correlationId,
  ip: info.ip,
  userAgent: info.userAgent,
});

/**
 * Vínculos e convites de uma instância. `emails`: a plataforma vê o e-mail mascarado de todos;
 * o administrador local só dos convites pendentes (contrato `Member`).
 */
export async function listInstanceMembers(
  ctx: AppContext,
  instanceId: string,
  emails: "todos" | "convites",
): Promise<MemberItem[]> {
  const { rows: memberships } = await sql<{
    id: Buffer;
    display_name: string;
    email_normalized: string;
    role: ProductRole;
    status: "ativo" | "revogado";
    version: number;
  }>`SELECT m.id, a.display_name, a.email_normalized, m.role, m.status, m.version
       FROM membership m JOIN account a ON a.id = m.account_id
      WHERE m.instance_id = ${uuidToBin(instanceId)}
      ORDER BY m.status, a.display_name`.execute(ctx.identity);
  const { rows: pending } = await sql<{ id: Buffer; email_normalized: string; role: ProductRole }>`
    SELECT id, email_normalized, role FROM invitation
     WHERE target = 'instancia' AND instance_id = ${uuidToBin(instanceId)}
       AND status = 'pendente' AND expires_at > ${ctx.clock()}
     ORDER BY created_at`.execute(ctx.identity);
  return [
    ...memberships.map((row) => ({
      membershipId: binToUuid(row.id),
      invitationId: null,
      displayName: row.display_name,
      emailMasked: emails === "todos" ? maskEmail(row.email_normalized) : null,
      role: row.role,
      status: row.status,
      version: row.version,
    })),
    ...pending.map((row) => ({
      membershipId: null,
      invitationId: binToUuid(row.id),
      displayName: null,
      emailMasked: maskEmail(row.email_normalized),
      role: row.role,
      status: "convite_pendente" as const,
      version: null,
    })),
  ];
}

/** Convite para a instância (FR-016, FR-021): link de uso único exibido uma vez (D-07). */
export async function inviteMember(
  ctx: AppContext,
  actorId: string,
  instance: InstanceRef,
  data: { email: string; role: ProductRole; initial?: boolean },
  info: RequestInfo,
): Promise<{ link: string; expiresAt: string }> {
  const now = ctx.clock();
  const created = await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const result = await createInvitationTx(trx, now, {
        target: "instancia",
        instanceId: instance.id,
        role: data.role,
        email: data.email,
        ...(data.initial !== undefined ? { isInitial: data.initial } : {}),
        createdBy: actorId,
      });
      await recordSecurityEvent(trx, {
        type: result.replaced ? "convite_reenviado" : "convite_criado",
        actorKind: "usuario",
        actorAccountId: actorId,
        instanceId: instance.id,
        result: "sucesso",
        detail: {
          convite: result.invitation.id,
          papel: data.role,
          inicial: result.invitation.isInitial,
        },
        ...event(info),
        at: now,
      });
      return result;
    }),
  );
  return {
    link: invitationLink(ctx.config, created.token),
    expiresAt: created.invitation.expiresAt.toISOString(),
  };
}

/**
 * Trava os caminhos de acesso da instância — administradores ativos e convites iniciais
 * pendentes no prazo — e devolve quantos restariam sem `excluding` (FR-021, COM-020).
 */
async function lockAccessPaths(
  trx: Kysely<unknown>,
  instanceId: string,
  now: Date,
): Promise<{ admins: Buffer[]; initialInvites: Buffer[] }> {
  const { rows: admins } = await sql<{ id: Buffer }>`
    SELECT id FROM membership
     WHERE instance_id = ${uuidToBin(instanceId)} AND status = 'ativo' AND role = 'administrador'
     ORDER BY id FOR UPDATE`.execute(trx);
  const { rows: invites } = await sql<{ id: Buffer; expires_at: Date }>`
    SELECT id, expires_at FROM invitation
     WHERE target = 'instancia' AND instance_id = ${uuidToBin(instanceId)}
       AND status = 'pendente' AND is_initial = TRUE
     ORDER BY id FOR UPDATE`.execute(trx);
  return {
    admins: admins.map((r) => r.id),
    initialInvites: invites.filter((r) => r.expires_at > now).map((r) => r.id),
  };
}

async function lockMembership(
  trx: Kysely<unknown>,
  instanceId: string,
  membershipId: string,
): Promise<MembershipRow> {
  const { rows } = await sql<MembershipRow & { instance_id: Buffer }>`
    SELECT id, account_id, instance_id, role, status, version FROM membership
     WHERE id = ${uuidToBin(membershipId)} FOR UPDATE`.execute(trx);
  const row = rows[0];
  // Vínculo de outra instância responde igual a inexistente (FR-029).
  if (!row || !row.instance_id.equals(uuidToBin(instanceId))) throw identityErrors.notFound();
  return row;
}

/** Quantos caminhos de acesso sobram depois de tirar o vínculo `removed`. */
const remainingPaths = (paths: { admins: Buffer[]; initialInvites: Buffer[] }, removed: Buffer) =>
  paths.admins.filter((id) => !id.equals(removed)).length + paths.initialInvites.length;

/**
 * Muda o papel com versão otimista (COM-027). Rebaixar o último administrador sem convite
 * inicial válido → 409. Réplica atualizada antes de responder (FR-027).
 */
export async function changeMemberRole(
  ctx: AppContext,
  actorId: string,
  instance: InstanceRef,
  membershipId: string,
  data: { role: ProductRole; reason: string; version: number },
  info: RequestInfo,
): Promise<SyncOutcome> {
  const now = ctx.clock();
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const paths = await lockAccessPaths(trx, instance.id, now);
      const row = await lockMembership(trx, instance.id, membershipId);
      if (row.status !== "ativo") throw identityErrors.notFound();
      if (row.version !== data.version) throw identityErrors.versionConflict();
      if (row.role === data.role) return;
      if (row.role === "administrador" && remainingPaths(paths, row.id) === 0) {
        throw identityErrors.lastAdmin();
      }
      await sql`UPDATE membership
                   SET role = ${data.role}, version = version + 1, changed_by = ${uuidToBin(actorId)},
                       changed_at = ${now}, change_reason = ${data.reason}
                 WHERE id = ${row.id}`.execute(trx);
      await recordSecurityEvent(trx, {
        type: "papel_alterado",
        actorKind: "usuario",
        actorAccountId: actorId,
        targetAccountId: binToUuid(row.account_id),
        instanceId: instance.id,
        result: "sucesso",
        detail: {
          vinculo: membershipId,
          antes: row.role,
          depois: data.role,
          motivo: data.reason,
          versao: row.version + 1,
        },
        ...event(info),
        at: now,
      });
    }),
  );
  return syncToInstances(ctx, [instance], { kind: "replicar_vinculo", payload: { membershipId } });
}

/**
 * Revoga o vínculo (FR-014, FR-020): só as sessões daquele contexto morrem; a conta e os outros
 * vínculos continuam (CA-SC-004). Revogar o último caminho de acesso → 409.
 */
export async function revokeMembership(
  ctx: AppContext,
  actorId: string,
  instance: InstanceRef,
  membershipId: string,
  data: { reason: string; version: number },
  info: RequestInfo,
): Promise<SyncOutcome> {
  const now = ctx.clock();
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const paths = await lockAccessPaths(trx, instance.id, now);
      const row = await lockMembership(trx, instance.id, membershipId);
      if (row.status !== "ativo") throw identityErrors.notFound();
      if (row.version !== data.version) throw identityErrors.versionConflict();
      if (row.role === "administrador" && remainingPaths(paths, row.id) === 0) {
        throw identityErrors.lastAdmin();
      }
      await sql`UPDATE membership
                   SET status = 'revogado', version = version + 1,
                       changed_by = ${uuidToBin(actorId)}, changed_at = ${now},
                       change_reason = ${data.reason}
                 WHERE id = ${row.id}`.execute(trx);
      await recordSecurityEvent(trx, {
        type: "vinculo_revogado",
        actorKind: "usuario",
        actorAccountId: actorId,
        targetAccountId: binToUuid(row.account_id),
        instanceId: instance.id,
        result: "sucesso",
        detail: {
          vinculo: membershipId,
          papel: row.role,
          antes: "ativo",
          depois: "revogado",
          motivo: data.reason,
        },
        ...event(info),
        at: now,
      });
    }),
  );
  return syncToInstances(ctx, [instance], { kind: "revogar_vinculo", payload: { membershipId } });
}

// Aceite de convite de instância (registrado em accept-invitation para evitar ciclo).
setInstanceAcceptor(async (_ctx, trx, invitation: Invitation, account, now) => {
  if (!invitation.instanceId) throw identityErrors.invitationInvalid();
  const { rows: admin } = await sql<{ status: string }>`
    SELECT status FROM platform_role WHERE account_id = ${uuidToBin(account.id)}`.execute(trx);
  if (admin[0]?.status === "ativo") {
    // Administrador da plataforma não tem vínculo com instâncias (FR-035, COM-010).
    throw new AppError(
      409,
      "CONFLICT_PLATFORM_ADMIN",
      "Administradores da plataforma não podem ter acesso a instâncias.",
    );
  }
  const { rows: existing } = await sql<{ id: Buffer }>`
    SELECT id FROM membership
     WHERE account_id = ${uuidToBin(account.id)} AND instance_id = ${uuidToBin(invitation.instanceId)}
       AND status = 'ativo' FOR UPDATE`.execute(trx);
  if (existing[0]) return { membershipId: binToUuid(existing[0].id) };
  const membershipId = newId();
  await sql`INSERT INTO membership (id, account_id, instance_id, role, status, version,
              created_by, created_at, changed_by, changed_at, change_reason)
            VALUES (${uuidToBin(membershipId)}, ${uuidToBin(account.id)},
                    ${uuidToBin(invitation.instanceId)}, ${invitation.role}, 'ativo', 1,
                    ${invitation.createdBy ? uuidToBin(invitation.createdBy) : null}, ${now},
                    ${uuidToBin(account.id)}, ${now}, 'convite aceito')`.execute(trx);
  return { membershipId };
});

setAfterInstanceAccept(async (ctx, membershipId, instanceId) => {
  const instance = await getInstance(ctx, instanceId);
  if (instance) {
    await syncToInstances(ctx, [instance], { kind: "replicar_vinculo", payload: { membershipId } });
  }
});

// Revogar o convite inicial que é o único caminho de acesso da instância → 409 (FR-021).
setInstanceRevokeGuard(async (trx, invitation, now) => {
  if (!invitation.isInitial || !invitation.instanceId) return;
  const paths = await lockAccessPaths(trx, invitation.instanceId, now);
  const others =
    paths.admins.length +
    paths.initialInvites.filter((id) => !id.equals(uuidToBin(invitation.id))).length;
  if (others === 0) throw identityErrors.lastAdmin();
});
