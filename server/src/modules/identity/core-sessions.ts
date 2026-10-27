import { sql, type Kysely } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import { recordSecurityEvent } from "./security-events.js";

/** Sessão do painel: 30 min de inatividade e 8 h absolutas (COM-016, FR-013). */
export const CORE_SESSION_IDLE_MS = 30 * 60_000;
export const CORE_SESSION_ABSOLUTE_MS = 8 * 3600_000;
/** Atividade gravada no máximo uma vez por minuto (R-04). */
const ACTIVITY_WRITE_MS = 60_000;

export type CoreEndReason =
  "logout" | "expirada" | "revogada" | "senha_trocada" | "bloqueio" | "inativacao";

export interface CoreSession {
  idHash: string;
  accountId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  /** Nulo enquanto o segundo fator não foi confirmado (sessão pré-MFA). */
  mfaConfirmedAt: Date | null;
  authRevision: number;
}

export interface SessionAccount {
  id: string;
  email: string;
  displayName: string;
}

export type ResolvedSession =
  | { ok: true; session: CoreSession; account: SessionAccount }
  | { ok: false; reason: "ausente" | "expirada" | "revogada" };

interface Row {
  id_hash: string;
  account_id: Buffer;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  mfa_confirmed_at: Date | null;
  auth_revision: number;
  ended_at: Date | null;
  account_status: string;
  account_revision: number;
  email_display: string;
  display_name: string;
  role_status: string | null;
}

/** Cria a sessão; só o sha256 do token é persistido (R-04). */
export async function createCoreSession(
  db: Kysely<unknown>,
  now: Date,
  accountId: string,
  authRevision: number,
  mfaConfirmedAt: Date | null,
): Promise<{ token: string; idHash: string }> {
  const token = randomToken();
  const idHash = sha256Hex(token);
  await sql`INSERT INTO core_session
      (id_hash, account_id, created_at, last_seen_at, expires_at, mfa_confirmed_at, auth_revision)
    VALUES (${idHash}, ${uuidToBin(accountId)}, ${now}, ${now},
            ${new Date(now.getTime() + CORE_SESSION_ABSOLUTE_MS)}, ${mfaConfirmedAt},
            ${authRevision})`.execute(db);
  return { token, idHash };
}

export async function endCoreSession(
  db: Kysely<unknown>,
  now: Date,
  idHash: string,
  reason: CoreEndReason,
): Promise<void> {
  await sql`UPDATE core_session SET ended_at = ${now}, end_reason = ${reason}
             WHERE id_hash = ${idHash} AND ended_at IS NULL`.execute(db);
}

/** Encerra todas as sessões do Core da conta (troca de senha, bloqueio, inativação). */
export async function endAccountCoreSessions(
  db: Kysely<unknown>,
  now: Date,
  accountId: string,
  reason: CoreEndReason,
): Promise<number> {
  const result = await sql`UPDATE core_session SET ended_at = ${now}, end_reason = ${reason}
             WHERE account_id = ${uuidToBin(accountId)} AND ended_at IS NULL`.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export async function markSessionMfa(db: Kysely<unknown>, idHash: string, at: Date | null) {
  await sql`UPDATE core_session SET mfa_confirmed_at = ${at} WHERE id_hash = ${idHash}`.execute(db);
}

/**
 * Resolve o cookie de sessão pelas regras do data-model: não encerrada, dentro das expirações,
 * revisão igual à da conta, conta ativa e papel de plataforma ativo. Sessão inválida é encerrada
 * com o motivo. Renova `last_seen_at` no máximo a cada 60 s.
 */
export async function resolveCoreSession(
  ctx: AppContext,
  token: string | undefined,
): Promise<ResolvedSession> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, reason: "ausente" };
  const idHash = sha256Hex(token);
  const { rows } = await sql<Row>`
    SELECT s.id_hash, s.account_id, s.created_at, s.last_seen_at, s.expires_at,
           s.mfa_confirmed_at, s.auth_revision, s.ended_at,
           a.status AS account_status, a.auth_revision AS account_revision,
           a.email_display, a.display_name, p.status AS role_status
      FROM core_session s
      JOIN account a ON a.id = s.account_id
      LEFT JOIN platform_role p ON p.account_id = s.account_id
     WHERE s.id_hash = ${idHash}`.execute(ctx.identity);
  const row = rows[0];
  if (!row || row.ended_at) return { ok: false, reason: "ausente" };

  const now = ctx.clock();
  if (now >= row.expires_at || now.getTime() - row.last_seen_at.getTime() >= CORE_SESSION_IDLE_MS) {
    await endCoreSession(ctx.identity, now, idHash, "expirada");
    await recordSecurityEvent(ctx.identity, {
      type: "sessao_expirada",
      actorKind: "sistema",
      targetAccountId: binToUuid(row.account_id),
      result: "sucesso",
      at: now,
    });
    return { ok: false, reason: "expirada" };
  }
  if (
    row.auth_revision !== row.account_revision ||
    row.account_status !== "ativa" ||
    row.role_status !== "ativo"
  ) {
    await endCoreSession(ctx.identity, now, idHash, "revogada");
    return { ok: false, reason: "revogada" };
  }
  let lastSeenAt = row.last_seen_at;
  if (now.getTime() - lastSeenAt.getTime() >= ACTIVITY_WRITE_MS) {
    await sql`UPDATE core_session SET last_seen_at = ${now} WHERE id_hash = ${idHash}`.execute(
      ctx.identity,
    );
    lastSeenAt = now;
  }
  const accountId = binToUuid(row.account_id);
  return {
    ok: true,
    session: {
      idHash,
      accountId,
      createdAt: row.created_at,
      lastSeenAt,
      expiresAt: row.expires_at,
      mfaConfirmedAt: row.mfa_confirmed_at,
      authRevision: row.auth_revision,
    },
    account: { id: accountId, email: row.email_display, displayName: row.display_name },
  };
}
