import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { syncToInstances, type SyncOutcome } from "../access-projection/sync.js";
import { accountInstanceIds } from "../access-projection/source.js";
import { getInstances } from "../instances/instances.js";
import {
  bumpAuthRevision,
  findAccountByEmail,
  getAccount,
  updatePasswordHash,
} from "./accounts.js";
import { endAccountCoreSessions } from "./core-sessions.js";
import { normalizeEmail } from "./email.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { checkPasswordPolicy, hashPassword } from "./password.js";
import { recordSecurityEvent } from "./security-events.js";
import { registerFailure, throttleRules, throttleStatus } from "./throttle.js";
import { AppError } from "../../app/errors.js";

/** Link de recuperação: 30 min e uso único (COM-019, FR-016). */
export const RESET_TTL_MS = 30 * 60_000;

const resetInvalid = () =>
  new AppError(404, "RESET_INVALID", "Link de recuperação inválido, já usado ou expirado.");

/**
 * Pedido público de recuperação (D-07, R-11): sempre a mesma resposta, exista a conta ou não;
 * o pedido entra na fila do administrador. Limitado a 5 por e-mail por hora e 20 por origem em
 * 15 min, com a mesma mensagem nos dois casos.
 */
export async function requestRecovery(
  ctx: AppContext,
  email: string,
  info: RequestInfo,
): Promise<void> {
  const now = ctx.clock();
  const normalized = normalizeEmail(email);
  const rules = [throttleRules.recoveryEmail(normalized), throttleRules.recoveryOrigin(info.ip)];
  const locked = await throttleStatus(ctx, rules);
  if (locked) throw identityErrors.throttled(locked);
  await registerFailure(ctx, rules);
  const account = await findAccountByEmail(ctx.identity, normalized);
  await sql`INSERT INTO recovery_request (id, email_normalized, account_id, created_at)
            VALUES (${uuidToBin(newId())}, ${normalized},
                    ${account ? uuidToBin(account.id) : null}, ${now})`.execute(ctx.identity);
  await recordSecurityEvent(ctx.identity, {
    type: "pedido_recuperacao",
    actorKind: "usuario",
    targetAccountId: account?.id ?? null,
    result: "sucesso",
    correlationId: info.correlationId,
    ip: info.ip,
    userAgent: info.userAgent,
    at: now,
  });
}

export async function listRecoveryRequests(ctx: AppContext) {
  const { rows } = await sql<{
    id: Buffer;
    email_normalized: string;
    account_id: Buffer | null;
    created_at: Date;
  }>`SELECT id, email_normalized, account_id, created_at FROM recovery_request
      WHERE handled_at IS NULL ORDER BY created_at`.execute(ctx.identity);
  return rows.map((row) => ({
    id: binToUuid(row.id),
    email: row.email_normalized,
    accountId: row.account_id ? binToUuid(row.account_id) : null,
    createdAt: row.created_at.toISOString(),
  }));
}

/**
 * Link de recuperação gerado por administrador da plataforma (R-11): exibido uma vez; o novo
 * invalida os anteriores não usados e marca como atendidos os pedidos pendentes do e-mail.
 */
export async function issuePasswordReset(
  ctx: AppContext,
  actorId: string,
  accountId: string,
  info: RequestInfo,
): Promise<{ link: string; expiresAt: string }> {
  const now = ctx.clock();
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MS);
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const account = await getAccount(trx, accountId, { forUpdate: true });
      if (!account) throw identityErrors.notFound();
      await sql`UPDATE password_reset SET expires_at = ${now}
                 WHERE account_id = ${uuidToBin(accountId)} AND used_at IS NULL
                   AND expires_at > ${now}`.execute(trx);
      await sql`INSERT INTO password_reset (token_hash, account_id, created_by, created_at, expires_at)
                VALUES (${sha256Hex(token)}, ${uuidToBin(accountId)}, ${uuidToBin(actorId)},
                        ${now}, ${expiresAt})`.execute(trx);
      await sql`UPDATE recovery_request SET handled_at = ${now}, handled_by = ${uuidToBin(actorId)}
                 WHERE email_normalized = ${account.emailNormalized} AND handled_at IS NULL`.execute(
        trx,
      );
      await recordSecurityEvent(trx, {
        type: "link_recuperacao_gerado",
        actorKind: "usuario",
        actorAccountId: actorId,
        targetAccountId: accountId,
        result: "sucesso",
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
  return {
    link: `${ctx.config.PUBLIC_ORIGIN}/recuperar/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Revogação em todas as instâncias onde a conta tem vínculo (FR-014, FR-027). */
export async function syncAccount(
  ctx: AppContext,
  accountId: string,
  reason: "senha_trocada" | "bloqueio" | null,
): Promise<SyncOutcome> {
  const instances = await getInstances(ctx, await accountInstanceIds(ctx, accountId));
  return syncToInstances(ctx, instances, {
    kind: "revogar_sessoes_conta",
    payload: { accountId, reason },
  });
}

/**
 * Nova senha pelo link (FR-023, COM-018): política de senha, revisão de autenticação
 * incrementada e todas as sessões da conta encerradas — Core e produtos — antes de responder.
 */
export async function completePasswordReset(
  ctx: AppContext,
  token: string,
  password: string,
  info: RequestInfo,
): Promise<SyncOutcome> {
  const now = ctx.clock();
  const rule = throttleRules.inviteOrigin(info.ip);
  const locked = await throttleStatus(ctx, [rule]);
  if (locked) throw identityErrors.throttled(locked);
  const invalid = async () => {
    await registerFailure(ctx, [rule]);
    return resetInvalid();
  };
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw await invalid();

  const { rows } = await sql<{ account_id: Buffer; used_at: Date | null; expires_at: Date }>`
    SELECT account_id, used_at, expires_at FROM password_reset
     WHERE token_hash = ${sha256Hex(token)}`.execute(ctx.identity);
  const preview = rows[0];
  if (!preview || preview.used_at || preview.expires_at <= now) throw await invalid();
  const accountId = binToUuid(preview.account_id);
  const account = await getAccount(ctx.identity, accountId);
  if (!account) throw await invalid();
  const problem = checkPasswordPolicy(password, {
    email: account.emailNormalized,
    displayName: account.displayName,
  });
  if (problem) throw identityErrors.passwordPolicy(problem);
  const hash = await hashPassword(password);

  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const result = await sql`UPDATE password_reset SET used_at = ${now}
         WHERE token_hash = ${sha256Hex(token)} AND used_at IS NULL AND expires_at > ${now}`.execute(
        trx,
      );
      if (Number(result.numAffectedRows ?? 0) !== 1) throw resetInvalid();
      await updatePasswordHash(trx, now, accountId, hash);
      await bumpAuthRevision(trx, now, accountId);
      await endAccountCoreSessions(trx, now, accountId, "senha_trocada");
      await recordSecurityEvent(trx, {
        type: "senha_trocada",
        actorKind: "usuario",
        actorAccountId: accountId,
        targetAccountId: accountId,
        result: "sucesso",
        detail: { via: "link_recuperacao" },
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
  return syncAccount(ctx, accountId, "senha_trocada");
}
