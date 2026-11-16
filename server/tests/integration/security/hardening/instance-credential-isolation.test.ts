import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../../src/modules/instances/instances.js";
import { uuidToBin } from "../../../../src/platform/ids.js";
import { F01TestEnv, type TestInstance } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../../../support/f02.js";
import { appCredential } from "../../../support/product.js";

/**
 * SEC-01 / SEC-BASE-01 (crítica): a credencial de aplicação vale só para a instância a que está
 * vinculada. Pedido com o slug de outra instância do mesmo produto recebe resposta idêntica à de
 * instância inexistente e grava evento de segurança. Faz parte do gate (`npm run verify`).
 */
let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let b: TestInstance;
let credA: string;
let ana: { id: string; email: string; password: string };
let tokenB: string;
const ready: { slug: string; id: string }[] = [];

const ALL = ["sessions", "members", "connection"] as const;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("iso-a");
  b = await env.createInstance("iso-b");
  credA = await appCredential(env, "sparkref", [...ALL], a.id);
  ana = await env.insertAccount();
  await env.insertMembership(ana.id, a.id, "administrador");
  await env.insertMembership(ana.id, b.id, "administrador");
  const credB = await appCredential(env, "sparkref", [...ALL], b.id);
  const login = await call("POST", b.slug, "/sessions", credB, {
    payload: { email: ana.email, password: ana.password, clientIp: "198.51.100.30" },
  });
  expect(login.statusCode).toBe(201);
  tokenB = login.json<{ token: string }>().token;
  // Instâncias provisionadas (F02) têm a credencial operacional registrada: /connection responde.
  const accountId = await requester(env);
  for (let i = 0; i < 2; i += 1) {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId)).toBe("concluida");
    const instance = await getInstance(env.ctx, instanceId);
    if (!instance) throw new Error("instância");
    ready.push({ slug: instance.slug, id: instance.id });
  }
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

function call(
  method: "GET" | "POST",
  slug: string,
  path: string,
  credential: string,
  options: { payload?: object; session?: string } = {},
) {
  return app.app.inject({
    method,
    url: `/internal/v1/instances/${slug}${path}`,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(options.session ? { "x-instance-session": options.session } : {}),
    },
    ...(options.payload ? { payload: options.payload } : {}),
  });
}

type Response = Awaited<ReturnType<typeof call>>;

/** Status e erro sem o identificador de correlação (único por requisição). */
const shape = (response: Response) => {
  const body = response.json<{ error: Record<string, unknown> }>();
  return { status: response.statusCode, error: { ...body.error, correlationId: null } };
};

async function eventsFor(instanceId: string): Promise<{ type: string; result: string }[]> {
  const { rows } = await sql<{ type: string; result: string }>`
    SELECT type, result FROM security_event
     WHERE type = 'instancia_divergente' AND instance_id = ${uuidToBin(instanceId)}`.execute(
    env.ctx.identity,
  );
  return rows;
}

describe("SEC-01 — credencial vinculada à instância", () => {
  it("/connection de B com a credencial de A ≡ inexistente; nenhuma senha; evento", async () => {
    const [ownConn, otherConn] = ready;
    if (!ownConn || !otherConn) throw new Error("instâncias");
    const credOwn = await appCredential(env, "sparkref", ["connection"], ownConn.id);
    expect((await call("GET", ownConn.slug, "/connection", credOwn)).statusCode).toBe(200);
    const foreign = await call("GET", otherConn.slug, "/connection", credOwn);
    const missing = await call("GET", "nao-existe-1", "/connection", credOwn);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain("password");
    expect(shape(foreign)).toEqual(shape(missing));
    expect(await eventsFor(otherConn.id)).toEqual([
      { type: "instancia_divergente", result: "negado" },
    ]);
  });

  it("instância ENCERRADA: /connection da própria credencial ≡ inexistente (F03 FR-026)", async () => {
    const { instanceId, taskId } = await requestViaService(env, await requester(env));
    expect(await runProvisioning(env, taskId)).toBe("concluida");
    const closed = await getInstance(env.ctx, instanceId);
    if (!closed) throw new Error("instância");
    const cred = await appCredential(env, "sparkref", ["connection"], closed.id);
    await sql`UPDATE instance SET state = 'ENCERRADA' WHERE id = ${uuidToBin(closed.id)}`.execute(
      env.ctx.core,
    );
    const response = await call("GET", closed.slug, "/connection", cred);
    const missing = await call("GET", "nao-existe-4", "/connection", cred);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("password");
    expect(shape(response)).toEqual(shape(missing));
  });

  it("/sessions em B com a credencial de A ≡ inexistente e nenhuma sessão é criada", async () => {
    const before = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_session`.execute(
      env.ctx.access(b.accessDatabaseName),
    );
    const body = { email: ana.email, password: ana.password, clientIp: "198.51.100.31" };
    const foreign = await call("POST", b.slug, "/sessions", credA, { payload: body });
    const missing = await call("POST", "nao-existe-2", "/sessions", credA, { payload: body });
    expect(foreign.statusCode).toBe(401);
    expect(shape(foreign)).toEqual(shape(missing));
    const after = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_session`.execute(
      env.ctx.access(b.accessDatabaseName),
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n));
    expect((await eventsFor(b.id)).length).toBeGreaterThanOrEqual(1);
    // A própria instância continua funcionando com a mesma credencial.
    const own = await call("POST", a.slug, "/sessions", credA, { payload: body });
    expect(own.statusCode).toBe(201);
  });

  it("/sessions/touch e /members de B com sessão válida de B e credencial de A ≡ inexistente", async () => {
    for (const [method, path] of [
      ["POST", "/sessions/touch"],
      ["GET", "/members"],
    ] as const) {
      const foreign = await call(method, b.slug, path, credA, { session: tokenB });
      const missing = await call(method, "nao-existe-3", path, credA, { session: tokenB });
      expect(foreign.statusCode).toBe(401);
      expect(shape(foreign)).toEqual(shape(missing));
    }
  });

  it("credencial por produto (sem instância) é recusada nos escopos de instância", async () => {
    const legacy = await appCredential(env, "sparkref", [...ALL], null);
    const response = await call("POST", a.slug, "/sessions/touch", legacy, { session: tokenB });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_APP_CREDENTIAL_INVALID",
    );
    const { rows } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM security_event
       WHERE type = 'credencial_aplicacao' AND result = 'negado'`.execute(env.ctx.identity);
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
