import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { F01TestEnv } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";

/**
 * SEC-13 / SEC-BASE-13: atrás de proxy listado, o Core registra o IP real do cliente (salto mais
 * à direita não confiável); sem lista, `X-Forwarded-For` é ignorado.
 */
let env: F01TestEnv;
let behindProxy: F01App;
let direct: F01App;

beforeAll(async () => {
  env = await F01TestEnv.create();
  behindProxy = await buildF01App(env, undefined, { TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8" });
  direct = await buildF01App(env);
});
afterAll(async () => {
  await behindProxy?.close();
  await direct?.close();
  await env?.cleanup();
});

async function ipOfLogin(app: F01App, forwarded: string): Promise<string | null> {
  const correlationId = crypto.randomUUID();
  await app.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    headers: {
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": forwarded,
      "x-correlation-id": correlationId,
    },
    payload: { email: `ninguem-${correlationId}@example.test`, password: "x" },
  });
  const { rows } = await sql<{ ip: string | null }>`
    SELECT ip FROM security_event WHERE correlation_id = ${correlationId}`.execute(
    env.ctx.identity,
  );
  return rows[0]?.ip ?? null;
}

describe("SEC-13 — trustProxy com lista explícita", () => {
  it("proxy confiável: IP do cliente; salto forjado à esquerda é ignorado", async () => {
    expect(await ipOfLogin(behindProxy, "203.0.113.9")).toBe("203.0.113.9");
    expect(await ipOfLogin(behindProxy, "203.0.113.9, 10.1.2.3")).toBe("203.0.113.9");
    expect(await ipOfLogin(behindProxy, "1.1.1.1, 203.0.113.10")).toBe("203.0.113.10");
  });

  it("sem lista: X-Forwarded-For não muda o IP (socket)", async () => {
    expect(await ipOfLogin(direct, "203.0.113.9")).toBe("127.0.0.1");
  });
});
