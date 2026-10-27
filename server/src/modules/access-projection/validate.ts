import { sql, type Kysely } from "kysely";
import { sha256Hex } from "../../platform/crypto/index.js";
import { binToUuid } from "../../platform/ids.js";
import type { ProductRole } from "./source.js";

/** Contexto mínimo de uma sessão de produto válida (constituição III). */
export interface ValidatedSession {
  idHash: string;
  accountId: string;
  membershipId: string;
  displayName: string;
  role: ProductRole;
  authorizationRevision: number;
  lastSeenAt: Date;
}

interface Row {
  id_hash: string;
  account_id: Buffer;
  membership_id: Buffer;
  display_name: string;
  role: ProductRole;
  authorization_revision: number;
  last_seen_at: Date;
}

/**
 * Regra normativa do contrato de dados (contracts/access-projection.md): a sessão é válida se, e
 * somente se, esta consulta devolve uma linha. `db` é o banco de acesso de UMA instância; `now`
 * explícito serve aos testes e ao Core, o produto pode omitir (relógio do MySQL).
 */
export async function validateInstanceSession(
  db: Kysely<unknown>,
  token: string,
  now?: Date,
): Promise<ValidatedSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const at = now ? sql`${now}` : sql`UTC_TIMESTAMP(6)`;
  const { rows } = await sql<Row>`
    SELECT s.id_hash, s.account_id, s.membership_id, m.display_name, m.role,
           i.authorization_revision, s.last_seen_at
      FROM access_session s
      JOIN access_member m ON m.membership_id = s.membership_id
      JOIN access_instance i ON TRUE
     WHERE s.id_hash = ${sha256Hex(token)}
       AND s.ended_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM access_session_logout l WHERE l.id_hash = s.id_hash)
       AND s.expires_at > ${at}
       AND s.last_seen_at > ${at} - INTERVAL s.idle_timeout_seconds SECOND
       AND s.auth_revision = m.account_auth_revision
       AND m.status = 'ativo'
       AND m.account_status = 'ativa'
       AND i.state = 'ativa'`.execute(db);
  const row = rows[0];
  if (!row) return null;
  return {
    idHash: row.id_hash,
    accountId: binToUuid(row.account_id),
    membershipId: binToUuid(row.membership_id),
    displayName: row.display_name,
    role: row.role,
    authorizationRevision: row.authorization_revision,
    lastSeenAt: row.last_seen_at,
  };
}
