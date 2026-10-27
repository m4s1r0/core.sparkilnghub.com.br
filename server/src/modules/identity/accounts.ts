import { sql, type Kysely } from "kysely";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { normalizeEmail } from "./email.js";
import { PASSWORD_PARAMS_VERSION } from "./password.js";

export type AccountStatus = "ativa" | "inativa" | "bloqueada";

export interface Account {
  id: string;
  emailNormalized: string;
  emailDisplay: string;
  displayName: string;
  status: AccountStatus;
  authRevision: number;
}

interface Row {
  id: Buffer;
  email_normalized: string;
  email_display: string;
  display_name: string;
  status: AccountStatus;
  auth_revision: number;
}

const toAccount = (row: Row): Account => ({
  id: binToUuid(row.id),
  emailNormalized: row.email_normalized,
  emailDisplay: row.email_display,
  displayName: row.display_name,
  status: row.status,
  authRevision: row.auth_revision,
});

const COLUMNS = sql`id, email_normalized, email_display, display_name, status, auth_revision`;

/** Conta pelo e-mail normalizado (COM-007). `forUpdate` trava a linha na transação. */
export async function findAccountByEmail(
  db: Kysely<unknown>,
  email: string,
  options: { forUpdate?: boolean } = {},
): Promise<Account | null> {
  const lock = options.forUpdate ? sql`FOR UPDATE` : sql``;
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM account
     WHERE email_normalized = ${normalizeEmail(email)} ${lock}`.execute(db);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function getAccount(
  db: Kysely<unknown>,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<Account | null> {
  const lock = options.forUpdate ? sql`FOR UPDATE` : sql``;
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM account
     WHERE id = ${uuidToBin(id)} ${lock}`.execute(db);
  return rows[0] ? toAccount(rows[0]) : null;
}

/** Cria conta ativa com a credencial de senha (hash Argon2id já calculado). */
export async function insertAccount(
  db: Kysely<unknown>,
  now: Date,
  data: { email: string; displayName: string; passwordHash: string },
): Promise<Account> {
  const id = newId();
  const emailNormalized = normalizeEmail(data.email);
  const displayName = data.displayName.trim();
  await sql`INSERT INTO account (id, email_normalized, email_display, display_name, status,
              auth_revision, created_at, updated_at)
            VALUES (${uuidToBin(id)}, ${emailNormalized}, ${data.email.trim()}, ${displayName},
                    'ativa', 1, ${now}, ${now})`.execute(db);
  await sql`INSERT INTO password_credential (account_id, hash, params_version, changed_at)
            VALUES (${uuidToBin(id)}, ${data.passwordHash}, ${PASSWORD_PARAMS_VERSION}, ${now})`.execute(
    db,
  );
  return {
    id,
    emailNormalized,
    emailDisplay: data.email.trim(),
    displayName,
    status: "ativa",
    authRevision: 1,
  };
}

export async function passwordHashOf(
  db: Kysely<unknown>,
  accountId: string,
): Promise<{ hash: string; paramsVersion: number } | null> {
  const { rows } = await sql<{ hash: string; params_version: number }>`
    SELECT hash, params_version FROM password_credential
     WHERE account_id = ${uuidToBin(accountId)}`.execute(db);
  const row = rows[0];
  return row ? { hash: row.hash, paramsVersion: row.params_version } : null;
}

export async function updatePasswordHash(
  db: Kysely<unknown>,
  now: Date,
  accountId: string,
  hash: string,
): Promise<void> {
  await sql`UPDATE password_credential
               SET hash = ${hash}, params_version = ${PASSWORD_PARAMS_VERSION}, changed_at = ${now}
             WHERE account_id = ${uuidToBin(accountId)}`.execute(db);
}

/** Nova revisão de autenticação: sessões anteriores (Core e produtos) deixam de valer. */
export async function bumpAuthRevision(
  db: Kysely<unknown>,
  now: Date,
  accountId: string,
  status?: AccountStatus,
): Promise<number> {
  const set = status ? sql`, status = ${status}` : sql``;
  await sql`UPDATE account SET auth_revision = auth_revision + 1, updated_at = ${now} ${set}
             WHERE id = ${uuidToBin(accountId)}`.execute(db);
  const account = await getAccount(db, accountId);
  return account?.authRevision ?? 0;
}
