import { sql, type Kysely } from "kysely";
import type { Connection } from "mysql2/promise";
import type { AppContext } from "../../platform/context.js";
import { decryptSecret, encryptSecret } from "../../platform/crypto/index.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import { ProvisioningFailure } from "./errors.js";

export type ResourceKind = "banco_operacional" | "banco_acesso" | "usuario_mysql";
export type ResourceStatus = "pretendido" | "criado" | "verificado";

export interface Resource {
  id: string;
  kind: ResourceKind;
  identifier: string;
  status: ResourceStatus;
  secretEnc: Buffer | null;
  secretKeyVersion: number | null;
}

/**
 * Recursos físicos da instância com intenção gravada ANTES de cada efeito (research.md R-06):
 * na retomada, só a intenção distingue "recurso que esta instância começou a criar" de
 * "recurso desconhecido com o mesmo nome" depois de um commit implícito do MySQL.
 */
export async function getResource(
  db: Kysely<unknown>,
  instanceId: string,
  kind: ResourceKind,
): Promise<Resource | null> {
  const { rows } = await sql<{
    id: Buffer;
    kind: ResourceKind;
    identifier: string;
    status: ResourceStatus;
    secret_enc: Buffer | null;
    secret_key_version: number | null;
  }>`SELECT id, kind, identifier, status, secret_enc, secret_key_version FROM instance_resource
      WHERE instance_id = ${uuidToBin(instanceId)} AND kind = ${kind}`.execute(db);
  const row = rows[0];
  return row
    ? {
        id: row.id.toString("hex"),
        kind: row.kind,
        identifier: row.identifier,
        status: row.status,
        secretEnc: row.secret_enc,
        secretKeyVersion: row.secret_key_version,
      }
    : null;
}

export async function recordIntent(
  ctx: AppContext,
  data: {
    instanceId: string;
    kind: ResourceKind;
    identifier: string;
    taskId: string;
    /** Só `usuario_mysql`: senha a cifrar com INSTANCE_SECRET_KEY, AAD = UUID (R-09). */
    secret?: string;
  },
): Promise<void> {
  const now = ctx.clock();
  const encrypted = data.secret
    ? encryptSecret(
        ctx.instanceKeyRing,
        Buffer.from(data.secret, "utf8"),
        uuidToBin(data.instanceId),
      )
    : null;
  await sql`INSERT INTO instance_resource (id, instance_id, kind, identifier, status, secret_enc,
              secret_key_version, owner_task_id, created_at, updated_at)
            VALUES (${uuidToBin(newId())}, ${uuidToBin(data.instanceId)}, ${data.kind},
                    ${data.identifier}, 'pretendido', ${encrypted?.data ?? null},
                    ${encrypted?.keyVersion ?? null}, ${uuidToBin(data.taskId)}, ${now},
                    ${now})`.execute(ctx.core);
}

/**
 * Desfaz uma intenção gravada nesta mesma tentativa quando o recurso já existia sem prova de
 * propriedade: nenhum efeito ocorreu, e a intenção não pode fazer uma retomada futura adotar um
 * recurso alheio.
 */
export async function discardFreshIntent(
  ctx: AppContext,
  instanceId: string,
  kind: ResourceKind,
): Promise<void> {
  await sql`DELETE FROM instance_resource
             WHERE instance_id = ${uuidToBin(instanceId)} AND kind = ${kind}
               AND status = 'pretendido'`.execute(ctx.core);
}

export async function markResource(
  ctx: AppContext,
  instanceId: string,
  kind: ResourceKind,
  status: Exclude<ResourceStatus, "pretendido">,
): Promise<void> {
  await sql`UPDATE instance_resource SET status = ${status}, updated_at = ${ctx.clock()}
             WHERE instance_id = ${uuidToBin(instanceId)} AND kind = ${kind}`.execute(ctx.core);
}

/** Senha operacional guardada (só existe na memória do trabalhador e do contrato de conexão). */
export function resourceSecret(ctx: AppContext, instanceId: string, resource: Resource): string {
  if (!resource.secretEnc || resource.secretKeyVersion === null) {
    throw new ProvisioningFailure("PROVISIONING_VERIFICATION_FAILED", "senha ausente");
  }
  return decryptSecret(
    ctx.instanceKeyRing,
    resource.secretEnc,
    resource.secretKeyVersion,
    uuidToBin(instanceId),
  ).toString("utf8");
}

export async function tableNames(admin: Connection, database: string): Promise<string[]> {
  const [rows] = await admin.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
    [database],
  );
  return (rows as { name: string }[]).map((r) => r.name);
}
