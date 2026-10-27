import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deactivatePlatformAdmin } from "../../../src/modules/identity/platform-admins.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;
let a: string;
let b: string;

const info = { ip: "127.0.0.1", userAgent: null, correlationId: crypto.randomUUID() };

beforeAll(async () => {
  env = await F01TestEnv.create();
  a = (await env.insertAccount()).id;
  b = (await env.insertAccount()).id;
  const now = env.clock.now();
  for (const id of [a, b]) {
    await sql`INSERT INTO platform_role (account_id, role, status, granted_at, changed_at)
              VALUES (${uuidToBin(id)}, 'administrador', 'ativo', ${now}, ${now})`.execute(
      env.ctx.identity,
    );
  }
});
afterAll(async () => {
  await env?.cleanup();
});

const active = async () => {
  const { rows } = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM platform_role WHERE status = 'ativo'`.execute(env.ctx.identity);
  return Number(rows[0]?.n);
};

describe("último administrador sob concorrência (COM-020, T-05, CS-004)", () => {
  it("100 rodadas de duas inativações simultâneas: sempre resta exatamente um ativo", async () => {
    let conflicts = 0;
    for (let round = 0; round < 100; round += 1) {
      const results = await Promise.allSettled([
        deactivatePlatformAdmin(env.ctx, a, b, "rodada concorrente", info),
        deactivatePlatformAdmin(env.ctx, b, a, "rodada concorrente", info),
      ]);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
        code: "CONFLICT_LAST_ADMIN",
      });
      conflicts += 1;
      expect(await active()).toBe(1);
      await sql`UPDATE platform_role SET status = 'ativo'`.execute(env.ctx.identity);
    }
    expect(conflicts).toBe(100);
  });
});
