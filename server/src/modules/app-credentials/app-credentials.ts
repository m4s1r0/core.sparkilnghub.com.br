import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { randomToken, sha256Hex } from "../../platform/crypto/index.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import type { AppScope } from "../../platform/http/app-credential.js";

export interface AppCredentialInfo {
  id: string;
  productCode: string;
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
  data: { productCode: string; label: string; scopes: AppScope[]; expiresAt?: Date | null },
): Promise<{ id: string; value: string }> {
  const id = newId();
  const secret = randomToken();
  await sql`INSERT INTO app_credential
      (id, product_code, label, secret_hash, scopes, created_at, expires_at)
    VALUES (${uuidToBin(id)}, ${data.productCode}, ${data.label}, ${sha256Hex(secret)},
            ${[...new Set(data.scopes)].join(",")}, ${ctx.clock()}, ${data.expiresAt ?? null})`.execute(
    ctx.core,
  );
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
    label: string;
    scopes: string;
    created_at: Date;
    expires_at: Date | null;
    revoked_at: Date | null;
    last_used_at: Date | null;
  }>`SELECT id, product_code, label, scopes, created_at, expires_at, revoked_at, last_used_at
       FROM app_credential ORDER BY created_at`.execute(ctx.core);
  return rows.map((row) => ({
    id: binToUuid(row.id),
    productCode: row.product_code,
    label: row.label,
    scopes: row.scopes.split(",").filter(Boolean) as AppScope[],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
  }));
}
