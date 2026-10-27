import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import { getInstances } from "../instances/instance-ref.js";
import { type Account, findAccountByEmail, getAccount } from "./accounts.js";
import { identityErrors } from "./errors.js";
import { hasConfirmedFactor } from "./mfa.js";

const summary = (account: Account) => ({
  accountId: account.id,
  displayName: account.displayName,
  email: account.emailDisplay,
  status: account.status,
});

/** Busca exata pelo e-mail normalizado: não existe listagem aberta de contas. */
export async function findAccounts(ctx: AppContext, email: string) {
  const account = await findAccountByEmail(ctx.identity, email);
  return { items: account ? [summary(account)] : [] };
}

/** Detalhe da conta para o painel: vínculos, MFA, papel de plataforma, pedidos pendentes. */
export async function getAccountDetail(ctx: AppContext, accountId: string) {
  const account = await getAccount(ctx.identity, accountId);
  if (!account) throw identityErrors.notFound();
  const { rows: memberships } = await sql<{
    id: Buffer;
    instance_id: Buffer;
    role: "administrador" | "colaborador";
    status: "ativo" | "revogado";
  }>`SELECT id, instance_id, role, status FROM membership
      WHERE account_id = ${uuidToBin(accountId)} ORDER BY status, created_at`.execute(ctx.identity);
  const instances = new Map(
    (await getInstances(ctx, [...new Set(memberships.map((m) => binToUuid(m.instance_id)))])).map(
      (i) => [i.id, i.displayName],
    ),
  );
  const { rows: role } = await sql<{ status: "ativo" | "inativo" }>`
    SELECT status FROM platform_role WHERE account_id = ${uuidToBin(accountId)}`.execute(
    ctx.identity,
  );
  const { rows: pending } = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM recovery_request
     WHERE email_normalized = ${account.emailNormalized} AND handled_at IS NULL`.execute(
    ctx.identity,
  );
  return {
    account: summary(account),
    mfaEnrolled: await hasConfirmedFactor(ctx.identity, accountId),
    platformRole: role[0]?.status ?? null,
    memberships: memberships.map((m) => ({
      membershipId: binToUuid(m.id),
      instanceId: binToUuid(m.instance_id),
      instanceName: instances.get(binToUuid(m.instance_id)) ?? "—",
      role: m.role,
      status: m.status,
    })),
    pendingRecoveryRequests: Number(pending[0]?.n ?? 0),
  };
}

/** Revogações e réplicas pendentes por instância (FR-027), para o painel. */
export async function listPendingAccessSync(ctx: AppContext) {
  const { rows } = await sql<{
    id: Buffer;
    instance_id: Buffer;
    kind: string;
    status: string;
    attempts: number;
    next_attempt_at: Date;
    last_error: string | null;
    created_at: Date;
  }>`SELECT id, instance_id, kind, status, attempts, next_attempt_at, last_error, created_at
       FROM access_sync_job WHERE status IN ('pendente', 'em_execucao', 'falhou')
      ORDER BY created_at`.execute(ctx.core);
  const names = new Map(
    (await getInstances(ctx, [...new Set(rows.map((r) => binToUuid(r.instance_id)))])).map((i) => [
      i.id,
      i.displayName,
    ]),
  );
  return {
    items: rows.map((row) => ({
      jobId: binToUuid(row.id),
      instanceId: binToUuid(row.instance_id),
      instanceName: names.get(binToUuid(row.instance_id)) ?? "—",
      kind: row.kind,
      status: row.status,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at.toISOString(),
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
    })),
  };
}
