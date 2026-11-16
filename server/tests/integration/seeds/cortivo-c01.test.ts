import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listAppCredentials } from "../../../src/modules/app-credentials/app-credentials.js";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { repoRoot } from "../../../src/platform/paths.js";
import { seedCortivoC01, CORTIVO_C01_INSTANCES } from "../../../seeds/cortivo-c01.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { spawnSync } from "node:child_process";
import { instanceDatabaseName, instanceUserName } from "../../../src/platform/ids.js";

let env: F01TestEnv;
let app: F01App;
let first: Awaited<ReturnType<typeof seedCortivoC01>>;
const password = "Senha-sintetica-C01-123!";
let testInstanceIds: string[];
let testInstances: (Omit<(typeof CORTIVO_C01_INSTANCES)[number], "id"> & { id: string })[];

beforeAll(async () => {
  env = await F01TestEnv.create();
  testInstanceIds = CORTIVO_C01_INSTANCES.map(() => newId());
  testInstances = CORTIVO_C01_INSTANCES.map((seed, index) => ({
    ...seed,
    id: testInstanceIds[index]!,
  }));
  for (const seed of testInstances) {
    const prefix = seed.productCode === "cortivo" ? "cortivo_" : "sparkpet_";
    const database = instanceDatabaseName(prefix, seed.id);
    env.mysql.trackInstanceDatabase(database);
    env.mysql.trackInstanceDatabase(`${database}_acc`);
    env.mysql.trackUser(instanceUserName(seed.id));
  }
  first = await seedCortivoC01(env.ctx, env.mysql.config, password, {
    instanceIds: testInstanceIds,
  });
  app = await buildF01App(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("preparação do ensaio Cortivo C01", () => {
  it("prepara instâncias, vínculos e credenciais idempotentemente", async () => {
    const second = await seedCortivoC01(env.ctx, env.mysql.config, password, {
      instanceIds: testInstanceIds,
    });

    expect(first.instances).toEqual([
      { slug: "cortivo-a", state: "ATIVA" },
      { slug: "cortivo-b", state: "ATIVA" },
      { slug: "tuteli-c01", state: "ATIVA" },
    ]);
    expect(first.accounts).toEqual({ created: 2, existing: 0 });
    expect(first.memberships).toEqual({ created: 4, existing: 0 });
    expect(
      first.credentials.map(({ slug, value, created }) => ({ slug, hasValue: !!value, created })),
    ).toEqual([
      { slug: "cortivo-a", hasValue: true, created: true },
      { slug: "cortivo-b", hasValue: true, created: true },
    ]);
    expect(second.accounts).toEqual({ created: 0, existing: 2 });
    expect(second.memberships).toEqual({ created: 0, existing: 4 });
    expect(second.credentials).toEqual([
      { slug: "cortivo-a", value: null, created: false },
      { slug: "cortivo-b", value: null, created: false },
    ]);

    const { rows: instanceRows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance
      WHERE id IN (${sql.join(testInstances.map(({ id }) => uuidToBin(id)))})`.execute(
      env.ctx.core,
    );
    expect(Number(instanceRows[0]?.n)).toBe(3);
    const credentials = await listAppCredentials(env.ctx);
    const cortivoCredentials = credentials.filter(
      ({ productCode, label, revokedAt }) =>
        productCode === "cortivo" && label.includes("Cortivo C01") && !revokedAt,
    );
    expect(cortivoCredentials).toHaveLength(2);
    for (const credential of cortivoCredentials) {
      expect(credential.instanceId).toBeTruthy();
      expect(credential.scopes.sort()).toEqual(["connection", "members", "sessions"]);
    }

    const { rows: links } = await sql<{
      email: string;
      instance_id: Buffer;
      role: string;
    }>`SELECT a.email_normalized AS email, m.instance_id, m.role
        FROM membership m JOIN account a ON a.id = m.account_id
       WHERE a.email_normalized IN ('cortivo-admin@example.test',
                                    'cortivo-colaborador@example.test')`.execute(env.ctx.identity);
    expect(links).toHaveLength(4);
    const linkedSlugs = links
      .map((row) => testInstances.find(({ id }) => uuidToBin(id).equals(row.instance_id))?.slug)
      .sort();
    expect(linkedSlugs).toEqual(["cortivo-a", "cortivo-a", "cortivo-b", "tuteli-c01"]);
    expect(
      links
        .filter((row) => row.email === "cortivo-admin@example.test")
        .map(({ role }) => role)
        .sort(),
    ).toEqual(["administrador", "administrador", "administrador"]);
    const appCredentialLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await seedCortivoC01(env.ctx, env.mysql.config, password, { instanceIds: testInstanceIds });
      expect(appCredentialLog).not.toHaveBeenCalled();
    } finally {
      appCredentialLog.mockRestore();
    }
    for (const seed of testInstances) {
      expect((await getInstance(env.ctx, seed.id))?.state).toBe("ATIVA");
    }
  });

  it.each(["homologation", "production"] as const)(
    "recusa a CLI em %s antes de acessar o banco",
    (environment) => {
      const windows = process.platform === "win32";
      const hardened = { MYSQL_TLS: "required", INSTANCE_DB_USER_HOST: "10.0.%" };
      const result = spawnSync(
        windows ? `npm run -s dev:prepare-cortivo-c01` : "npm",
        windows ? [] : ["run", "-s", "dev:prepare-cortivo-c01"],
        {
          cwd: repoRoot,
          env: { ...process.env, ...hardened, SPARK_ENV: environment },
          encoding: "utf8",
          shell: windows,
        },
      );
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).toMatch(/env_guard_refused/);
      expect(result.stdout + result.stderr).toMatch(/marker":"não consultado"/);
    },
  );

  it("responde igual para cortivo-b e para uma instância inexistente", async () => {
    const credentialA = first.credentials.find(({ slug }) => slug === "cortivo-a")?.value;
    expect(credentialA).toBeTruthy();
    const auth = { authorization: `Bearer ${credentialA}` };
    const requests = [
      { method: "GET" as const, url: "/internal/v1/instances/cortivo-b/connection" },
      { method: "GET" as const, url: "/internal/v1/instances/inexistente/connection" },
      {
        method: "POST" as const,
        url: "/internal/v1/instances/cortivo-b/sessions",
        payload: {
          email: "cortivo-admin@example.test",
          password,
          clientIp: "198.51.100.40",
        },
      },
      {
        method: "POST" as const,
        url: "/internal/v1/instances/inexistente/sessions",
        payload: {
          email: "cortivo-admin@example.test",
          password,
          clientIp: "198.51.100.40",
        },
      },
      {
        method: "GET" as const,
        url: "/internal/v1/instances/cortivo-b/members",
        headers: { "x-instance-session": "invalid" },
      },
      {
        method: "GET" as const,
        url: "/internal/v1/instances/inexistente/members",
        headers: { "x-instance-session": "invalid" },
      },
    ];
    const responses: Awaited<ReturnType<typeof app.app.inject>>[] = [];
    for (const request of requests) {
      responses.push(
        await app.app.inject({
          ...request,
          headers: { ...auth, ...request.headers },
        }),
      );
    }
    const normalizeError = (response: Awaited<ReturnType<typeof app.app.inject>>) => {
      const body = response.json<{ error?: Record<string, unknown> }>();
      if (body.error) delete body.error.correlationId;
      return body;
    };
    for (let index = 0; index < responses.length; index += 2) {
      expect(responses[index]?.statusCode).toBe(responses[index + 1]?.statusCode);
      expect(normalizeError(responses[index]!)).toEqual(normalizeError(responses[index + 1]!));
    }
    expect(app.raw.join("\n")).not.toContain(credentialA);
    expect(app.raw.join("\n")).not.toContain(password);
  });

  it("atividade de sessão também não distingue outra instância da inexistente", async () => {
    const credentialA = first.credentials.find(({ slug }) => slug === "cortivo-a")?.value;
    if (!credentialA) throw new Error("Semente C01 não emitiu credencial de cortivo-a");
    const invalidSession = (slug: string) =>
      app.app.inject({
        method: "POST",
        url: `/internal/v1/instances/${slug}/sessions/touch`,
        headers: {
          authorization: `Bearer ${credentialA}`,
          "x-instance-session": "invalid",
        },
      });
    const other = await invalidSession("cortivo-b");
    const missing = await invalidSession("inexistente");
    expect(other.statusCode).toBe(missing.statusCode);
    const normalizeError = (response: typeof other) => {
      const body = response.json<{ error?: Record<string, unknown> }>();
      if (body.error) delete body.error.correlationId;
      return body;
    };
    expect(normalizeError(other)).toEqual(normalizeError(missing));
    expect(credentialA).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
  });
});
