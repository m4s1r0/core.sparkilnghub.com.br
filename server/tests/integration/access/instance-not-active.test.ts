import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let ready: TestInstance;
let active: TestInstance;
let credential: string;
let ana: { id: string; email: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  ready = await env.createInstance("pronta-a");
  active = await env.createInstance("ativa-b");
  credential = await appCredential(env);
  ana = await env.insertAccount();
  await env.insertMembership(ana.id, ready.id, "administrador");
  await env.insertMembership(ana.id, active.id, "administrador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const login = (slug: string) =>
  app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${slug}/sessions`,
    headers: { authorization: `Bearer ${credential}` },
    payload: { email: ana.email, password: ana.password, clientIp: "198.51.100.7" },
  });

/** Volta a instância de apoio para PRONTA na fonte e na projeção (fixture de teste). */
async function makeReady(instance: TestInstance) {
  await sql`UPDATE instance SET state = 'PRONTA' WHERE id = ${uuidToBin(instance.id)}`.execute(
    env.ctx.core,
  );
  await sql`UPDATE access_instance SET state = 'pronta'`.execute(
    env.ctx.access(instance.accessDatabaseName),
  );
}

describe("instância ainda não ativa (CA-SC-007, FR-028, projeção v2)", () => {
  it("login de produto em instância PRONTA → 401 genérico, sem gravar sessão", async () => {
    const before = await login(ready.slug);
    expect(before.statusCode).toBe(201);
    const { token } = before.json<{ token: string }>();
    await makeReady(ready);

    const response = await login(ready.slug);
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_INVALID_CREDENTIALS",
    );
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_session`.execute(
      env.ctx.access(ready.accessDatabaseName),
    );
    expect(Number(rows[0]?.n)).toBe(1);

    // A regra normativa do contrato (state = 'ativa') nega a sessão anterior na instância pronta.
    const product = await productFor(env, app, ready, credential);
    expect(await product.validate(token, env.clock.now())).toBeNull();
  });

  it("instâncias ATIVA continuam aceitando login e validando sessões", async () => {
    const response = await login(active.slug);
    expect(response.statusCode).toBe(201);
    const product = await productFor(env, app, active, credential);
    expect(
      await product.validate(response.json<{ token: string }>().token, env.clock.now()),
    ).not.toBeNull();
  });
});
