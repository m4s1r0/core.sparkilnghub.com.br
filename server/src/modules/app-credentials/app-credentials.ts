import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { type AppScope, INSTANCE_SCOPES } from "../../platform/http/app-credential.js";
import { isUuid } from "../../platform/ids.js";
import { findInstanceBySlug, getInstance, type Instance } from "../instances/instances.js";

export interface AppCredentialInfo {
  id: string;
  productCode: string;
  /** Instância vinculada; `null` = credencial por produto (recusada nos escopos de instância). */
  instanceId: string | null;
  instanceSlug: string | null;
  label: string;
  scopes: AppScope[];
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

/**
 * Credencial de aplicação dos contratos internos (R-09). O segredo (32 bytes) é devolvido uma
 * única vez como `<id>.<segredo>`; só o sha256 é gravado. Várias ativas por produto permitem
 * rotação sem parada.
 */
export async function createAppCredential(
  ctx: AppContext,
  data: {
    productCode: string;
    label: string;
    scopes: AppScope[];
    expiresAt?: Date | null;
    instanceId?: string | null;
  },
): Promise<{ id: string; value: string }> {
  const id = newId();
  const secret = randomToken();
  const instanceBin = data.instanceId ? uuidToBin(data.instanceId) : null;
  await sql`INSERT INTO app_credential
      (id, product_code, instance_id, label, secret_hash, scopes, created_at, expires_at)
    VALUES (${uuidToBin(id)}, ${data.productCode}, ${instanceBin}, ${data.label},
            ${sha256Hex(secret)}, ${[...new Set(data.scopes)].join(",")},
            ${ctx.clock()}, ${data.expiresAt ?? null})`.execute(ctx.core);
  return { id, value: `${id}.${secret}` };
}

/** Revogação com efeito imediato; `false` se não existe ou já estava revogada. */
export async function revokeAppCredential(ctx: AppContext, id: string): Promise<boolean> {
  const result = await sql`UPDATE app_credential SET revoked_at = ${ctx.clock()}
                            WHERE id = ${uuidToBin(id)} AND revoked_at IS NULL`.execute(ctx.core);
  return Number(result.numAffectedRows ?? 0) > 0;
}

export async function listAppCredentials(ctx: AppContext): Promise<AppCredentialInfo[]> {
  const { rows } = await sql<{
    id: Buffer;
    product_code: string;
    instance_id: Buffer | null;
    instance_slug: string | null;
    label: string;
    scopes: string;
    created_at: Date;
    expires_at: Date | null;
    revoked_at: Date | null;
    last_used_at: Date | null;
  }>`SELECT c.id, c.product_code, c.instance_id, i.slug AS instance_slug, c.label, c.scopes,
            c.created_at, c.expires_at, c.revoked_at, c.last_used_at
       FROM app_credential c LEFT JOIN instance i ON i.id = c.instance_id
      ORDER BY c.created_at`.execute(ctx.core);
  return rows.map((row) => ({
    id: binToUuid(row.id),
    productCode: row.product_code,
    instanceId: row.instance_id ? binToUuid(row.instance_id) : null,
    instanceSlug: row.instance_slug,
    label: row.label,
    scopes: row.scopes.split(",").filter(Boolean) as AppScope[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}

/** Erro de uso da CLI de credenciais (mensagem para o operador, sem segredo). */
export class AppCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppCredentialError";
  }
}

/** Precisa de instância vinculada: algum escopo age sobre uma instância (SEC-01). */
export const needsInstance = (scopes: readonly AppScope[]): boolean =>
  scopes.some((scope) => INSTANCE_SCOPES.has(scope));

/** Instância por slug ou UUID, sempre do produto informado; senão erro de uso. */
export async function resolveCredentialInstance(
  ctx: AppContext,
  productCode: string,
  ref: string,
): Promise<Instance> {
  const instance = isUuid(ref)
    ? await getInstance(ctx, ref.toLowerCase())
    : await findInstanceBySlug(ctx, productCode, ref);
  if (!instance || instance.productCode !== productCode) {
    throw new AppCredentialError(`Instância ${ref} inexistente no produto ${productCode}.`);
  }
  return instance;
}

/**
 * Emissão pela CLI (SEC-01): escopos de instância exigem `--instance`, resolvida no mesmo produto.
 * `createAppCredential` continua aceitando qualquer combinação para os testes de recusa.
 */
export async function issueAppCredential(
  ctx: AppContext,
  data: { productCode: string; label: string; scopes: AppScope[]; instanceRef?: string | null },
): Promise<{ id: string; value: string; instance: Instance | null }> {
  if (needsInstance(data.scopes) && !data.instanceRef) {
    throw new AppCredentialError(
      "Escopos connection, sessions e members exigem --instance <slug|uuid> (credencial por instância).",
    );
  }
  const instance = data.instanceRef
    ? await resolveCredentialInstance(ctx, data.productCode, data.instanceRef)
    : null;
  const created = await createAppCredential(ctx, {
    productCode: data.productCode,
    label: data.label,
    scopes: data.scopes,
    instanceId: instance?.id ?? null,
  });
  return { ...created, instance };
}

/**
 * Migração sem parada (SEC-01): vincula uma credencial por produto, ativa, à instância que a
 * implantação atende, sem trocar o segredo. Credencial já vinculada não muda de instância.
 */
export async function bindAppCredential(
  ctx: AppContext,
  id: string,
  instanceRef: string,
): Promise<Instance> {
  const { rows } = await sql<{
    product_code: string;
    instance_id: Buffer | null;
    revoked_at: Date | null;
  }>`
    SELECT product_code, instance_id, revoked_at FROM app_credential WHERE id = ${uuidToBin(id)}`.execute(
    ctx.core,
  );
  const row = rows[0];
  if (!row || row.revoked_at)
    throw new AppCredentialError(`Credencial ${id} inexistente ou revogada.`);
  const instance = await resolveCredentialInstance(ctx, row.product_code, instanceRef);
  if (row.instance_id) {
    if (binToUuid(row.instance_id) === instance.id) return instance;
    throw new AppCredentialError(
      `Credencial ${id} já está vinculada a outra instância; emita uma nova para ${instanceRef}.`,
    );
  }
  await sql`UPDATE app_credential SET instance_id = ${uuidToBin(instance.id)}
             WHERE id = ${uuidToBin(id)} AND instance_id IS NULL`.execute(ctx.core);
  return instance;
}
