import { createConnection } from "mysql2/promise";
import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { checkHistory, readHistory } from "../../platform/migrations/migrator.js";
import { resolveProvisioner } from "../catalog/provisioners.js";
import { getResource, resourceSecret } from "../provisioning/resources.js";
import type { Instance } from "./instances.js";

export type HealthCheckOrigin = "painel" | "saida_manutencao";

export interface HealthCheckResult {
  checkedAt: Date;
  healthy: boolean;
  schemaVersion: number | null;
  reason: string | null;
}

/**
 * Checagem determinística de saúde (research.md R-04): reaproveita a mesma verificação de
 * marcador e versão de schema da etapa `verify` de F02, sem a parte de banco de acesso. Abre uma
 * conexão curta com a credencial operacional já armazenada; nunca usa a credencial do
 * provisionador nem DDL. Grava sempre uma linha em `instance_health_check` (só inclusão),
 * inclusive em caso de falha, com motivo sanitizado (`SC-045`).
 */
export async function checkInstanceHealth(
  ctx: AppContext,
  instance: Instance,
  origin: HealthCheckOrigin,
): Promise<HealthCheckResult> {
  const checkedAt = ctx.clock();
  const result = await probe(ctx, instance);
  await sql`INSERT INTO instance_health_check
      (id, instance_id, checked_at, healthy, schema_version, reason, origin)
    VALUES (UNHEX(REPLACE(UUID(), '-', '')), ${uuidToBin(instance.id)}, ${checkedAt},
            ${result.healthy}, ${result.schemaVersion}, ${result.reason}, ${origin})`.execute(
    ctx.core,
  );
  return { ...result, checkedAt };
}

async function probe(
  ctx: AppContext,
  instance: Instance,
): Promise<Omit<HealthCheckResult, "checkedAt">> {
  const resolved = await resolveProvisioner(instance.productCode, ctx.config.SPARK_ENV);
  if (!resolved.ok) {
    return { healthy: false, schemaVersion: null, reason: "artefato do produto indisponível" };
  }
  const resource = await getResource(ctx.core, instance.id, "usuario_mysql");
  if (!resource || resource.status !== "verificado") {
    return { healthy: false, schemaVersion: null, reason: "sem credencial operacional verificada" };
  }
  let password: string;
  try {
    password = resourceSecret(ctx, instance.id, resource);
  } catch {
    return { healthy: false, schemaVersion: null, reason: "credencial operacional inválida" };
  }
  let connection;
  try {
    connection = await createConnection({
      host: ctx.config.MYSQL_HOST,
      port: ctx.config.MYSQL_PORT,
      user: resource.identifier,
      password,
      database: instance.databaseName,
      timezone: "Z",
      connectTimeout: 5_000,
    });
  } catch {
    return { healthy: false, schemaVersion: null, reason: "conexão recusada" };
  }
  try {
    const [rows] = await connection.query("SELECT instance_uuid AS id FROM _spark_instance");
    const ids = (rows as { id: Buffer }[]).map((r) => r.id);
    if (ids.length !== 1 || !ids[0]?.equals(uuidToBin(instance.id))) {
      return { healthy: false, schemaVersion: null, reason: "marcador ausente ou divergente" };
    }
    const history = checkHistory(await readHistory(connection), resolved.manifest);
    const schemaVersion = history.appliedVersion;
    if (history.problem || schemaVersion !== resolved.manifest.migrations.length) {
      return { healthy: false, schemaVersion, reason: "versão de schema divergente" };
    }
    return { healthy: true, schemaVersion, reason: null };
  } catch {
    return {
      healthy: false,
      schemaVersion: null,
      reason: "falha ao consultar o histórico do produto",
    };
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export interface HealthCheckRow {
  checkedAt: Date;
  healthy: boolean;
  schemaVersion: number | null;
  reason: string | null;
}

/** Última checagem registrada (painel ou saída de manutenção), ou `null` se nunca checada. */
export async function latestHealthCheck(
  ctx: AppContext,
  instanceId: string,
): Promise<HealthCheckRow | null> {
  const { rows } = await sql<{
    checked_at: Date;
    healthy: number;
    schema_version: number | null;
    reason: string | null;
  }>`SELECT checked_at, healthy, schema_version, reason FROM instance_health_check
      WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY checked_at DESC LIMIT 1`.execute(
    ctx.core,
  );
  const row = rows[0];
  return row
    ? {
        checkedAt: row.checked_at,
        healthy: row.healthy === 1,
        schemaVersion: row.schema_version,
        reason: row.reason,
      }
    : null;
}
