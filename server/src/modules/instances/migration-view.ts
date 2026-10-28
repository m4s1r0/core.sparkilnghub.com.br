import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { type ProvisionerRegistry, resolveProvisioner } from "../catalog/provisioners.js";
import { createMigrationTask, latestMigrationTask } from "../provisioning/tasks.js";
import type { MigrationStep, Task } from "../provisioning/tasks.js";
import { sha256Hex } from "../../platform/crypto/index.js";
import { getInstance } from "./instances.js";

export interface MigrationTaskView {
  id: string;
  protocol: string;
  status: Task["status"];
  fromVersion: number | null;
  toVersion: number;
  currentStep: MigrationStep | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string; step: MigrationStep } | null;
}

const toView = (task: Task): MigrationTaskView => ({
  id: task.id,
  protocol: task.protocol,
  status: task.status,
  // Não rastreado por instância (nenhuma coluna guarda a versão de origem); aceito nesta fatia.
  fromVersion: null,
  toVersion: task.artifactVersion,
  currentStep: task.currentStep as MigrationStep | null,
  attempt: task.attempt,
  createdAt: task.createdAt.toISOString(),
  startedAt: task.startedAt ? task.startedAt.toISOString() : null,
  finishedAt: task.finishedAt ? task.finishedAt.toISOString() : null,
  error:
    task.errorCode && task.errorMessage
      ? {
          code: task.errorCode,
          message: task.errorMessage,
          step: (task.currentStep as MigrationStep) ?? "confirmar_manutencao",
        }
      : null,
});

/** Última tarefa de migração da instância, ou `null` se nunca executada (F03). */
export async function instanceMigrationView(
  ctx: AppContext,
  instanceId: string,
): Promise<MigrationTaskView | null> {
  const task = await latestMigrationTask(ctx.core, instanceId);
  return task ? toView(task) : null;
}

/**
 * Cria e agenda a tarefa de migração (F03, FR-020): só em `MANUTENCAO`, com backup prévio
 * registrado desde a entrada em manutenção; a instância já na versão vigente é `ALREADY_UP_TO_DATE`.
 */
export async function applyInstanceMigration(
  ctx: AppContext,
  instanceId: string,
  requestedBy: string,
  idempotencyKey: string,
  registry?: ProvisionerRegistry,
): Promise<MigrationTaskView> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  const resolved = await resolveProvisioner(instance.productCode, ctx.config.SPARK_ENV, registry);
  if (!resolved.ok) {
    throw new AppError(409, "PROVISIONING_ARTIFACT_INVALID", "O artefato do produto é inválido.");
  }
  const { task } = await createMigrationTask(ctx, {
    instanceId,
    productCode: instance.productCode,
    currentSchemaVersion: instance.schemaVersion,
    artifactVersion: resolved.version,
    manifestSha256: resolved.manifestSha256,
    requestedBy,
    idempotencyKey,
    requestHash: sha256Hex(JSON.stringify({ instanceId, artifactVersion: resolved.version })),
  });
  return toView(task);
}
