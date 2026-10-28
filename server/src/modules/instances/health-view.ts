import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { latestBackup } from "./backup.js";
import { checkInstanceHealth, latestHealthCheck } from "./health.js";
import { getInstance } from "./instances.js";
import { resolveProvisioner } from "../catalog/provisioners.js";

export type Connectivity = "saudavel" | "indisponivel" | "desconhecida";

export interface InstanceHealthStatus {
  productVersion: string;
  schemaVersion: number | null;
  connectivity: Connectivity;
  lastCheck: {
    checkedAt: string;
    healthy: boolean;
    schemaVersion: number | null;
    reason: string | null;
  } | null;
  backup: {
    lastSuccessfulAt: string | null;
    lastResult: "sucesso" | "falha" | null;
    origin: string | null;
  };
}

async function mustGetInstance(ctx: AppContext, instanceId: string) {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  return instance;
}

/** Monta o painel de saúde (SC-042): versão do produto, schema, conectividade e backup. */
export async function instanceHealthStatus(
  ctx: AppContext,
  instanceId: string,
): Promise<InstanceHealthStatus> {
  const instance = await mustGetInstance(ctx, instanceId);
  const resolved = await resolveProvisioner(instance.productCode, ctx.config.SPARK_ENV);
  const [lastCheck, backup] = await Promise.all([
    latestHealthCheck(ctx, instanceId),
    latestBackup(ctx, instanceId),
  ]);
  const connectivity: Connectivity = !lastCheck
    ? "desconhecida"
    : lastCheck.healthy
      ? "saudavel"
      : "indisponivel";
  return {
    productVersion: resolved.ok ? resolved.provisioner.id : instance.productCode,
    schemaVersion: instance.schemaVersion,
    connectivity,
    lastCheck: lastCheck
      ? {
          checkedAt: lastCheck.checkedAt.toISOString(),
          healthy: lastCheck.healthy,
          schemaVersion: lastCheck.schemaVersion,
          reason: lastCheck.reason,
        }
      : null,
    backup: {
      lastSuccessfulAt: backup.lastSuccessfulAt ? backup.lastSuccessfulAt.toISOString() : null,
      lastResult: backup.lastResult,
      origin: backup.origin,
    },
  };
}

/** Dispara uma checagem imediata (painel) e devolve o resultado cru (sem reautenticação). */
export async function checkInstanceHealthNow(ctx: AppContext, instanceId: string) {
  const instance = await mustGetInstance(ctx, instanceId);
  const result = await checkInstanceHealth(ctx, instance, "painel");
  return {
    checkedAt: result.checkedAt.toISOString(),
    healthy: result.healthy,
    schemaVersion: result.schemaVersion,
    reason: result.reason,
  };
}
