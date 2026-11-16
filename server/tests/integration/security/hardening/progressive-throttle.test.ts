import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../../../src/app/errors.js";
import { normalizeEmail } from "../../../../src/modules/identity/email.js";
import { loginWithPassword } from "../../../../src/modules/identity/login.js";
import { throttleRules } from "../../../../src/modules/identity/throttle.js";
import { uuidToBin } from "../../../../src/platform/ids.js";
import { F01TestEnv } from "../../../support/f01.js";

/**
 * SEC-14 / SEC-BASE-14: falhas atrasam progressivamente o par (e-mail, origem); o bloqueio total
 * da conta exige volume alto e avisa titular e administradores da plataforma.
 */
let env: F01TestEnv;
let carol: { id: string; email: string; password: string };

const info = (ip: string) => ({ ip, userAgent: null, correlationId: crypto.randomUUID() });

async function attempt(ip: string, password: string): Promise<{ status: number; retry?: number }> {
  try {
    await loginWithPassword(env.ctx, { email: carol.email, password }, info(ip));
    return { status: 200 };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const retry = error.options?.retryAfterSeconds;
    return retry === undefined ? { status: error.statusCode } : { status: error.statusCode, retry };
  }
}

beforeAll(async () => {
  env = await F01TestEnv.create();
  carol = await env.insertAccount();
  await sql`INSERT INTO platform_role (account_id, role, status, granted_at, changed_at)
            VALUES (${uuidToBin(carol.id)}, 'administrador', 'ativo', ${env.clock.now()},
                    ${env.clock.now()})`.execute(env.ctx.identity);
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await sql`DELETE FROM auth_throttle`.execute(env.ctx.identity);
});

describe("SEC-14 — atraso progressivo por (e-mail, origem) e bloqueio por volume", () => {
  it("10 falhas da origem X não bloqueiam o login correto pela origem Y", async () => {
    // 70 s entre tentativas: o atraso do par (até 32 s na 10ª) sempre venceu, então as 10 falhas
    // são todas registradas; o relógio não anda o bastante para soltar um bloqueio de 15 min.
    for (let i = 0; i < 10; i += 1) {
      expect([401, 429]).toContain((await attempt("203.0.113.50", "senha errada")).status);
      env.clock.advance(70_000);
    }
    expect((await attempt("198.51.100.60", carol.password)).status).toBe(200);
  });

  it("a partir da 5ª falha do par o atraso dobra a cada nova falha; outra origem não espera", async () => {
    for (let i = 0; i < 4; i += 1) expect((await attempt("203.0.113.51", "x")).status).toBe(401);
    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await attempt("203.0.113.51", "x");
      expect(result.status).toBe(429);
      delays.push(result.retry ?? 0);
      // Ainda bloqueado: a mesma origem espera, mesmo com a senha certa; outra origem segue.
      expect((await attempt("203.0.113.51", carol.password)).status).toBe(429);
      expect((await attempt("203.0.113.52", "x")).status).toBe(401);
      env.clock.advance(((result.retry ?? 0) + 1) * 1000);
    }
    expect(delays).toEqual([1, 2, 4]);
  });

  it("volume alto (100 falhas de qualquer origem) bloqueia a conta e avisa titular e plataforma", async () => {
    const rule = throttleRules.loginEmail(normalizeEmail(carol.email));
    expect(rule.max).toBe(100);
    await sql`INSERT INTO auth_throttle (throttle_key, failures, window_started_at, locked_until)
              VALUES (${rule.key}, 99, ${env.clock.now()}, NULL)`.execute(env.ctx.identity);
    expect((await attempt("192.0.2.77", "x")).status).toBe(429);
    expect((await attempt("192.0.2.78", carol.password)).status).toBe(429);
    const { rows } = await sql<{ result: string; target: Buffer | null }>`
      SELECT result, target_account_id AS target FROM security_event
       WHERE type = 'login_bloqueado'`.execute(env.ctx.identity);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe("negado");
    expect(rows[0]?.target?.equals(uuidToBin(carol.id))).toBe(true);
  });
});
