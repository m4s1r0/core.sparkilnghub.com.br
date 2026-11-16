import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { findAccountByEmail, passwordHashOf, updatePasswordHash } from "./accounts.js";
import { createCoreSession } from "./core-sessions.js";
import { normalizeEmail } from "./email.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { hasConfirmedFactor } from "./mfa.js";
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from "./password.js";
import { recordSecurityEvent } from "./security-events.js";
import {
  clearFailures,
  registerFailureDetailed,
  throttleRules,
  throttleStatus,
} from "./throttle.js";

/**
 * Aviso de bloqueio total da conta por volume de falhas (SEC-14): evento de segurança dirigido ao
 * titular (`target_account_id`), listado na consulta de eventos dos administradores da plataforma
 * (F08), e alerta no log. O Core ainda não tem canal de e-mail; quando houver, o envio parte daqui.
 * E-mail sem conta não gera aviso (nada a avisar, e a resposta ao chamador é a mesma).
 */
export async function notifyAccountLocked(
  ctx: AppContext,
  account: { id: string } | null,
  newlyLocked: readonly string[],
  emailKey: string,
  event: {
    actorKind: "usuario" | "aplicacao";
    instanceId?: string | null;
    ip: string;
    userAgent: string | null;
    correlationId: string;
    at: Date;
  },
): Promise<void> {
  if (!account || !newlyLocked.includes(emailKey)) return;
  await recordSecurityEvent(ctx.identity, {
    type: "login_bloqueado",
    actorKind: event.actorKind,
    targetAccountId: account.id,
    instanceId: event.instanceId ?? null,
    result: "negado",
    detail: { motivo: "volume_de_falhas", minutos: 15 },
    correlationId: event.correlationId,
    ip: event.ip,
    userAgent: event.userAgent,
    at: event.at,
  });
  ctx.logger.warn(
    { alert: "login_bloqueado", accountId: account.id, correlationId: event.correlationId },
    "Conta bloqueada por volume de falhas de login",
  );
}

export async function isActivePlatformAdmin(ctx: AppContext, accountId: string): Promise<boolean> {
  const { rows } = await sql<{ status: string }>`
    SELECT status FROM platform_role WHERE account_id = ${uuidToBin(accountId)}`.execute(
    ctx.identity,
  );
  return rows[0]?.status === "ativo";
}

/**
 * Primeiro passo do login do painel (FR-006): e-mail e senha. Conta inexistente, senha errada,
 * conta inativa/bloqueada ou conta sem papel de plataforma recebem a mesma resposta e o mesmo
 * custo de verificação (FR-004). Sucesso cria sessão pré-MFA: só o segundo fator a conclui.
 */
export async function loginWithPassword(
  ctx: AppContext,
  input: { email: string; password: string },
  info: RequestInfo,
): Promise<{ token: string; next: "mfa" | "mfa_enrollment" }> {
  const now = ctx.clock();
  const email = normalizeEmail(input.email);
  const emailRule = throttleRules.loginEmail(email);
  const pairRule = throttleRules.loginPair(email, info.ip);
  const rules = [emailRule, pairRule, throttleRules.origin(info.ip)];
  const locked = await throttleStatus(ctx, rules);
  if (locked) throw identityErrors.throttled(locked);

  const account = await findAccountByEmail(ctx.identity, email);
  const stored = account ? await passwordHashOf(ctx.identity, account.id) : null;
  const passwordOk = stored
    ? await verifyPassword(stored.hash, input.password)
    : (await burnPasswordCheck(input.password), false);
  const allowed =
    passwordOk && account?.status === "ativa" && (await isActivePlatformAdmin(ctx, account.id));

  if (!account || !allowed) {
    const { lockedSeconds: nowLocked, newlyLocked } = await registerFailureDetailed(ctx, rules);
    await notifyAccountLocked(ctx, account, newlyLocked, emailRule.key, {
      actorKind: "usuario",
      ip: info.ip,
      userAgent: info.userAgent,
      correlationId: info.correlationId,
      at: now,
    });
    await recordSecurityEvent(ctx.identity, {
      type: "login",
      actorKind: "usuario",
      targetAccountId: account?.id ?? null,
      result: "falha",
      detail: { etapa: "senha" },
      correlationId: info.correlationId,
      ip: info.ip,
      userAgent: info.userAgent,
      at: now,
    });
    if (nowLocked) throw identityErrors.throttled(nowLocked);
    throw identityErrors.invalidCredentials();
  }

  // Sucesso zera o atraso deste (e-mail, origem); o volume da conta vindo de outras origens segue.
  await clearFailures(ctx, [pairRule]);
  if (stored && needsRehash(stored.paramsVersion)) {
    await updatePasswordHash(ctx.identity, now, account.id, await hashPassword(input.password));
  }
  const { token } = await createCoreSession(
    ctx.identity,
    now,
    account.id,
    account.authRevision,
    null,
  );
  await recordSecurityEvent(ctx.identity, {
    type: "login",
    actorKind: "usuario",
    actorAccountId: account.id,
    targetAccountId: account.id,
    result: "sucesso",
    detail: { etapa: "senha" },
    correlationId: info.correlationId,
    ip: info.ip,
    userAgent: info.userAgent,
    at: now,
  });
  const enrolled = await hasConfirmedFactor(ctx.identity, account.id);
  return { token, next: enrolled ? "mfa" : "mfa_enrollment" };
}
