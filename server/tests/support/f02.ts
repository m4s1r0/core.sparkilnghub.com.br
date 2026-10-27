import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import type { ProvisionerRegistry } from "../../src/modules/catalog/provisioners.js";
import { normalizeSql, sha256 } from "../../src/platform/migrations/manifest.js";
import { referenceProductDir } from "../../src/platform/paths.js";
import { getInstance } from "../../src/modules/instances/instances.js";
import { type InstanceRequestBody, requestInstance } from "../../src/modules/instances/request.js";
import {
  type ExecutorOptions,
  type RunOutcome,
  runNextTask,
} from "../../src/modules/provisioning/executor.js";
import { instanceUserName, newId, uuidToBin } from "../../src/platform/ids.js";
import { accessDatabaseName } from "../../src/platform/migrations/apply-artifact.js";
import { type F01TestEnv, TEST_CONTRACTOR_ID } from "./f01.js";

let sequence = 0;

/** Corpo de solicitação válido para o produto de referência, com slug único no teste. */
export function requestBody(patch: Partial<InstanceRequestBody> = {}): InstanceRequestBody {
  sequence += 1;
  return {
    contractorId: TEST_CONTRACTOR_ID,
    productCode: "sparkref",
    displayName: `[SINTÉTICO] Loja ${sequence}`,
    slug: `loja-${Date.now().toString(36)}-${sequence}`,
    initialAdminEmail: `dona-${sequence}@example.test`,
    ...patch,
  };
}

/** Conta que solicita (o ator da tarefa). */
export async function requester(env: F01TestEnv): Promise<string> {
  return (await env.insertAccount()).id;
}

/** Solicitação pelo serviço (sem HTTP), já rastreando bancos e usuário para a limpeza. */
export async function requestViaService(
  env: F01TestEnv,
  accountId: string,
  patch: Partial<InstanceRequestBody> = {},
  key: string = crypto.randomUUID(),
  registry?: ProvisionerRegistry,
) {
  const created = await requestInstance(
    env.ctx,
    requestBody(patch),
    { accountId, correlationId: crypto.randomUUID() },
    key,
    registry ? { registry } : {},
  );
  await trackInstance(env, created.instance.id);
  return {
    instanceId: created.instance.id,
    taskId: created.task.id,
    protocol: created.task.protocol,
  };
}

/** Bancos `sparkref_*`/`_acc` e usuário `inst_*` removidos só no teardown do teste. */
export async function trackInstance(env: F01TestEnv, instanceId: string): Promise<void> {
  const instance = await getInstance(env.ctx, instanceId);
  if (!instance) return;
  env.mysql.trackInstanceDatabase(instance.databaseName);
  env.mysql.trackInstanceDatabase(accessDatabaseName(instance.databaseName));
  env.mysql.trackUser(instanceUserName(instance.id));
}

export function executorOptions(
  env: F01TestEnv,
  extra: Partial<ExecutorOptions> = {},
): ExecutorOptions {
  return { ctx: env.ctx, config: env.mysql.config, workerId: newId(), ...extra };
}

/** Executa a tarefa indicada (ou a próxima vencida) até o fim desta execução. */
export function runProvisioning(
  env: F01TestEnv,
  taskId?: string,
  extra: Partial<ExecutorOptions> = {},
): Promise<RunOutcome | null> {
  return runNextTask(executorOptions(env, extra), taskId);
}

export interface StepRunRow {
  step: string;
  run_number: number;
  attempt: number;
  status: string;
  error_code: string | null;
}

export async function stepRuns(env: F01TestEnv, taskId: string): Promise<StepRunRow[]> {
  const { rows } = await sql<StepRunRow>`SELECT step, run_number, attempt, status, error_code
      FROM admin_task_step_run WHERE task_id = ${uuidToBin(taskId)}
     ORDER BY started_at, run_number, id`.execute(env.ctx.core);
  return rows;
}

export async function taskRow(env: F01TestEnv, taskId: string) {
  const { rows } = await sql<{
    status: string;
    attempt: number;
    run_number: number;
    error_code: string | null;
    error_message: string | null;
    lease_until: Date | null;
  }>`SELECT status, attempt, run_number, error_code, error_message, lease_until FROM admin_task
      WHERE id = ${uuidToBin(taskId)}`.execute(env.ctx.core);
  const row = rows[0];
  if (!row) throw new Error("tarefa não encontrada");
  return row;
}

/**
 * Cópia do artefato do produto de referência com versões trocadas ou acrescentadas (manifesto
 * coerente), registrada como provisionador de teste do `sparkref`.
 */
export function artifactVariant(files: Record<string, string>): ProvisionerRegistry {
  const dir = mkdtempSync(join(tmpdir(), "artefato-teste-"));
  cpSync(referenceProductDir, dir, { recursive: true });
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    migrations: { version: number; name: string; file: string; sha256: string }[];
  };
  for (const [name, content] of Object.entries(files)) {
    const file = `migrations/${name}.sql`;
    writeFileSync(join(dir, file), content);
    const hash = sha256(normalizeSql(Buffer.from(content)));
    const existing = manifest.migrations.find((m) => m.name === name);
    if (existing) existing.sha256 = hash;
    else {
      manifest.migrations.push({
        version: manifest.migrations.length + 1,
        name,
        file,
        sha256: hash,
      });
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { sparkref: { id: "sparkref-teste", artifactDir: dir, environments: ["development"] } };
}
