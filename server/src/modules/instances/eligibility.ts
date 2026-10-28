import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { resolveProvisioner } from "../catalog/provisioners.js";
import type { Instance } from "./instances.js";

export type EligibilityReason = "CONTRACTOR_INACTIVE" | "SCHEMA_INCOMPATIBLE" | "NO_ADMIN_PATH";

export type EligibilityResult = { eligible: true } | { eligible: false; reason: EligibilityReason };

/** Ao menos um vínculo de administrador ativo na instância (F01, reaproveitado de F02). */
export async function hasActiveAdmin(ctx: AppContext, instanceId: string): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM membership
     WHERE instance_id = ${uuidToBin(instanceId)} AND role = 'administrador'
       AND status = 'ativo'`.execute(ctx.identity);
  return Number(rows[0]?.n ?? 0) > 0;
}

/** Convite inicial ainda pendente (não aceito, não revogado) e dentro da validade (SC-024). */
async function hasPendingInitialInvitation(ctx: AppContext, instanceId: string): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM invitation
     WHERE target = 'instancia' AND instance_id = ${uuidToBin(instanceId)} AND is_initial = TRUE
       AND status = 'pendente' AND expires_at > ${ctx.clock()}`.execute(ctx.identity);
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Pré-condições comuns a ativar e reativar (`SC-029`): contratante elegível, schema compatível
 * com a versão vigente do artefato implantado e caminho válido para o primeiro administrador —
 * vínculo ativo ou convite inicial ainda pendente dentro da validade (exceção `SC-024`).
 */
export async function checkInstanceEligibility(
  ctx: AppContext,
  instance: Instance,
): Promise<EligibilityResult> {
  const { rows } = await sql<{ status: string }>`SELECT status FROM contractor
     WHERE id = ${uuidToBin(instance.contractorId)}`.execute(ctx.core);
  if (rows[0]?.status !== "ativo") return { eligible: false, reason: "CONTRACTOR_INACTIVE" };

  const resolved = await resolveProvisioner(instance.productCode, ctx.config.SPARK_ENV);
  if (!resolved.ok || instance.schemaVersion !== resolved.version) {
    return { eligible: false, reason: "SCHEMA_INCOMPATIBLE" };
  }

  if (await hasActiveAdmin(ctx, instance.id)) return { eligible: true };
  if (await hasPendingInitialInvitation(ctx, instance.id)) return { eligible: true };
  return { eligible: false, reason: "NO_ADMIN_PATH" };
}
