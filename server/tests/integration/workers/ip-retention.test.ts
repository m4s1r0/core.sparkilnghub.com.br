import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanIpRetention } from "../../../src/workers/ip-retention.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

async function insertSecurityEvent(options: {
  createdAt: Date;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await sql`
    INSERT INTO security_event
      (id, type, actor_kind, result, ip, user_agent, created_at)
    VALUES (${uuidToBin(newId())}, 'login', 'usuario', 'sucesso',
            ${options.ip ?? "127.0.0.1"}, ${options.userAgent ?? "TestAgent/1.0"},
            ${options.createdAt})
  `.execute(env.ctx.identity);
}

describe("cleanIpRetention (US6, SC-033, R-03)", () => {
  it("evento com 181 dias → ip e user_agent limpos", async () => {
    const now = new Date(); // tempo real — cleanIpRetention usa MySQL NOW()
    const old = new Date(now.getTime() - 181 * 24 * 60 * 60 * 1000);
    await insertSecurityEvent({ createdAt: old, ip: "10.0.0.1", userAgent: "Agent/1" });

    const { affected } = await cleanIpRetention(env.ctx.identity);
    expect(affected).toBeGreaterThan(0);

    // Verificar que não resta nenhum evento antigo com ip/ua preenchidos
    const { rows } = await sql<{ cnt: number }>`
      SELECT COUNT(*) AS cnt FROM security_event
       WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY)
         AND (ip IS NOT NULL OR user_agent IS NOT NULL)
    `.execute(env.ctx.identity);
    expect(Number(rows[0]?.cnt)).toBe(0);
  });

  it("evento com 179 dias → ip e user_agent intactos", async () => {
    const now = new Date(); // tempo real — cleanIpRetention usa MySQL NOW()
    const recent = new Date(now.getTime() - 179 * 24 * 60 * 60 * 1000);
    const eid = newId();
    await sql`
      INSERT INTO security_event
        (id, type, actor_kind, result, ip, user_agent, created_at)
      VALUES (${uuidToBin(eid)}, 'logout', 'usuario', 'sucesso',
              '192.168.1.1', 'RecentAgent/1.0', ${recent})
    `.execute(env.ctx.identity);

    await cleanIpRetention(env.ctx.identity);

    const { rows } = await sql<{ ip: string | null; user_agent: string | null }>`
      SELECT ip, user_agent FROM security_event WHERE id = ${uuidToBin(eid)}
    `.execute(env.ctx.identity);
    expect(rows[0]?.ip).toBe("192.168.1.1");
    expect(rows[0]?.user_agent).toBe("RecentAgent/1.0");
  });

  it("execução dupla → idempotente, zero afetados na segunda", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 200 * 24 * 60 * 60 * 1000);
    await insertSecurityEvent({ createdAt: old });

    await cleanIpRetention(env.ctx.identity);
    const { affected: secondRun } = await cleanIpRetention(env.ctx.identity);
    expect(secondRun).toBe(0);
  });

  it("retorna contagem total correta de linhas afetadas", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 185 * 24 * 60 * 60 * 1000);

    // Limpar estado anterior (já limpos de testes anteriores)
    await cleanIpRetention(env.ctx.identity);

    // Inserir 3 eventos velhos com ip/ua
    for (let i = 0; i < 3; i++) {
      await insertSecurityEvent({ createdAt: old, ip: `10.0.${i}.1`, userAgent: `Bot/${i}` });
    }

    const { affected } = await cleanIpRetention(env.ctx.identity);
    expect(affected).toBeGreaterThanOrEqual(3);
  });

  it("evento já com ip=NULL e ua=NULL → não é recontado (idempotência por WHERE)", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 190 * 24 * 60 * 60 * 1000);

    await sql`
      INSERT INTO security_event
        (id, type, actor_kind, result, ip, user_agent, created_at)
      VALUES (${uuidToBin(newId())}, 'login', 'sistema', 'sucesso', NULL, NULL, ${old})
    `.execute(env.ctx.identity);

    const { affected } = await cleanIpRetention(env.ctx.identity);
    // Registros já com NULL não devem ser afetados
    expect(affected).toBe(0);
  });
});
