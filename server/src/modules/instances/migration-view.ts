import type { Connection } from "mysql2/promise";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { sha256Hex } from "../../platform/crypto/index.js";
import type { LoadedManifest } from "../../platform/migrations/manifest.js";
import {
  checkHistory,
  HISTORY_TABLE,
  type HistoryRow,
} from "../../platform/migrations/migrator.js";
import { type ProvisionerRegistry, resolveProvisioner } from "../catalog/provisioners.js";
import { createMigrationTask, latestMigrationTask, TASK_ACTIVE } from "../provisioning/tasks.js";
import type { MigrationStep, Task } from "../provisioning/tasks.js";
import { getInstance, type Instance } from "./instances.js";
import { withOperationalConnection } from "./operational-connection.js";

/**
 * Situação de uma migração do artefato no banco do produto, lida de `_spark_schema_history`:
 * o migrador grava a linha como `falha` antes de executar e só a marca `aplicada` no sucesso; em
 * erro registra `finished_at`. Linha `falha` sem `finished_at` é a versão rodando agora (tarefa
 * ativa) ou uma execução interrompida por queda do trabalhador.
 */
export type MigrationItemStatus =
  "pendente" | "em_execucao" | "aplicada" | "falhou" | "interrompida";

/** Uma migração do artefato do produto, com a situação no banco quando o histórico é legível. */
export interface ArtifactMigrationView {
  version: number;
  name: string;
  /** `null` quando o histórico do banco do produto não pôde ser lido. */
  status: MigrationItemStatus | null;
}

export interface MigrationTaskView {
  id: string;
  protocol: string;
  status: Task["status"];
  fromVersion: number | null;
  toVersion: number;
  /**
   * Migrações que a tarefa aplica (de `fromVersion + 1` até `toVersion`), com o andamento de cada
   * uma. Vazia quando a versão de origem não foi registrada (tarefas anteriores à coluna) ou o
   * artefato não pôde ser lido.
   */
  migrations: ArtifactMigrationView[];
  currentStep: MigrationStep | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string; step: MigrationStep } | null;
}

/**
 * O que "Aplicar atualização" faria agora. A versão efetiva vem do histórico do banco do produto
 * (a fonte de verdade); a do Core (`recordedVersion`) só avança quando a tarefa inteira conclui,
 * então diverge depois de uma falha parcial.
 */
export interface MigrationPlanView {
  /** Última versão aplicada em sequência no banco do produto (ou a registrada no Core, sem histórico). */
  currentVersion: number | null;
  /** Versão de schema registrada no Core para a instância. */
  recordedVersion: number | null;
  targetVersion: number;
  /** Origem de `currentVersion`. */
  source: "historico" | "registro";
  /** Motivo sanitizado quando o histórico não pôde ser lido (e `source` é `registro`). */
  historyUnavailable: string | null;
  /** Migrações acima de `currentVersion`, com a situação de cada uma. */
  pending: ArtifactMigrationView[];
  /** Histórico que impede aplicar (versão em falha, checksum divergente…); exige ação no banco. */
  blocked: { code: string; message: string } | null;
}

interface ProductHistoryRow extends HistoryRow {
  finished_at: Date | null;
}

type ProductHistory = { ok: true; rows: ProductHistoryRow[] } | { ok: false; reason: string };

async function queryHistory(connection: Connection): Promise<ProductHistoryRow[]> {
  try {
    const [rows] = await connection.query(
      `SELECT version, name, checksum, artifact, status, finished_at
         FROM ${HISTORY_TABLE} ORDER BY version`,
    );
    return rows as ProductHistoryRow[];
  } catch (error) {
    if ((error as { code?: string }).code === "ER_NO_SUCH_TABLE") return [];
    throw error;
  }
}

/** Histórico de schema do banco do produto, com a credencial operacional (só leitura). */
async function readProductHistory(ctx: AppContext, instance: Instance): Promise<ProductHistory> {
  try {
    const access = await withOperationalConnection(ctx, instance, queryHistory);
    return access.ok ? { ok: true, rows: access.value } : access;
  } catch {
    return { ok: false, reason: "falha ao consultar o histórico do produto" };
  }
}

function itemStatus(row: ProductHistoryRow | undefined, taskActive: boolean): MigrationItemStatus {
  if (!row) return "pendente";
  if (row.status === "aplicada") return "aplicada";
  if (row.finished_at) return "falhou";
  return taskActive ? "em_execucao" : "interrompida";
}

/** Migrações do manifesto no intervalo `(from, to]`, com a situação lida do histórico. */
function migrationsBetween(
  manifest: LoadedManifest,
  from: number | null,
  to: number,
  history: ProductHistory | null,
  taskActive: boolean,
): ArtifactMigrationView[] {
  const byVersion = new Map(history?.ok ? history.rows.map((r) => [r.version, r]) : []);
  return manifest.migrations
    .filter((m) => m.version > (from ?? 0) && m.version <= to)
    .map((m) => ({
      version: m.version,
      name: m.name,
      status: history?.ok ? itemStatus(byVersion.get(m.version), taskActive) : null,
    }));
}

const isActive = (task: Task | null) => task !== null && TASK_ACTIVE.has(task.status);

function toView(
  task: Task,
  manifest: LoadedManifest | null,
  history: ProductHistory | null,
): MigrationTaskView {
  return {
    id: task.id,
    protocol: task.protocol,
    status: task.status,
    fromVersion: task.fromVersion,
    toVersion: task.artifactVersion,
    migrations:
      manifest && task.fromVersion !== null
        ? migrationsBetween(
            manifest,
            task.fromVersion,
            task.artifactVersion,
            history,
            isActive(task),
          )
        : [],
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
  };
}

async function requireInstance(ctx: AppContext, instanceId: string): Promise<Instance> {
  const instance = await getInstance(ctx, instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  return instance;
}

async function requireManifest(
  ctx: AppContext,
  instance: Instance,
  registry?: ProvisionerRegistry,
) {
  const resolved = await resolveProvisioner(instance.productCode, ctx.config.SPARK_ENV, registry);
  if (!resolved.ok) {
    throw new AppError(409, "PROVISIONING_ARTIFACT_INVALID", "O artefato do produto é inválido.");
  }
  return resolved;
}

/** Plano de migração a partir do histórico real do banco do produto. */
function planOf(
  instance: Instance,
  manifest: LoadedManifest,
  history: ProductHistory,
  taskActive: boolean,
): MigrationPlanView {
  const targetVersion = manifest.migrations.length;
  if (!history.ok) {
    return {
      currentVersion: instance.schemaVersion,
      recordedVersion: instance.schemaVersion,
      targetVersion,
      source: "registro",
      historyUnavailable: history.reason,
      pending: migrationsBetween(manifest, instance.schemaVersion, targetVersion, null, taskActive),
      blocked: null,
    };
  }
  const check = checkHistory(history.rows, manifest);
  // Uma versão em execução agora aparece como `falha` sem término: não é bloqueio.
  const running =
    taskActive &&
    check.problem === "SCHEMA_FAILED" &&
    history.rows.some((r) => r.status === "falha" && !r.finished_at);
  return {
    currentVersion: check.appliedVersion,
    recordedVersion: instance.schemaVersion,
    targetVersion,
    source: "historico",
    historyUnavailable: null,
    pending: migrationsBetween(manifest, check.appliedVersion, targetVersion, history, taskActive),
    blocked:
      check.problem && !running
        ? { code: check.problem, message: check.message ?? check.problem }
        : null,
  };
}

/** Última tarefa de migração da instância, ou `null` se nunca executada (F03). */
export async function instanceMigrationView(
  ctx: AppContext,
  instanceId: string,
  registry?: ProvisionerRegistry,
): Promise<MigrationTaskView | null> {
  const task = await latestMigrationTask(ctx.core, instanceId);
  if (!task) return null;
  const instance = await getInstance(ctx, instanceId);
  const resolved = await resolveProvisioner(task.artifactCode, ctx.config.SPARK_ENV, registry);
  const manifest = resolved.ok ? resolved.manifest : null;
  const history =
    manifest && instance && task.fromVersion !== null
      ? await readProductHistory(ctx, instance)
      : null;
  return toView(task, manifest, history);
}

/**
 * O que "Aplicar atualização" faria agora: migrações do artefato vigente acima da última versão
 * aplicada no banco do produto. Lista vazia quando a instância já está na versão do artefato.
 */
export async function instanceMigrationPlan(
  ctx: AppContext,
  instanceId: string,
  registry?: ProvisionerRegistry,
): Promise<MigrationPlanView> {
  const instance = await requireInstance(ctx, instanceId);
  const resolved = await requireManifest(ctx, instance, registry);
  const [history, task] = await Promise.all([
    readProductHistory(ctx, instance),
    latestMigrationTask(ctx.core, instanceId),
  ]);
  return planOf(instance, resolved.manifest, history, isActive(task));
}

/**
 * Cria e agenda a tarefa de migração (F03, FR-020): só em `MANUTENCAO`, com backup prévio
 * registrado desde a entrada em manutenção; a instância já na versão vigente é `ALREADY_UP_TO_DATE`.
 * A versão de origem é a efetiva no banco do produto (histórico), não só a registrada no Core;
 * histórico em falha ou divergente recusa com `SCHEMA_HISTORY_BLOCKED` — repetir não resolveria.
 */
export async function applyInstanceMigration(
  ctx: AppContext,
  instanceId: string,
  requestedBy: string,
  idempotencyKey: string,
  registry?: ProvisionerRegistry,
): Promise<MigrationTaskView> {
  const instance = await requireInstance(ctx, instanceId);
  const resolved = await requireManifest(ctx, instance, registry);
  const [history, latest] = await Promise.all([
    readProductHistory(ctx, instance),
    latestMigrationTask(ctx.core, instanceId),
  ]);
  const plan = planOf(instance, resolved.manifest, history, isActive(latest));
  if (plan.blocked) {
    throw new AppError(
      409,
      "SCHEMA_HISTORY_BLOCKED",
      `O histórico de schema do produto impede a migração: ${plan.blocked.message}.`,
    );
  }
  const { task } = await createMigrationTask(ctx, {
    instanceId,
    productCode: instance.productCode,
    currentSchemaVersion: plan.currentVersion,
    artifactVersion: resolved.version,
    manifestSha256: resolved.manifestSha256,
    requestedBy,
    idempotencyKey,
    requestHash: sha256Hex(JSON.stringify({ instanceId, artifactVersion: resolved.version })),
  });
  return toView(task, resolved.manifest, history);
}
