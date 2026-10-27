import { sql, type Kysely } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { decryptSecret, encryptSecret } from "../../platform/crypto/index.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import type { AuthContext } from "../../platform/http/session-guard.js";
import { markSessionMfa } from "./core-sessions.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { recordSecurityEvent } from "./security-events.js";
import { clearFailures, registerFailure, throttleRules, throttleStatus } from "./throttle.js";
import {
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "./totp.js";

interface FactorRow {
  secret_enc: Buffer;
  key_version: number;
  confirmed_at: Date | null;
  last_step: number | null;
}

async function factorRow(db: Kysely<unknown>, accountId: string): Promise<FactorRow | null> {
  const { rows } = await sql<FactorRow>`
    SELECT secret_enc, key_version, confirmed_at, last_step FROM totp_factor
     WHERE account_id = ${uuidToBin(accountId)}`.execute(db);
  return rows[0] ?? null;
}

/** Fator TOTP confirmado da conta. */
export async function hasConfirmedFactor(db: Kysely<unknown>, accountId: string): Promise<boolean> {
  return (await factorRow(db, accountId))?.confirmed_at != null;
}

const aad = (accountId: string) => uuidToBin(accountId);

function secretOf(ctx: AppContext, accountId: string, row: FactorRow): Buffer {
  return decryptSecret(ctx.keyRing, row.secret_enc, row.key_version, aad(accountId));
}

/** Avança o último passo aceito só se ainda for menor (corrida de dois códigos iguais). */
async function consumeStep(db: Kysely<unknown>, accountId: string, step: number): Promise<boolean> {
  const result = await sql`UPDATE totp_factor SET last_step = ${step}
     WHERE account_id = ${uuidToBin(accountId)} AND (last_step IS NULL OR last_step < ${step})`.execute(
    db,
  );
  return Number(result.numAffectedRows ?? 0) === 1;
}

/**
 * Inicia o cadastro do TOTP (FR-006). Só existe quando a conta não tem fator confirmado: com a
 * senha apenas, ninguém troca o fator de outra pessoa. O segredo é cifrado com chave externa.
 */
export async function startEnrollment(
  ctx: AppContext,
  auth: AuthContext,
): Promise<{ otpauthUri: string; secret: string }> {
  if (await hasConfirmedFactor(ctx.identity, auth.account.id)) {
    throw identityErrors.mfaAlreadyEnrolled();
  }
  const secret = generateTotpSecret();
  const { data, keyVersion } = encryptSecret(ctx.keyRing, secret, aad(auth.account.id));
  await sql`INSERT INTO totp_factor (account_id, secret_enc, key_version, enrolled_at)
            VALUES (${uuidToBin(auth.account.id)}, ${data}, ${keyVersion}, ${ctx.clock()})
            ON DUPLICATE KEY UPDATE secret_enc = VALUES(secret_enc),
              key_version = VALUES(key_version), enrolled_at = VALUES(enrolled_at),
              confirmed_at = NULL, last_step = NULL`.execute(ctx.identity);
  return { otpauthUri: otpauthUri(secret, auth.account.email), secret: base32Encode(secret) };
}

/**
 * Confirma o cadastro com o primeiro código: gera 10 códigos de recuperação (exibidos uma vez,
 * gravados como sha256) e conclui o segundo fator da sessão (FR-007).
 */
export async function confirmEnrollment(
  ctx: AppContext,
  auth: AuthContext,
  code: string,
  info: RequestInfo,
): Promise<string[]> {
  const now = ctx.clock();
  const accountId = auth.account.id;
  await assertNotThrottled(ctx, accountId, info);
  const row = await factorRow(ctx.identity, accountId);
  if (!row || row.confirmed_at) throw identityErrors.mfaInvalid();
  const result = verifyTotp(secretOf(ctx, accountId, row), code, now.getTime(), row.last_step);
  if (!result.ok) return failMfa(ctx, accountId, info, "cadastro");

  const codes = generateRecoveryCodes();
  // DELETE sobre faixa vazia toma trava de intervalo: cadastros simultâneos podem colidir.
  await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      await sql`UPDATE totp_factor SET confirmed_at = ${now}, last_step = ${result.step}
               WHERE account_id = ${uuidToBin(accountId)}`.execute(trx);
      await sql`DELETE FROM recovery_code WHERE account_id = ${uuidToBin(accountId)}`.execute(trx);
      for (const recovery of codes) {
        await sql`INSERT INTO recovery_code (id, account_id, code_hash)
                VALUES (${uuidToBin(newId())}, ${uuidToBin(accountId)}, ${hashRecoveryCode(recovery)})`.execute(
          trx,
        );
      }
      await markSessionMfa(trx, auth.session.idHash, now);
      await recordSecurityEvent(trx, {
        type: "mfa_cadastrado",
        actorKind: "usuario",
        actorAccountId: accountId,
        targetAccountId: accountId,
        result: "sucesso",
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
    }),
  );
  await clearFailures(ctx, [throttleRules.account(accountId)]);
  return codes;
}

async function assertNotThrottled(ctx: AppContext, accountId: string, info: RequestInfo) {
  const locked = await throttleStatus(ctx, [
    throttleRules.account(accountId),
    throttleRules.origin(info.ip),
  ]);
  if (locked) throw identityErrors.throttled(locked);
}

async function failMfa(
  ctx: AppContext,
  accountId: string,
  info: RequestInfo,
  stage: string,
): Promise<never> {
  const locked = await registerFailure(ctx, [
    throttleRules.account(accountId),
    throttleRules.origin(info.ip),
  ]);
  await recordSecurityEvent(ctx.identity, {
    type: "login_mfa",
    actorKind: "usuario",
    actorAccountId: accountId,
    targetAccountId: accountId,
    result: "falha",
    detail: { etapa: stage },
    correlationId: info.correlationId,
    ip: info.ip,
    userAgent: info.userAgent,
    at: ctx.clock(),
  });
  if (locked) throw identityErrors.throttled(locked);
  throw identityErrors.mfaInvalid();
}

/**
 * Segundo passo do login. Código TOTP válido conclui a sessão. Código de recuperação vale uma
 * vez, remove o fator e obriga recadastrar o TOTP antes de qualquer outra ação.
 */
export async function verifySecondFactor(
  ctx: AppContext,
  auth: AuthContext,
  input: { code: string } | { recoveryCode: string },
  info: RequestInfo,
): Promise<"done" | "mfa_enrollment"> {
  const now = ctx.clock();
  const accountId = auth.account.id;
  await assertNotThrottled(ctx, accountId, info);

  if ("recoveryCode" in input) {
    const consumed = await retryOnDeadlock(() =>
      ctx.identity.transaction().execute(async (trx) => {
        const result = await sql`UPDATE recovery_code SET used_at = ${now}
         WHERE account_id = ${uuidToBin(accountId)}
           AND code_hash = ${hashRecoveryCode(input.recoveryCode)} AND used_at IS NULL
         LIMIT 1`.execute(trx);
        if (Number(result.numAffectedRows ?? 0) !== 1) return false;
        await sql`DELETE FROM totp_factor WHERE account_id = ${uuidToBin(accountId)}`.execute(trx);
        await markSessionMfa(trx, auth.session.idHash, null);
        await recordSecurityEvent(trx, {
          type: "codigo_recuperacao_usado",
          actorKind: "usuario",
          actorAccountId: accountId,
          targetAccountId: accountId,
          result: "sucesso",
          correlationId: info.correlationId,
          ip: info.ip,
          userAgent: info.userAgent,
          at: now,
        });
        return true;
      }),
    );
    if (!consumed) return failMfa(ctx, accountId, info, "codigo_recuperacao");
    await clearFailures(ctx, [throttleRules.account(accountId)]);
    return "mfa_enrollment";
  }

  const row = await factorRow(ctx.identity, accountId);
  if (!row?.confirmed_at) return failMfa(ctx, accountId, info, "sem_fator");
  const result = verifyTotp(
    secretOf(ctx, accountId, row),
    input.code,
    now.getTime(),
    row.last_step,
  );
  if (!result.ok || !(await consumeStep(ctx.identity, accountId, result.step))) {
    return failMfa(ctx, accountId, info, "totp");
  }
  await markSessionMfa(ctx.identity, auth.session.idHash, now);
  await clearFailures(ctx, [throttleRules.account(accountId)]);
  await recordSecurityEvent(ctx.identity, {
    type: "login_mfa",
    actorKind: "usuario",
    actorAccountId: accountId,
    targetAccountId: accountId,
    result: "sucesso",
    correlationId: info.correlationId,
    ip: info.ip,
    userAgent: info.userAgent,
    at: now,
  });
  return "done";
}

/** Reconfirmação do TOTP para ações sensíveis; vale 5 minutos (FR-008). */
export async function reauthenticate(
  ctx: AppContext,
  auth: AuthContext,
  code: string,
  info: RequestInfo,
): Promise<Date> {
  const now = ctx.clock();
  const accountId = auth.account.id;
  await assertNotThrottled(ctx, accountId, info);
  const row = await factorRow(ctx.identity, accountId);
  if (!row?.confirmed_at) return failMfa(ctx, accountId, info, "reautenticacao");
  const result = verifyTotp(secretOf(ctx, accountId, row), code, now.getTime(), row.last_step);
  if (!result.ok || !(await consumeStep(ctx.identity, accountId, result.step))) {
    return failMfa(ctx, accountId, info, "reautenticacao");
  }
  await markSessionMfa(ctx.identity, auth.session.idHash, now);
  await clearFailures(ctx, [throttleRules.account(accountId)]);
  await recordSecurityEvent(ctx.identity, {
    type: "reautenticacao",
    actorKind: "usuario",
    actorAccountId: accountId,
    result: "sucesso",
    correlationId: info.correlationId,
    ip: info.ip,
    userAgent: info.userAgent,
    at: now,
  });
  return now;
}
