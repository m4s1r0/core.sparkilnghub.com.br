import { sql, type Kysely } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { uuidToBin } from "../../platform/ids.js";
import type { InstanceRef } from "../instances/instance-ref.js";
import type { AccountState, MemberState } from "./source.js";
import { validateInstanceSession, type ValidatedSession } from "./validate.js";

/** Sessão de produto: 12 h absolutas e 2 h de inatividade (COM-016, FR-013). */
export const PRODUCT_SESSION_ABSOLUTE_MS = 12 * 3600_000;
export const PRODUCT_SESSION_IDLE_SECONDS = 7200;
/** O produto avisa atividade ao Core no máximo a cada 5 min (contracts/access-projection.md). */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

/** Motivos de encerramento gravados pelo Core (o logout do produto vai para outra tabela). */
export type CoreEndReason = "senha_trocada" | "bloqueio" | "vinculo_revogado" | "suspensao";

/**
 * Escrita da projeção de acesso de UMA instância: cada chamada usa o pool exclusivo do banco
 * `<instância>_acc` com a credencial `access` — nunca troca de banco numa conexão (princípio I).
 */
const db = (ctx: AppContext, instance: InstanceRef): Kysely<unknown> =>
  ctx.access(instance.accessDatabaseName);

async function upsert(trx: Kysely<unknown>, member: MemberState, now: Date): Promise<void> {
  // Campos do vínculo só avançam com versão igual ou maior; os da conta vêm sempre da fonte.
  // A ordem das atribuições importa: `version` é a última.
  await sql`INSERT INTO access_member
      (membership_id, account_id, display_name, role, status, account_status,
       account_auth_revision, version, updated_at)
    VALUES (${uuidToBin(member.membershipId)}, ${uuidToBin(member.accountId)}, ${member.displayName},
            ${member.role}, ${member.status}, ${member.accountStatus}, ${member.accountAuthRevision},
            ${member.version}, ${now}) AS incoming
    ON DUPLICATE KEY UPDATE
      display_name = incoming.display_name,
      role = IF(incoming.version >= access_member.version, incoming.role, access_member.role),
      status = IF(incoming.version >= access_member.version, incoming.status, access_member.status),
      account_status = incoming.account_status,
      account_auth_revision = GREATEST(access_member.account_auth_revision, incoming.account_auth_revision),
      updated_at = incoming.updated_at,
      version = GREATEST(access_member.version, incoming.version)`.execute(trx);
}

export async function upsertMember(
  ctx: AppContext,
  instance: InstanceRef,
  member: MemberState,
): Promise<void> {
  await upsert(db(ctx, instance), member, ctx.clock());
}

/**
 * Cria a sessão de produto depois que o Core conferiu senha, vínculo, conta e instância
 * (garantia 1 do contrato). Atualiza a réplica do vínculo na mesma transação. Só o sha256 do
 * token é gravado; o token volta uma única vez para o produto.
 */
export async function createProductSession(
  ctx: AppContext,
  instance: InstanceRef,
  member: MemberState,
): Promise<{ token: string; expiresAt: Date }> {
  const now = ctx.clock();
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + PRODUCT_SESSION_ABSOLUTE_MS);
  await db(ctx, instance)
    .transaction()
    .execute(async (trx) => {
      await upsert(trx, member, now);
      await sql`INSERT INTO access_session
          (id_hash, account_id, membership_id, created_at, last_seen_at, expires_at,
           idle_timeout_seconds, auth_revision)
        VALUES (${sha256Hex(token)}, ${uuidToBin(member.accountId)}, ${uuidToBin(member.membershipId)},
                ${now}, ${now}, ${expiresAt}, ${PRODUCT_SESSION_IDLE_SECONDS},
                ${member.accountAuthRevision})`.execute(trx);
    });
  return { token, expiresAt };
}

/** Revoga o vínculo na réplica e encerra as sessões dele (garantia 2 do contrato). */
export async function revokeMember(
  ctx: AppContext,
  instance: InstanceRef,
  member: MemberState,
): Promise<void> {
  const now = ctx.clock();
  await db(ctx, instance)
    .transaction()
    .execute(async (trx) => {
      await upsert(trx, member, now);
      await sql`UPDATE access_session SET ended_at = ${now}, end_reason = 'vinculo_revogado'
                 WHERE membership_id = ${uuidToBin(member.membershipId)} AND ended_at IS NULL`.execute(
        trx,
      );
    });
}

/**
 * Estado global da conta (troca de senha, bloqueio, desbloqueio) em uma instância: a revisão e o
 * estado invalidam as sessões pela regra normativa; `reason` registra o encerramento.
 */
export async function updateAccountState(
  ctx: AppContext,
  instance: InstanceRef,
  account: AccountState,
  reason: CoreEndReason | null,
): Promise<void> {
  const now = ctx.clock();
  const id = uuidToBin(account.accountId);
  await db(ctx, instance)
    .transaction()
    .execute(async (trx) => {
      await sql`UPDATE access_member
                   SET account_status = ${account.status},
                       account_auth_revision = GREATEST(account_auth_revision, ${account.authRevision}),
                       updated_at = ${now}
                 WHERE account_id = ${id}`.execute(trx);
      if (reason) {
        await sql`UPDATE access_session SET ended_at = ${now}, end_reason = ${reason}
                   WHERE account_id = ${id} AND ended_at IS NULL`.execute(trx);
      }
    });
}

/** Revisão de autorização da instância (suspensão e reativação chegam em F03). */
export async function setInstanceRevision(ctx: AppContext, instance: InstanceRef): Promise<void> {
  await sql`UPDATE access_instance
               SET authorization_revision = GREATEST(authorization_revision, ${instance.authorizationRevision}),
                   updated_at = ${ctx.clock()}`.execute(db(ctx, instance));
}

/**
 * Atividade da sessão (inatividade de 2 h medida pelo Core): valida pela regra normativa e grava
 * `last_seen_at` no máximo a cada 5 min. Devolve a sessão válida ou `null`.
 */
export async function touchProductSession(
  ctx: AppContext,
  instance: InstanceRef,
  token: string,
): Promise<ValidatedSession | null> {
  const now = ctx.clock();
  const session = await validateInstanceSession(db(ctx, instance), token, now);
  if (!session) return null;
  if (now.getTime() - session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await sql`UPDATE access_session SET last_seen_at = ${now}
               WHERE id_hash = ${session.idHash} AND ended_at IS NULL`.execute(db(ctx, instance));
  }
  return session;
}

/** Validação feita pelo Core (contrato de vínculos locais), com o relógio do Core. */
export function validateForInstance(
  ctx: AppContext,
  instance: InstanceRef,
  token: string,
): Promise<ValidatedSession | null> {
  return validateInstanceSession(db(ctx, instance), token, ctx.clock());
}

/** Linhas de vínculo presentes na réplica (reconciliação). */
export async function replicaMembers(
  ctx: AppContext,
  instance: InstanceRef,
): Promise<
  {
    membership_id: Buffer;
    account_id: Buffer;
    display_name: string;
    role: string;
    status: string;
    account_status: string;
    account_auth_revision: number;
    version: number;
  }[]
> {
  const { rows } = await sql<{
    membership_id: Buffer;
    account_id: Buffer;
    display_name: string;
    role: string;
    status: string;
    account_status: string;
    account_auth_revision: number;
    version: number;
  }>`SELECT membership_id, account_id, display_name, role, status, account_status,
            account_auth_revision, version FROM access_member`.execute(db(ctx, instance));
  return rows;
}

/** Vínculos que existem na réplica sem existir na fonte: revogados e sessões encerradas. */
export async function revokeOrphanMember(
  ctx: AppContext,
  instance: InstanceRef,
  membershipId: Buffer,
): Promise<void> {
  const now = ctx.clock();
  await db(ctx, instance)
    .transaction()
    .execute(async (trx) => {
      await sql`UPDATE access_member SET status = 'revogado', updated_at = ${now}
                 WHERE membership_id = ${membershipId}`.execute(trx);
      await sql`UPDATE access_session SET ended_at = ${now}, end_reason = 'vinculo_revogado'
                 WHERE membership_id = ${membershipId} AND ended_at IS NULL`.execute(trx);
    });
}
