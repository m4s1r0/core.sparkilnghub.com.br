import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Type from "typebox";
import { setSessionCookie } from "../../src/platform/http/cookies.js";
import { withIdempotency } from "../../src/platform/http/idempotency.js";
import { F01TestEnv } from "../support/f01.js";
import { buildF01App, type F01App } from "../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;
let prodApp: F01App;
let executions = 0;

const register: Parameters<typeof buildF01App>[1] = (instance, ctx) => {
  instance.post("/api/v1/__test/csrf", (_req, reply) => reply.status(204).send());
  instance.post("/internal/v1/__test/csrf", (_req, reply) => reply.status(204).send());
  instance.post("/api/v1/__test/cookie", (_req, reply) => {
    setSessionCookie(reply, ctx.config, "token-de-teste");
    return reply.status(204).send();
  });
  instance.post(
    "/api/v1/__test/idem",
    { schema: { body: Type.Object({ value: Type.String() }) } },
    (request, reply) =>
      withIdempotency(ctx, request, reply, { actor: "teste", operation: "teste" }, () => {
        executions += 1;
        return Promise.resolve({ status: 201, body: { execution: executions } });
      }),
  );
};

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env, register);
  prodApp = await buildF01App(env, register, { SPARK_ENV: "production" });
});
afterAll(async () => {
  await app?.close();
  await prodApp?.close();
  await env?.cleanup();
});

const sameOrigin = { "sec-fetch-site": "same-origin" };

describe("CSRF: verificação de origem em métodos inseguros (FR-015, R-05)", () => {
  it("recusa sem Sec-Fetch-Site e com Origin de outro site", async () => {
    for (const headers of [
      {},
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      const response = await app.app.inject({
        method: "POST",
        url: "/api/v1/__test/csrf",
        headers,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: "AUTH_CSRF_REJECTED" } });
    }
  });

  it("aceita Sec-Fetch-Site same-origin ou Origin igual a PUBLIC_ORIGIN", async () => {
    for (const headers of [sameOrigin, { origin: env.ctx.config.PUBLIC_ORIGIN }]) {
      const response = await app.app.inject({
        method: "POST",
        url: "/api/v1/__test/csrf",
        headers,
      });
      expect(response.statusCode).toBe(204);
    }
  });

  it("/internal/v1 não usa cookie e fica fora da regra", async () => {
    const response = await app.app.inject({ method: "POST", url: "/internal/v1/__test/csrf" });
    expect(response.statusCode).not.toBe(403);
  });
});

describe("cookie de sessão (FR-011, R-04)", () => {
  it("HttpOnly, SameSite=Strict, Path=/; sem Secure só em development", async () => {
    const dev = await app.app.inject({
      method: "POST",
      url: "/api/v1/__test/cookie",
      headers: sameOrigin,
    });
    const cookie = String(dev.headers["set-cookie"]);
    expect(cookie).toMatch(/^sparkcore_session=token-de-teste;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
    expect(cookie).not.toMatch(/Secure/);

    const prod = await prodApp.app.inject({
      method: "POST",
      url: "/api/v1/__test/cookie",
      headers: sameOrigin,
    });
    expect(String(prod.headers["set-cookie"])).toMatch(/Secure/);
  });
});

describe("idempotência (COM-026)", () => {
  const post = (key: string | undefined, value: string) =>
    app.app.inject({
      method: "POST",
      url: "/api/v1/__test/idem",
      headers: { ...sameOrigin, ...(key ? { "idempotency-key": key } : {}) },
      payload: { value },
    });

  it("mesma chave e mesmo corpo repetem a resposta sem executar de novo", async () => {
    const key = crypto.randomUUID();
    const first = await post(key, "a");
    const second = await post(key, "a");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(executions).toBe(1);
  });

  it("mesma chave com corpo diferente → 409 CONFLICT_IDEMPOTENCY_KEY_REUSED", async () => {
    const key = crypto.randomUUID();
    await post(key, "a");
    const conflict = await post(key, "b");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "CONFLICT_IDEMPOTENCY_KEY_REUSED" } });
  });

  it("sem chave ou chave inválida → 422", async () => {
    expect((await post(undefined, "a")).statusCode).toBe(422);
    expect((await post("nao-e-uuid", "a")).statusCode).toBe(422);
  });

  it("a resposta guardada fica cifrada (pode conter link exibido uma vez)", async () => {
    const key = crypto.randomUUID();
    await post(key, "a");
    const conn = await env.mysql.connect("test", env.databases.identity);
    const [rows] = await conn.query("SELECT response_enc FROM idempotency_record");
    for (const row of rows as { response_enc: Buffer }[]) {
      expect(row.response_enc.toString("utf8")).not.toContain("execution");
    }
  });
});
