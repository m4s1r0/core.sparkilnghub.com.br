import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueSyncJob } from "../../../src/modules/access-projection/sync.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { processDueJobs } from "../../../src/worker/jobs/access-sync.js";
import type { ReferenceProductClient } from "../../../reference-product/client.js";
import { AuthFlow } from "../../support/auth-flow.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let b: TestInstance;
let productA: ReferenceProductClient;
let productB: ReferenceProductClient;
let carla: { id: string; email: string; password: string };
let credential: string;

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy((error) =>
    /ACCESS_DENIED|ER_TABLEACCESS_DENIED|ER_COLUMNACCESS_DENIED/.test(
      String((error as { code?: string }).code),
    ),
  );

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
  credential = await appCredential(env);
  productA = await productFor(env, app, a, credential);
  productB = await productFor(env, app, b, credential);
  carla = await env.insertAccount();
  await env.insertMembership(carla.id, a.id, "colaborador");
  await env.insertMembership(carla.id, b.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

async function tokenIn(product: ReferenceProductClient, ip = "198.51.100.20"): Promise<string> {
  const response = await product.login(carla.email, carla.password, ip);
  if (response.status !== 201) throw new Error(`login ${response.status}`);
  return (response.body as { token: string }).token;
}

describe("isolamento entre instâncias (T-04, NFR-008, CS-002)", () => {
  it("token de A validado em B é inválido; cada contexto exige a própria sessão", async () => {
    const token = await tokenIn(productA);
    expect(await productA.validate(token, env.clock.now())).not.toBeNull();
    expect(await productB.validate(token, env.clock.now())).toBeNull();
    const tokenB = await tokenIn(productB);
    expect(await productA.validate(tokenB, env.clock.now())).toBeNull();
  });

  it("campos de usuário, papel ou instância no corpo são recusados; cabeçalhos não mudam o alvo", async () => {
    const extra = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${a.slug}/sessions`,
      headers: { authorization: `Bearer ${credential}` },
      payload: {
        email: carla.email,
        password: carla.password,
        clientIp: "198.51.100.21",
        role: "administrador",
        instanceId: b.id,
      },
    });
    expect(extra.statusCode).toBe(422);

    const before = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_session`.execute(
      env.ctx.access(b.accessDatabaseName),
    );
    const viaHeader = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${a.slug}/sessions`,
      headers: {
        authorization: `Bearer ${credential}`,
        "x-instance-slug": b.slug,
        "x-instance-id": b.id,
      },
      payload: { email: carla.email, password: carla.password, clientIp: "198.51.100.21" },
    });
    expect(viaHeader.statusCode).toBe(201);
    const token = viaHeader.json<{ token: string }>().token;
    expect(await productB.validate(token, env.clock.now())).toBeNull();
    const after = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_session`.execute(
      env.ctx.access(b.accessDatabaseName),
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n));
  });

  it("sessão do Core não autentica /internal/v1 e token de produto não autentica /api/v1", async () => {
    const flow = new AuthFlow(env, app);
    const admin = await flow.admin("admin@example.test");
    const internal = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${a.slug}/sessions/touch`,
      headers: { cookie: `sparkcore_session=${admin.cookie}`, "x-instance-session": admin.cookie },
    });
    expect(internal.statusCode).toBe(401);

    const productToken = await tokenIn(productA);
    const panel = await app.app.inject({
      method: "GET",
      url: "/api/v1/session",
      headers: {
        cookie: `sparkcore_session=${productToken}`,
        authorization: `Bearer ${credential}`,
      },
    });
    expect(panel.statusCode).toBe(401);
  });

  it("administrador da plataforma não obtém sessão de produto (FR-035)", async () => {
    const admin = await env.insertAccount();
    await env.insertMembership(admin.id, a.id, "administrador");
    await sql`INSERT INTO platform_role (account_id, role, status, granted_at, changed_at)
              VALUES (${uuidToBin(admin.id)}, 'administrador', 'ativo', ${env.clock.now()},
                      ${env.clock.now()})`.execute(env.ctx.identity);
    const response = await productA.login(admin.email, admin.password, "198.51.100.22");
    expect(response.status).toBe(401);
  });

  it("usuário da instância não cria sessão nem desfaz revogação ou logout", async () => {
    const token = await tokenIn(productA);
    await denied(
      productA.access.query(
        `INSERT INTO access_session (id_hash, account_id, membership_id, created_at, last_seen_at,
           expires_at, idle_timeout_seconds, auth_revision)
         SELECT REPEAT('d', 64), account_id, membership_id, created_at, last_seen_at,
                expires_at, idle_timeout_seconds, auth_revision FROM access_session LIMIT 1`,
      ),
    );
    await denied(productA.access.query("UPDATE access_session SET ended_at = NULL"));
    await denied(productA.access.query("UPDATE access_member SET status = 'ativo'"));

    await productA.logout(token);
    expect(await productA.validate(token, env.clock.now())).toBeNull();
    await denied(productA.access.query("DELETE FROM access_session_logout"));
    expect(await productA.validate(token, env.clock.now())).toBeNull();
  });

  it("inatividade acima de 2 h e prazo absoluto vencido invalidam a sessão", async () => {
    const token = await tokenIn(productA);
    const now = env.clock.now().getTime();
    expect(await productA.validate(token, new Date(now + 119 * 60_000))).not.toBeNull();
    expect(await productA.validate(token, new Date(now + 121 * 60_000))).toBeNull();
    expect(await productA.validate(token, new Date(now + 12 * 3600_000 + 1))).toBeNull();
  });

  it("tarefa de sincronização de A não altera B; conexões de A nunca servem B", async () => {
    const snapshot = async () =>
      JSON.stringify(
        (
          await sql`SELECT * FROM access_member ORDER BY membership_id`.execute(
            env.ctx.access(b.accessDatabaseName),
          )
        ).rows,
      );
    const before = await snapshot();
    const dora = await env.insertAccount();
    const membershipId = await env.insertMembership(dora.id, a.id, "colaborador");
    await enqueueSyncJob(env.ctx, a.id, "replicar_vinculo", { membershipId });
    await processDueJobs(env.ctx);
    expect(await snapshot()).toBe(before);
    for (let i = 0; i < 50; i += 1) {
      const instance = i % 2 ? a : b;
      const { rows } = await sql<{ db: string }>`SELECT DATABASE() AS db`.execute(
        env.ctx.access(instance.accessDatabaseName),
      );
      expect(rows[0]?.db).toBe(instance.accessDatabaseName);
    }
  });
});
