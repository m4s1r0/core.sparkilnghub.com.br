import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { throttleRules } from "../../../../src/modules/identity/throttle.js";
import { F01TestEnv, type TestInstance } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";
import { appCredential } from "../../../support/product.js";

/**
 * SEC-02 (parte Core) / SEC-BASE-02: `clientIp` só IPv4/IPv6; teto global de falhas de login por
 * credencial de aplicação, checado antes de verificar a senha.
 */
let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let credential: string;
let ana: { id: string; email: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("lim-a");
  credential = await appCredential(env, "sparkref", ["sessions"], a.id);
  ana = await env.insertAccount();
  await env.insertMembership(ana.id, a.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const login = (clientIp: string, password = ana.password) =>
  app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${a.slug}/sessions`,
    headers: { authorization: `Bearer ${credential}` },
    payload: { email: ana.email, password, clientIp },
  });

describe("SEC-02 — clientIp validado e teto por credencial", () => {
  it.each(["nao-e-ip", "999.1.1.1", "fe80::1%eth0", "198.51.100.1, 10.0.0.1", ""])(
    "clientIp %j → 422",
    async (clientIp) => {
      expect((await login(clientIp)).statusCode).toBe(422);
    },
  );

  it("IPv4, IPv6 e IPv4 mapeado são aceitos", async () => {
    for (const ip of ["198.51.100.70", "2001:db8::70", "::ffff:198.51.100.71"]) {
      expect((await login(ip)).statusCode).toBe(201);
    }
  });

  it("teto de falhas da credencial atingido → 429 antes da senha, mesmo correta", async () => {
    const id = credential.split(".")[0] ?? "";
    const rule = throttleRules.appCredential(id);
    expect(rule.max).toBe(300);
    await sql`INSERT INTO auth_throttle (throttle_key, failures, window_started_at, locked_until)
              VALUES (${rule.key}, ${rule.max - 1}, ${env.clock.now()}, NULL)`.execute(
      env.ctx.identity,
    );
    expect((await login("198.51.100.80", "senha errada")).statusCode).toBe(429);
    const blocked = await login("198.51.100.81");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    // Outra credencial (outra instância) não é afetada.
    const b = await env.createInstance("lim-b");
    await env.insertMembership(ana.id, b.id, "colaborador");
    const other = await appCredential(env, "sparkref", ["sessions"], b.id);
    const response = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${b.slug}/sessions`,
      headers: { authorization: `Bearer ${other}` },
      payload: { email: ana.email, password: ana.password, clientIp: "198.51.100.82" },
    });
    expect(response.statusCode).toBe(201);
  });
});
