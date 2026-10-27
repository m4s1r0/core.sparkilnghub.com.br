import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { sha256Hex } from "../../platform/crypto/index.js";

const MINUTE = 60_000;

export interface ThrottleRule {
  key: string;
  /** Falhas que provocam o bloqueio. */
  max: number;
  /** Janela da contagem; `null` = falhas consecutivas, zeradas só no sucesso. */
  windowMs: number | null;
  lockMs: number;
}

const digest = (value: string) => sha256Hex(value).slice(0, 40);

/**
 * Regras de research.md R-06. Chaves de origem e de e-mail guardam só o resumo (FR-031). No login
 * de produto a origem é a credencial de aplicação + IP do usuário informado pelo produto; o IP do
 * servidor do produto nunca é origem, senão um usuário bloquearia todos os outros.
 */
export const throttleRules = {
  account: (accountId: string): ThrottleRule => ({
    key: `account:${accountId}`,
    max: 10,
    windowMs: null,
    lockMs: 15 * MINUTE,
  }),
  /**
   * Login por e-mail informado (existente ou não): a 11ª tentativa é limitada igualmente nos dois
   * casos, sem revelar se a conta existe (FR-004, CS-007).
   */
  loginEmail: (emailNormalized: string): ThrottleRule => ({
    key: `login:${digest(emailNormalized)}`,
    max: 10,
    windowMs: null,
    lockMs: 15 * MINUTE,
  }),
  origin: (ip: string): ThrottleRule => ({
    key: `ip:${digest(ip)}`,
    max: 50,
    windowMs: 15 * MINUTE,
    lockMs: 15 * MINUTE,
  }),
  appOrigin: (credentialId: string, clientIp: string): ThrottleRule => ({
    key: `app-ip:${credentialId}:${digest(clientIp)}`,
    max: 50,
    windowMs: 15 * MINUTE,
    lockMs: 15 * MINUTE,
  }),
  inviteOrigin: (ip: string): ThrottleRule => ({
    key: `invite-ip:${digest(ip)}`,
    max: 50,
    windowMs: 15 * MINUTE,
    lockMs: 15 * MINUTE,
  }),
  recoveryEmail: (emailNormalized: string): ThrottleRule => ({
    key: `recovery-email:${digest(emailNormalized)}`,
    max: 5,
    windowMs: 60 * MINUTE,
    lockMs: 60 * MINUTE,
  }),
  recoveryOrigin: (ip: string): ThrottleRule => ({
    key: `recovery-ip:${digest(ip)}`,
    max: 20,
    windowMs: 15 * MINUTE,
    lockMs: 15 * MINUTE,
  }),
};

interface Row {
  throttle_key: string;
  failures: number;
  window_started_at: Date;
  locked_until: Date | null;
}

const secondsUntil = (until: Date, now: Date) =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));

/** Segundos até liberar a mais restritiva das regras bloqueadas, ou `null` se nenhuma. */
export async function throttleStatus(
  ctx: AppContext,
  rules: readonly ThrottleRule[],
): Promise<number | null> {
  if (rules.length === 0) return null;
  const now = ctx.clock();
  const { rows } = await sql<Pick<Row, "locked_until">>`
    SELECT locked_until FROM auth_throttle
     WHERE throttle_key IN (${sql.join(rules.map((r) => r.key))}) AND locked_until > ${now}`.execute(
    ctx.identity,
  );
  const until = rows.map((r) => r.locked_until).filter((d): d is Date => d !== null);
  if (until.length === 0) return null;
  return secondsUntil(new Date(Math.max(...until.map((d) => d.getTime()))), now);
}

/**
 * Registra uma falha em cada regra, sob `SELECT … FOR UPDATE` (falhas concorrentes não se
 * perdem). Devolve os segundos de bloqueio se alguma regra passou a bloquear.
 */
export async function registerFailure(
  ctx: AppContext,
  rules: readonly ThrottleRule[],
): Promise<number | null> {
  const now = ctx.clock();
  const sorted = [...rules].sort((a, b) => a.key.localeCompare(b.key));
  // Cria as linhas fora da transação: INSERT IGNORE sobre chave existente toma trava
  // compartilhada, e o FOR UPDATE seguinte de duas transações concorrentes entraria em deadlock.
  for (const rule of sorted) {
    await sql`INSERT IGNORE INTO auth_throttle (throttle_key, failures, window_started_at, locked_until)
              VALUES (${rule.key}, 0, ${now}, NULL)`.execute(ctx.identity);
  }
  let lockedUntil: Date | null = null;
  await ctx.identity.transaction().execute(async (trx) => {
    for (const rule of sorted) {
      const { rows } = await sql<Row>`
        SELECT throttle_key, failures, window_started_at, locked_until FROM auth_throttle
         WHERE throttle_key = ${rule.key} FOR UPDATE`.execute(trx);
      const row = rows[0];
      if (!row) continue;
      let failures = row.failures;
      let windowStart = row.window_started_at;
      let locked = row.locked_until;
      const lockExpired = locked !== null && locked <= now;
      const windowExpired =
        rule.windowMs !== null && now.getTime() - windowStart.getTime() >= rule.windowMs;
      if (lockExpired || windowExpired) {
        failures = 0;
        windowStart = now;
        locked = null;
      }
      failures += 1;
      if (failures >= rule.max && locked === null) {
        locked = new Date(now.getTime() + rule.lockMs);
      }
      await sql`UPDATE auth_throttle
                   SET failures = ${failures}, window_started_at = ${windowStart}, locked_until = ${locked}
                 WHERE throttle_key = ${rule.key}`.execute(trx);
      if (locked && locked > now && (!lockedUntil || locked > lockedUntil)) lockedUntil = locked;
    }
  });
  return lockedUntil ? secondsUntil(lockedUntil, now) : null;
}

/** Sucesso zera a contagem (falhas consecutivas por conta). */
export async function clearFailures(
  ctx: AppContext,
  rules: readonly ThrottleRule[],
): Promise<void> {
  if (rules.length === 0) return;
  await sql`DELETE FROM auth_throttle WHERE throttle_key IN (${sql.join(
    rules.map((r) => r.key),
  )})`.execute(ctx.identity);
}
