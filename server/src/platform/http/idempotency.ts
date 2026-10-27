import type { FastifyReply, FastifyRequest } from "fastify";
import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../context.js";
import { decryptSecret, encryptSecret, sha256Hex } from "../crypto/index.js";
import { isUuid } from "../ids.js";

/** Respostas guardadas por 24 h (COM-026, constituição IV). */
const TTL_MS = 24 * 3600_000;

export interface IdempotencyScope {
  /** Quem age (conta, credencial de aplicação). */
  actor: string;
  operation: string;
  instanceId?: string;
}

interface Stored {
  request_hash: string;
  status_code: number;
  response_enc: Buffer | null;
  key_version: number;
}

const send = (reply: FastifyReply, status: number, body: unknown) =>
  body === undefined ? reply.status(status).send() : reply.status(status).send(body);

/**
 * Executa `run` uma única vez por (ator, operação, instância, `Idempotency-Key`). Mesma chave e
 * mesmo corpo repetem a resposta guardada; corpo diferente → 409. A resposta fica cifrada porque
 * pode conter link de uso único (D-07). Falha não é guardada: a repetição tenta de novo.
 */
export async function withIdempotency(
  ctx: AppContext,
  request: FastifyRequest,
  reply: FastifyReply,
  scope: IdempotencyScope,
  run: () => Promise<{ status: number; body?: unknown }>,
): Promise<FastifyReply> {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !isUuid(key)) {
    throw new AppError(422, "VALIDATION_FAILED", "Informe o cabeçalho Idempotency-Key (UUID).", {
      field: "Idempotency-Key",
    });
  }
  const scopeKey = sha256Hex(
    [scope.actor, scope.operation, scope.instanceId ?? "", key.toLowerCase()].join("|"),
  );
  const requestHash = sha256Hex(JSON.stringify({ params: request.params, body: request.body }));
  const now = ctx.clock();
  const db = ctx.identity;

  await sql`DELETE FROM idempotency_record
             WHERE scope_key = ${scopeKey} AND expires_at <= ${now}`.execute(db);
  const inserted = await sql`INSERT IGNORE INTO idempotency_record
      (scope_key, request_hash, status_code, response_enc, key_version, created_at, expires_at)
    VALUES (${scopeKey}, ${requestHash}, 0, NULL, 0, ${now},
            ${new Date(now.getTime() + TTL_MS)})`.execute(db);

  if (Number(inserted.numAffectedRows ?? 0) === 0) {
    const { rows } = await sql<Stored>`SELECT request_hash, status_code, response_enc, key_version
        FROM idempotency_record WHERE scope_key = ${scopeKey}`.execute(db);
    const stored = rows[0];
    if (!stored || stored.request_hash !== requestHash) {
      throw new AppError(
        409,
        "CONFLICT_IDEMPOTENCY_KEY_REUSED",
        "Esta chave de idempotência já foi usada com outros dados.",
      );
    }
    if (stored.status_code === 0) {
      throw new AppError(409, "CONFLICT_IDEMPOTENCY_IN_PROGRESS", "Operação em andamento.", {
        retryable: true,
        retryAfterSeconds: 2,
      });
    }
    const body = stored.response_enc
      ? (JSON.parse(
          decryptSecret(
            ctx.keyRing,
            stored.response_enc,
            stored.key_version,
            Buffer.from(scopeKey),
          ).toString("utf8"),
        ) as unknown)
      : undefined;
    return send(reply, stored.status_code, body);
  }

  let result: { status: number; body?: unknown };
  try {
    result = await run();
  } catch (error) {
    await sql`DELETE FROM idempotency_record WHERE scope_key = ${scopeKey}`.execute(db);
    throw error;
  }
  const encrypted =
    result.body === undefined
      ? null
      : encryptSecret(ctx.keyRing, Buffer.from(JSON.stringify(result.body)), Buffer.from(scopeKey));
  await sql`UPDATE idempotency_record
               SET status_code = ${result.status}, response_enc = ${encrypted?.data ?? null},
                   key_version = ${encrypted?.keyVersion ?? 0}
             WHERE scope_key = ${scopeKey}`.execute(db);
  return send(reply, result.status, result.body);
}
