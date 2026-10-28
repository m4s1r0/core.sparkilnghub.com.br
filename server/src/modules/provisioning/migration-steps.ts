import { sql } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { appliedBy } from "../../platform/migrations/core-migrations.js";
import type { LoadedManifest } from "../../platform/migrations/manifest.js";
import { checkHistory, migrate, readHistory } from "../../platform/migrations/migrator.js";
import { hasBackupSince } from "../instances/backup.js";
import type { Instance } from "../instances/instances.js";
import { ProvisioningFailure } from "./errors.js";
import { type StepOutcome, withAdmin } from "./steps.js";
import type { MigrationStep, Task } from "./tasks.js";

export interface MigrationStepContext {
  ctx: AppContext;
  /** Configuração com a credencial `provisioner` (só no trabalhador). */
  config: Config;
  task: Task;
  instance: Instance;
  manifest: LoadedManifest;
  /** Só em testes: chamado depois de cada efeito no MySQL e antes do registro. */
  afterEffect?: (step: MigrationStep) => void | Promise<void>;
}

/** Etapa 1: a instância ainda está em manutenção — reconferida a cada retomada (research.md R-03). */
export async function confirmMaintenance(sc: MigrationStepContext): Promise<StepOutcome> {
  const { rows } = await sql<{ state: string }>`SELECT state FROM instance
     WHERE id = ${uuidToBin(sc.instance.id)}`.execute(sc.ctx.core);
  if (rows[0]?.state !== "MANUTENCAO") {
    throw new ProvisioningFailure("PROVISIONING_NOT_IN_MAINTENANCE");
  }
  return "ignorada";
}

/** Etapa 2: backup bem-sucedido desde a entrada em manutenção — reconferido a cada retomada. */
export async function confirmPriorBackup(sc: MigrationStepContext): Promise<StepOutcome> {
  const { rows } = await sql<{ created_at: Date }>`SELECT created_at FROM instance_transition
     WHERE instance_id = ${uuidToBin(sc.instance.id)} AND to_state = 'MANUTENCAO'
     ORDER BY created_at DESC LIMIT 1`.execute(sc.ctx.core);
  const since = rows[0]?.created_at ?? sc.task.createdAt;
  if (!(await hasBackupSince(sc.ctx, sc.instance.id, since))) {
    throw new ProvisioningFailure("PROVISIONING_NO_PRIOR_BACKUP");
  }
  return "ignorada";
}

/** Etapa 3: aplica o artefato no banco operacional — mesma rotina do provisionamento (F02). */
export async function applyInstanceMigrations(sc: MigrationStepContext): Promise<StepOutcome> {
  const product = await withAdmin(sc.config, sc.instance.databaseName, (connection) =>
    migrate(connection, sc.manifest, { appliedBy: appliedBy("spark_provisioner") }),
  );
  await sql`UPDATE instance SET schema_version = ${sc.manifest.migrations.length}
             WHERE id = ${uuidToBin(sc.instance.id)}`.execute(sc.ctx.core);
  if (product.applied.length > 0) await sc.afterEffect?.("aplicar_migracoes_instancia");
  return product.applied.length > 0 ? "concluida" : "ignorada";
}

/** Etapa 4: marcador e versão de schema conferidos — mesma verificação de `instances/health.ts`. */
export async function verifyAfterMigration(sc: MigrationStepContext): Promise<StepOutcome> {
  await withAdmin(sc.config, sc.instance.databaseName, async (connection) => {
    const [rows] = await connection.query("SELECT instance_uuid AS id FROM _spark_instance");
    const ids = (rows as { id: Buffer }[]).map((r) => r.id);
    if (ids.length !== 1 || !ids[0]?.equals(uuidToBin(sc.instance.id))) {
      throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", "marcador");
    }
    const history = checkHistory(await readHistory(connection), sc.manifest);
    if (history.problem || history.appliedVersion !== sc.manifest.migrations.length) {
      throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", "versão do schema");
    }
  });
  return "concluida";
}
