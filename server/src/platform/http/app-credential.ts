import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../context.js";
import { sha256Hex, timingSafeEqualHex } from "../crypto/index.js";
import { binToUuid, isUuid, uuidToBin } from "../ids.js";
import { withIdentity } from "./identity-errors.js";

export type AppScope = "sessions" | "members" | "connection" | "utilizacao";

export interface AppCredential {
  id: string;
  productCode: string;
  /** UUID da instância à qual esta credencial está vinculada (null = credencial por produto). */
  instanceId: string | null;
  scopes: ReadonlySet<AppScope>;
}

declare module "fastify" {
  interface FastifyRequest {
    appCredential?: AppCredential;
  }
}

const invalid = () =>
  new AppError(401, "AUTH_APP_CREDENTIAL_INVALID", "Credencial de aplicação inválida.");

const LAST_USED_WRITE_MS = 60_000;

/**
 * Autentica `/internal/v1` por `Authorization: Bearer <id>.<segredo>` (R-09): credencial ativa,
 * no prazo e com o escopo pedido. A credencial define o produto; nenhum cookie é lido aqui.
 */
export function requireAppCredential(ctx: AppContext, scope: AppScope) {
  return async (request: FastifyRequest): Promise<void> => {
    const match = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(
      request.headers.authorization ?? "",
    );
    if (!match?.[1] || !match[2] || !isUuid(match[1])) throw invalid();
    const [, id, secret] = match;
    const { rows } = await withIdentity(() =>
      sql<{
        product_code: string;
        instance_id: Buffer | null;
        secret_hash: string;
        scopes: string;
        expires_at: Date | null;
        revoked_at: Date | null;
        last_used_at: Date | null;
      }>`SELECT product_code, instance_id, secret_hash, scopes, expires_at, revoked_at, last_used_at
           FROM app_credential WHERE id = ${uuidToBin(id)}`.execute(ctx.core),
    );
    const row = rows[0];
    const now = ctx.clock();
    if (
      !row ||
      !timingSafeEqualHex(row.secret_hash, sha256Hex(secret)) ||
      row.revoked_at ||
      (row.expires_at && row.expires_at <= now)
    ) {
      throw invalid();
    }
    const scopes = new Set(row.scopes.split(",").filter(Boolean) as AppScope[]);
    if (!scopes.has(scope)) throw invalid();
    if (!row.last_used_at || now.getTime() - row.last_used_at.getTime() >= LAST_USED_WRITE_MS) {
      await sql`UPDATE app_credential SET last_used_at = ${now} WHERE id = ${uuidToBin(id)}`.execute(
        ctx.core,
      );
    }
    const instanceId = row.instance_id ? binToUuid(row.instance_id) : null;
    request.appCredential = { id, productCode: row.product_code, instanceId, scopes };
  };
}

export function credentialOf(request: FastifyRequest): AppCredential {
  if (!request.appCredential) throw invalid();
  return request.appCredential;
}
