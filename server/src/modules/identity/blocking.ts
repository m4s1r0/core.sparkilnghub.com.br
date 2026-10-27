import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import type { SyncOutcome } from "../access-projection/sync.js";
import { getInstances } from "../instances/instance-ref.js";
import { bumpAuthRevision, getAccount } from "./accounts.js";
import { endAccountCoreSessions } from "./core-sessions.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { syncAccount } from "./recovery.js";
import { recordSecurityEvent } from "./security-events.js";

/** Instâncias afetadas por um bloqueio global (FR-022): vínculos ativos da conta. */
export async function blockPreview(
  ctx: AppContext,
  accountId: string,
): Promise<{ instances: { instanceId: string; name: string; role: string }[] }> {
  if (!(await getAccount(ctx.identity, accountId))) throw identityErrors.notFound();
  const { rows } = await sql<{ instance_id: Buffer; role: string }>`
    SELECT instance_id, role FROM membership
     WHERE account_id = ${uuidToBin(accountId)} AND status = 'ativo'`.execute(ctx.identity);
  const roles = new Map(rows.map((r) => [binToUuid(r.instance_id), r.role]));
  const instances = await getInstances(ctx, [...roles.keys()]);
  return {
    instances: instances.map((i) => ({
      instanceId: i.id,
      name: i.displayName,
      role: roles.get(i.id) ?? "colaborador",
    })),
  };
}

/**
 * Bloqueio global (FR-022, SC-012), exclusivo da plataforma: estado `bloqueada`, nova revisão de
 * autenticação, sessões do Core e de produtos encerradas em todas as instâncias. O último
 * administrador ativo da plataforma não pode ser bloqueado (COM-020).
 */
export async function blockAccount(
  ctx: AppContext,
  actorId: string,
  accountId: string,
  reason: string,
  info: RequestInfo,
): Promise<SyncOutcome> {
  const now = ctx.clock();
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const { rows: admins } = await sql<{ account_id: Buffer }>`
        SELECT p.account_id FROM platform_role p JOIN account a ON a.id = p.account_id
         WHERE p.status = 'ativo' AND a.status = 'ativa'
         ORDER BY p.account_id FOR UPDATE`.execute(trx);
      const account = await getAccount(trx, accountId, { forUpdate: true });
      if (!account) throw identityErrors.notFound();
      const isAdmin = admins.some((r) => r.account_id.equals(uuidToBin(accountId)));
      if (isAdmin && admins.length <= 1) throw identityErrors.lastAdmin();
      if (account.status === "bloqueada") return;
      await bumpAuthRevision(trx, now, accountId, "bloqueada");
      await endAccountCoreSessions(trx, now, accountId, "bloqueio");
      await recordSecurityEvent(trx, {
        type: "bloqueio",
        actorKind: "usuario",
        actorAccountId: actorId,
        targetAccountId: accountId,
        result: "sucesso",
        detail: { antes: account.status, depois: "bloqueada", motivo: reason },
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
  return syncAccount(ctx, accountId, "bloqueio");
}

/**
 * Desbloqueio (bloqueada → ativa), com motivo. Sessões encerradas no bloqueio continuam
 * encerradas: a revisão de autenticação incrementada no bloqueio as invalida para sempre.
 */
export async function unblockAccount(
  ctx: AppContext,
  actorId: string,
  accountId: string,
  reason: string,
  info: RequestInfo,
): Promise<SyncOutcome> {
  const now = ctx.clock();
  await ctx.identity.transaction().execute(async (trx) => {
    const account = await getAccount(trx, accountId, { forUpdate: true });
    if (!account) throw identityErrors.notFound();
    if (account.status !== "bloqueada") {
      throw new AppError(409, "CONFLICT_STATE", "A conta não está bloqueada.");
    }
    await sql`UPDATE account SET status = 'ativa', updated_at = ${now}
               WHERE id = ${uuidToBin(accountId)}`.execute(trx);
    await recordSecurityEvent(trx, {
      type: "desbloqueio",
      actorKind: "usuario",
      actorAccountId: actorId,
      targetAccountId: accountId,
      result: "sucesso",
      detail: { antes: "bloqueada", depois: "ativa", motivo: reason },
      correlationId: info.correlationId,
      ip: info.ip,
      userAgent: info.userAgent,
      at: now,
    });
  });
  return syncAccount(ctx, accountId, null);
}
