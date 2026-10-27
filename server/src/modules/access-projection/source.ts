import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";

export type ProductRole = "administrador" | "colaborador";
export type AccountStatus = "ativa" | "inativa" | "bloqueada";

/** Estado de um vínculo como a projeção o replica (sem e-mail, FR-026). */
export interface MemberState {
  membershipId: string;
  accountId: string;
  instanceId: string;
  displayName: string;
  role: ProductRole;
  status: "ativo" | "revogado";
  accountStatus: AccountStatus;
  accountAuthRevision: number;
  version: number;
}

export interface AccountState {
  accountId: string;
  status: AccountStatus;
  authRevision: number;
}

interface MemberRow {
  id: Buffer;
  account_id: Buffer;
  instance_id: Buffer;
  display_name: string;
  role: ProductRole;
  status: "ativo" | "revogado";
  account_status: AccountStatus;
  auth_revision: number;
  version: number;
}

const toMember = (row: MemberRow): MemberState => ({
  membershipId: binToUuid(row.id),
  accountId: binToUuid(row.account_id),
  instanceId: binToUuid(row.instance_id),
  displayName: row.display_name,
  role: row.role,
  status: row.status,
  accountStatus: row.account_status,
  accountAuthRevision: row.auth_revision,
  version: row.version,
});

const MEMBER_SELECT = sql`SELECT m.id, m.account_id, m.instance_id, a.display_name, m.role, m.status,
         a.status AS account_status, a.auth_revision, m.version
    FROM membership m JOIN account a ON a.id = m.account_id`;

/** Estado atual do vínculo na fonte (`spark_identity`). */
export async function readMemberState(
  ctx: AppContext,
  membershipId: string,
): Promise<MemberState | null> {
  const { rows } =
    await sql<MemberRow>`${MEMBER_SELECT} WHERE m.id = ${uuidToBin(membershipId)}`.execute(
      ctx.identity,
    );
  return rows[0] ? toMember(rows[0]) : null;
}

/** Todos os vínculos (ativos e revogados) de uma instância, para reconciliação. */
export async function instanceMemberStates(
  ctx: AppContext,
  instanceId: string,
): Promise<MemberState[]> {
  const { rows } = await sql<MemberRow>`${MEMBER_SELECT}
     WHERE m.instance_id = ${uuidToBin(instanceId)}`.execute(ctx.identity);
  return rows.map(toMember);
}

export async function readAccountState(
  ctx: AppContext,
  accountId: string,
): Promise<AccountState | null> {
  const { rows } = await sql<{ status: AccountStatus; auth_revision: number }>`
    SELECT status, auth_revision FROM account WHERE id = ${uuidToBin(accountId)}`.execute(
    ctx.identity,
  );
  const row = rows[0];
  return row ? { accountId, status: row.status, authRevision: row.auth_revision } : null;
}

/** Instâncias onde a conta tem ou teve vínculo: todas têm linha da conta na réplica. */
export async function accountInstanceIds(ctx: AppContext, accountId: string): Promise<string[]> {
  const { rows } = await sql<{ instance_id: Buffer }>`
    SELECT DISTINCT instance_id FROM membership WHERE account_id = ${uuidToBin(accountId)}`.execute(
    ctx.identity,
  );
  return rows.map((r) => binToUuid(r.instance_id));
}
