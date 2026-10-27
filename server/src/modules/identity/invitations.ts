import { sql, type Kysely } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { normalizeEmail } from "./email.js";
import { recordSecurityEvent } from "./security-events.js";

/** Convites valem 48 h e servem uma vez (COM-019, FR-016). */
export const INVITATION_TTL_MS = 48 * 3600_000;

export type InvitationTarget = "plataforma" | "instancia";

export interface Invitation {
  id: string;
  target: InvitationTarget;
  instanceId: string | null;
  role: string;
  emailNormalized: string;
  status: "pendente" | "aceito" | "revogado" | "expirado";
  isInitial: boolean;
  expiresAt: Date;
  createdBy: string | null;
}

interface Row {
  id: Buffer;
  target: InvitationTarget;
  instance_id: Buffer | null;
  role: string;
  email_normalized: string;
  status: Invitation["status"];
  is_initial: number;
  expires_at: Date;
  created_by: Buffer | null;
}

const COLUMNS = sql`id, target, instance_id, role, email_normalized, status, is_initial,
                    expires_at, created_by`;

const toInvitation = (row: Row): Invitation => ({
  id: binToUuid(row.id),
  target: row.target,
  instanceId: row.instance_id ? binToUuid(row.instance_id) : null,
  role: row.role,
  emailNormalized: row.email_normalized,
  status: row.status,
  isInitial: row.is_initial === 1,
  expiresAt: row.expires_at,
  createdBy: row.created_by ? binToUuid(row.created_by) : null,
});

/** Link exibido uma única vez a quem gerou o convite (D-07). */
export const invitationLink = (config: Config, token: string) =>
  `${config.PUBLIC_ORIGIN}/convite/${token}`;

/**
 * Cria convite na transação recebida. Reenvio: o pendente anterior do mesmo alvo e e-mail vira
 * `revogado` na mesma transação, travado com FOR UPDATE (FR-016). Só o sha256 do token é gravado.
 */
export async function createInvitationTx(
  trx: Kysely<unknown>,
  now: Date,
  data: {
    target: InvitationTarget;
    instanceId: string | null;
    role: string;
    email: string;
    isInitial?: boolean;
    createdBy: string | null;
  },
): Promise<{ invitation: Invitation; token: string; replaced: boolean }> {
  const email = normalizeEmail(data.email);
  const instance = data.instanceId ? uuidToBin(data.instanceId) : null;
  const { rows: pending } = await sql<{ id: Buffer; is_initial: number }>`
    SELECT id, is_initial FROM invitation
     WHERE target = ${data.target} AND instance_id <=> ${instance}
       AND email_normalized = ${email} AND status = 'pendente'
     FOR UPDATE`.execute(trx);
  for (const row of pending) {
    await sql`UPDATE invitation SET status = 'revogado', revoked_at = ${now},
                revoked_by = ${data.createdBy ? uuidToBin(data.createdBy) : null},
                revoke_reason = 'reenviado'
              WHERE id = ${row.id}`.execute(trx);
  }
  const id = newId();
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const isInitial = data.isInitial ?? pending.some((row) => row.is_initial === 1);
  await sql`INSERT INTO invitation (id, target, instance_id, role, email_normalized, token_hash,
              status, is_initial, expires_at, created_by, created_at)
            VALUES (${uuidToBin(id)}, ${data.target}, ${instance}, ${data.role}, ${email},
                    ${sha256Hex(token)}, 'pendente', ${isInitial}, ${expiresAt},
                    ${data.createdBy ? uuidToBin(data.createdBy) : null}, ${now})`.execute(trx);
  return {
    invitation: {
      id,
      target: data.target,
      instanceId: data.instanceId,
      role: data.role,
      emailNormalized: email,
      status: "pendente",
      isInitial,
      expiresAt,
      createdBy: data.createdBy,
    },
    token,
    replaced: pending.length > 0,
  };
}

/** Convite de administrador da plataforma (bootstrap e US2), com evento de segurança. */
export async function createPlatformInvitation(
  ctx: AppContext,
  data: { email: string; createdBy: string | null; correlationId?: string; ip?: string },
): Promise<{ token: string; link: string; expiresAt: Date; invitationId: string }> {
  const now = ctx.clock();
  const created = await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const result = await createInvitationTx(trx, now, {
        target: "plataforma",
        instanceId: null,
        role: "administrador",
        email: data.email,
        createdBy: data.createdBy,
      });
      await recordSecurityEvent(trx, {
        type: result.replaced ? "convite_reenviado" : "convite_criado",
        actorKind: data.createdBy ? "usuario" : "sistema",
        actorAccountId: data.createdBy,
        result: "sucesso",
        detail: { alvo: "plataforma", convite: result.invitation.id },
        correlationId: data.correlationId ?? null,
        ip: data.ip ?? null,
        at: now,
      });
      return result;
    }),
  );
  return {
    token: created.token,
    link: invitationLink(ctx.config, created.token),
    expiresAt: created.invitation.expiresAt,
    invitationId: created.invitation.id,
  };
}

/**
 * Convite utilizável: pendente e no prazo. Com `forUpdate`, trava a linha (aceite concorrente);
 * pendente vencido é marcado `expirado`.
 */
export async function findUsableInvitation(
  db: Kysely<unknown>,
  now: Date,
  token: string,
  options: { forUpdate?: boolean } = {},
): Promise<Invitation | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const lock = options.forUpdate ? sql`FOR UPDATE` : sql``;
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM invitation
     WHERE token_hash = ${sha256Hex(token)} ${lock}`.execute(db);
  const row = rows[0];
  if (!row || row.status !== "pendente") return null;
  if (row.expires_at <= now) {
    if (options.forUpdate) {
      await sql`UPDATE invitation SET status = 'expirado' WHERE id = ${row.id}`.execute(db);
    }
    return null;
  }
  return toInvitation(row);
}

export async function getInvitation(
  db: Kysely<unknown>,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<Invitation | null> {
  const lock = options.forUpdate ? sql`FOR UPDATE` : sql``;
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM invitation
     WHERE id = ${uuidToBin(id)} ${lock}`.execute(db);
  return rows[0] ? toInvitation(rows[0]) : null;
}

export async function markInvitationAccepted(
  db: Kysely<unknown>,
  now: Date,
  invitationId: string,
  accountId: string,
): Promise<void> {
  await sql`UPDATE invitation SET status = 'aceito', accepted_by = ${uuidToBin(accountId)},
              accepted_at = ${now}
            WHERE id = ${uuidToBin(invitationId)}`.execute(db);
}

export async function markInvitationRevoked(
  db: Kysely<unknown>,
  now: Date,
  invitationId: string,
  revokedBy: string | null,
  reason: string,
): Promise<void> {
  await sql`UPDATE invitation SET status = 'revogado', revoked_at = ${now},
              revoked_by = ${revokedBy ? uuidToBin(revokedBy) : null}, revoke_reason = ${reason}
            WHERE id = ${uuidToBin(invitationId)} AND status = 'pendente'`.execute(db);
}
