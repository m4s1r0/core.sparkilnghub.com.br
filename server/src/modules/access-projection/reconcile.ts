import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import type { Instance } from "../instances/instances.js";
import { recordSecurityEvent } from "../identity/security-events.js";
import { instanceMemberStates, type MemberState } from "./source.js";
import { setReconcileHandler } from "./sync.js";
import { replicaMembers, setInstanceRevision } from "./writer.js";

type ReplicaRow = Awaited<ReturnType<typeof replicaMembers>>[number];

const differs = (replica: ReplicaRow | undefined, source: MemberState) =>
  !replica ||
  replica.display_name !== source.displayName ||
  replica.role !== source.role ||
  replica.status !== source.status ||
  replica.account_status !== source.accountStatus ||
  replica.account_auth_revision !== source.accountAuthRevision ||
  replica.version !== source.version ||
  binToUuid(replica.account_id) !== source.accountId;

/**
 * Recalcula a projeção de uma instância a partir de `spark_identity` (FR-033): grava cada vínculo
 * exatamente como na fonte (sem a guarda de versão da escrita normal, que manteria uma versão
 * adulterada), revoga vínculos ausentes da fonte, encerra sessões de vínculos revogados e
 * registra o número de divergências corrigidas. A restauração de backup (T-16) usará esta rotina.
 */
export async function reconcileInstance(
  ctx: AppContext,
  instance: Instance,
): Promise<{ divergences: number }> {
  const now = ctx.clock();
  const source = await instanceMemberStates(ctx, instance.id);
  const replica = new Map(
    (await replicaMembers(ctx, instance)).map((row) => [binToUuid(row.membership_id), row]),
  );
  const db = ctx.access(instance.accessDatabaseName);
  let divergences = 0;

  await db.transaction().execute(async (trx) => {
    for (const member of source) {
      let diverged = differs(replica.get(member.membershipId), member);
      if (diverged) {
        await sql`INSERT INTO access_member
            (membership_id, account_id, display_name, role, status, account_status,
             account_auth_revision, version, updated_at)
          VALUES (${uuidToBin(member.membershipId)}, ${uuidToBin(member.accountId)},
                  ${member.displayName}, ${member.role}, ${member.status}, ${member.accountStatus},
                  ${member.accountAuthRevision}, ${member.version}, ${now}) AS source
          ON DUPLICATE KEY UPDATE
            account_id = source.account_id, display_name = source.display_name,
            role = source.role, status = source.status, account_status = source.account_status,
            account_auth_revision = source.account_auth_revision, version = source.version,
            updated_at = source.updated_at`.execute(trx);
      }
      if (member.status === "revogado") {
        const result = await sql`UPDATE access_session
            SET ended_at = ${now}, end_reason = 'vinculo_revogado'
          WHERE membership_id = ${uuidToBin(member.membershipId)} AND ended_at IS NULL`.execute(
          trx,
        );
        if (!diverged && Number(result.numAffectedRows ?? 0) > 0) diverged = true;
      }
      if (diverged) divergences += 1;
      replica.delete(member.membershipId);
    }

    // Sobram vínculos que não existem na fonte: revogados, com as sessões encerradas.
    for (const row of replica.values()) {
      if (row.status === "revogado") continue;
      await sql`UPDATE access_member SET status = 'revogado', updated_at = ${now}
                 WHERE membership_id = ${row.membership_id}`.execute(trx);
      await sql`UPDATE access_session SET ended_at = ${now}, end_reason = 'vinculo_revogado'
                 WHERE membership_id = ${row.membership_id} AND ended_at IS NULL`.execute(trx);
      divergences += 1;
    }
  });
  await setInstanceRevision(ctx, instance);

  await recordSecurityEvent(ctx.identity, {
    type: "projecao_reconciliada",
    actorKind: "sistema",
    instanceId: instance.id,
    result: "sucesso",
    detail: { divergences },
    at: now,
  });
  if (divergences > 0) {
    ctx.logger.warn({ instanceId: instance.id, divergences }, "Projeção de acesso reconciliada");
  }
  return { divergences };
}

setReconcileHandler(reconcileInstance);
