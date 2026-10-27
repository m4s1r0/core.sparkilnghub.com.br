import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeAppCredential } from "../../../src/modules/app-credentials/app-credentials.js";
import { sha256Hex } from "../../../src/platform/crypto/index.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let b: TestInstance;
let credential: string;
let ana: { id: string; email: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
  credential = await appCredential(env);
  ana = await env.insertAccount({ email: "ana@example.test", displayName: "[SINTÉTICO] Ana" });
  await env.insertMembership(ana.id, a.id, "administrador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const login = (slug: string, body: Record<string, unknown>, bearer: string | null = credential) =>
  app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${slug}/sessions`,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    payload: body,
  });

const checked = (
  response: Awaited<ReturnType<typeof login>>,
  operation = "createInstanceSession",
) => {
  expectMatchesContract(operation, response.statusCode, bodyOf(response));
  return Promise.resolve(response);
};

const sessionsIn = async (instance: TestInstance) => {
  const { rows } = await sql<{ id_hash: string }>`SELECT id_hash FROM access_session`.execute(
    env.ctx.access(instance.accessDatabaseName),
  );
  return rows.map((r) => r.id_hash);
};

describe("login de produto pelo Core (US3, FR-012, FR-024)", () => {
  it("cria sessão só no banco de acesso de A e devolve o contexto mínimo", async () => {
    const response = await checked(
      await login("ref-a", { email: ana.email, password: ana.password, clientIp: "198.51.100.1" }),
    );
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      token: string;
      expiresAt: string;
      idleTimeoutSeconds: number;
      account: { id: string; displayName: string };
      role: string;
    }>();
    expect(body.idleTimeoutSeconds).toBe(7200);
    expect(new Date(body.expiresAt).getTime() - env.clock.now().getTime()).toBe(12 * 3600_000);
    expect(body.account).toEqual({ id: ana.id, displayName: "[SINTÉTICO] Ana" });
    expect(body.role).toBe("administrador");
    expect(await sessionsIn(a)).toContain(sha256Hex(body.token));
    expect(await sessionsIn(b)).not.toContain(sha256Hex(body.token));
  });

  it("sem vínculo, senha errada, conta bloqueada e outro produto: mesma resposta 401", async () => {
    const blocked = await env.insertAccount({ status: "bloqueada" });
    await env.insertMembership(blocked.id, a.id, "colaborador");
    const otherProduct = await appCredential(env, "outroproduto");
    const responses = [
      await login("ref-b", { email: ana.email, password: ana.password, clientIp: "198.51.100.2" }),
      await login("ref-a", {
        email: ana.email,
        password: "senha errada",
        clientIp: "198.51.100.2",
      }),
      await login("ref-a", {
        email: "ninguem@example.test",
        password: "x",
        clientIp: "198.51.100.2",
      }),
      await login("ref-a", {
        email: blocked.email,
        password: blocked.password,
        clientIp: "198.51.100.2",
      }),
      await login(
        "ref-a",
        { email: ana.email, password: ana.password, clientIp: "198.51.100.2" },
        otherProduct,
      ),
    ];
    for (const response of responses) {
      await checked(response);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: "AUTH_INVALID_CREDENTIALS" } });
    }
  });

  it("credencial ausente, malformada, revogada ou sem escopo → 401", async () => {
    const membersOnly = await appCredential(env, "sparkref", ["members"]);
    const revoked = await appCredential(env);
    await revokeAppCredential(env.ctx, revoked.split(".")[0] ?? "");
    for (const bearer of [null, "lixo", revoked, membersOnly]) {
      const response = await login(
        "ref-a",
        { email: ana.email, password: ana.password, clientIp: "198.51.100.3" },
        bearer,
      );
      expect(response.statusCode).toBe(401);
    }
  });

  it("clientIp é obrigatório (422)", async () => {
    const response = await login("ref-a", { email: ana.email, password: ana.password });
    expect(response.statusCode).toBe(422);
  });

  it("touch: atividade gravada no máximo a cada 5 min; sessão inválida → 401", async () => {
    const created = (
      await login("ref-a", { email: ana.email, password: ana.password, clientIp: "198.51.100.4" })
    ).json<{ token: string }>();
    const touch = (token: string) =>
      app.app.inject({
        method: "POST",
        url: "/internal/v1/instances/ref-a/sessions/touch",
        headers: { authorization: `Bearer ${credential}`, "x-instance-session": token },
      });
    const lastSeen = async () => {
      const { rows } = await sql<{ last_seen_at: Date }>`SELECT last_seen_at FROM access_session
         WHERE id_hash = ${sha256Hex(created.token)}`.execute(env.ctx.access(a.accessDatabaseName));
      return rows[0]?.last_seen_at.getTime();
    };
    const start = await lastSeen();
    env.clock.advance(60_000);
    await checked(await touch(created.token), "touchInstanceSession");
    expect(await lastSeen()).toBe(start);
    env.clock.advance(5 * 60_000);
    expect((await touch(created.token)).statusCode).toBe(204);
    expect(await lastSeen()).toBe(env.clock.now().getTime());
    const invalid = await checked(await touch("x".repeat(43)), "touchInstanceSession");
    expect(invalid.statusCode).toBe(401);
  });

  it("50 falhas de um clientIp bloqueiam só ele; 10 falhas da conta bloqueiam a conta", async () => {
    for (let i = 0; i < 50; i += 1) {
      await login("ref-a", {
        email: `x${i}@example.test`,
        password: "errada",
        clientIp: "203.0.113.10",
      });
    }
    const fromX = await login("ref-a", {
      email: ana.email,
      password: ana.password,
      clientIp: "203.0.113.10",
    });
    expect(fromX.statusCode).toBe(429);
    expect(Number(fromX.headers["retry-after"])).toBeGreaterThan(0);
    const fromY = await login("ref-a", {
      email: ana.email,
      password: ana.password,
      clientIp: "203.0.113.11",
    });
    expect(fromY.statusCode).toBe(201);

    const carla = await env.insertAccount();
    await env.insertMembership(carla.id, a.id, "colaborador");
    for (let i = 0; i < 10; i += 1) {
      await login("ref-a", { email: carla.email, password: "errada", clientIp: `192.0.2.${i}` });
    }
    const locked = await checked(
      await login("ref-a", {
        email: carla.email,
        password: carla.password,
        clientIp: "192.0.2.99",
      }),
    );
    expect(locked.statusCode).toBe(429);
  });

  it("evento de segurança do login de produto, com a instância e sem senha", async () => {
    const { rows } = await sql<{ result: string; instance_id: Buffer | null; detail: unknown }>`
      SELECT result, instance_id, detail FROM security_event WHERE type = 'login_produto'`.execute(
      env.ctx.identity,
    );
    expect(rows.some((r) => r.result === "sucesso" && r.instance_id?.equals(uuidToBin(a.id)))).toBe(
      true,
    );
    expect(JSON.stringify(rows)).not.toContain(ana.password);
  });
});
