import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearFailures,
  registerFailure,
  throttleRules,
  throttleStatus,
} from "../../../src/modules/identity/throttle.js";
import { newId } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;
const MIN = 60_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});
beforeEach(async () => {
  await sql`DELETE FROM auth_throttle`.execute(env.ctx.identity);
});

describe("limitação de tentativas (FR-004, R-06, CS-007)", () => {
  it("10 falhas da conta → 11ª limitada por 15 min; depois a contagem recomeça", async () => {
    const rule = throttleRules.account(newId());
    for (let i = 0; i < 9; i += 1) expect(await registerFailure(env.ctx, [rule])).toBeNull();
    expect(await throttleStatus(env.ctx, [rule])).toBeNull();
    expect(await registerFailure(env.ctx, [rule])).toBe(15 * 60);
    expect(await throttleStatus(env.ctx, [rule])).toBe(15 * 60);

    env.clock.advance(14 * MIN);
    expect(await throttleStatus(env.ctx, [rule])).toBe(60);
    env.clock.advance(MIN);
    expect(await throttleStatus(env.ctx, [rule])).toBeNull();
    expect(await registerFailure(env.ctx, [rule])).toBeNull();
  });

  it("sucesso zera a contagem da conta", async () => {
    const rule = throttleRules.account(newId());
    for (let i = 0; i < 9; i += 1) await registerFailure(env.ctx, [rule]);
    await clearFailures(env.ctx, [rule]);
    expect(await registerFailure(env.ctx, [rule])).toBeNull();
  });

  it("50 falhas da mesma origem em 15 min bloqueiam a origem; fora da janela recomeça", async () => {
    const rule = throttleRules.origin("203.0.113.7");
    for (let i = 0; i < 30; i += 1) await registerFailure(env.ctx, [rule]);
    env.clock.advance(16 * MIN);
    for (let i = 0; i < 49; i += 1) expect(await registerFailure(env.ctx, [rule])).toBeNull();
    expect(await registerFailure(env.ctx, [rule])).toBe(15 * 60);
    expect(await throttleStatus(env.ctx, [throttleRules.origin("203.0.113.8")])).toBeNull();
  });

  it("login de produto: origem é a credencial + IP do usuário, nunca o servidor do produto", () => {
    const credential = newId();
    const a = throttleRules.appOrigin(credential, "198.51.100.1");
    const b = throttleRules.appOrigin(credential, "198.51.100.2");
    expect(a.key).not.toBe(b.key);
    expect(a.key.startsWith(`app-ip:${credential}:`)).toBe(true);
    expect(a.max).toBe(50);
  });

  it("aceite de convite: token inválido limitado por origem; senha atual errada por conta", () => {
    expect(throttleRules.inviteOrigin("192.0.2.1")).toMatchObject({ max: 50 });
    expect(throttleRules.account(newId())).toMatchObject({ max: 10 });
  });

  it("pedidos de recuperação: 5 por e-mail por hora", async () => {
    const rule = throttleRules.recoveryEmail("ana@example.test");
    for (let i = 0; i < 4; i += 1) expect(await registerFailure(env.ctx, [rule])).toBeNull();
    expect(await registerFailure(env.ctx, [rule])).not.toBeNull();
    expect(await throttleStatus(env.ctx, [rule])).not.toBeNull();
    expect(throttleRules.recoveryOrigin("192.0.2.9")).toMatchObject({ max: 20 });
  });

  it("o banco guarda só o resumo do IP e do e-mail (FR-031)", async () => {
    await registerFailure(env.ctx, [
      throttleRules.origin("203.0.113.99"),
      throttleRules.recoveryEmail("carla@example.test"),
    ]);
    const { rows } = await sql<{
      throttle_key: string;
    }>`SELECT throttle_key FROM auth_throttle`.execute(env.ctx.identity);
    const keys = rows.map((r) => r.throttle_key).join(" ");
    expect(keys).not.toContain("203.0.113.99");
    expect(keys).not.toContain("carla");
  });

  it("falhas concorrentes não se perdem", async () => {
    const rule = throttleRules.origin("203.0.113.50");
    await Promise.all(Array.from({ length: 20 }, () => registerFailure(env.ctx, [rule])));
    const { rows } = await sql<{ failures: number }>`
      SELECT failures FROM auth_throttle WHERE throttle_key = ${rule.key}`.execute(
      env.ctx.identity,
    );
    expect(rows[0]?.failures).toBe(20);
  });
});
