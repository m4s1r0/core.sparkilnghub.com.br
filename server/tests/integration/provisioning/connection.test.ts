import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchInstanceConnection,
  type InstanceConnection,
  openInstancePools,
} from "../../../reference-product/client.js";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../../support/f02.js";
import { appCredential } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let credential: string;
const ready: { slug: string; id: string }[] = [];

const http = (request: { method: "GET" | "POST"; url: string; headers: Record<string, string> }) =>
  app.app
    .inject({ method: request.method, url: request.url, headers: request.headers })
    .then((response) => ({
      status: response.statusCode,
      body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
      headers: response.headers as Record<string, string | string[] | undefined>,
    }));

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env, undefined, {
    INSTANCE_DB_HOST: "db.interno.test",
    INSTANCE_DB_PORT: 3399,
  });
  credential = await appCredential(env, "sparkref", ["sessions", "members", "connection"]);
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

const get = (slug: string, bearer: string | null = credential) =>
  app.app.inject({
    method: "GET",
    url: `/internal/v1/instances/${slug}/connection`,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("contrato interno de conexão da instância (FR-031, research.md R-10)", () => {
  it("entrega a conexão ao produto dono, sem cache, com o endereço configurado", async () => {
    const [a] = ready;
    if (!a) throw new Error("A");
    const response = await get(a.slug);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.json<InstanceConnection>();
    expect(body).toMatchObject({
      instanceId: a.id,
      state: "PRONTA",
      host: "db.interno.test",
      port: 3399,
      database: `sparkref_${a.id.replaceAll("-", "")}`,
      accessDatabase: `sparkref_${a.id.replaceAll("-", "")}_acc`,
    });
    expect(body.password.length).toBeGreaterThanOrEqual(40);
    const logs = app.raw.join("\n");
    expect(logs).not.toContain(body.password);
    const { rows } = await sql<{ type: string; detail: string | null }>`
      SELECT type, CAST(detail AS CHAR) AS detail FROM security_event
       WHERE type = 'conexao_entregue' AND instance_id = ${uuidToBin(a.id)}`.execute(
      env.ctx.identity,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail ?? "").not.toContain(body.password);
  });

  it("sem escopo connection → 401; outro produto e slug inexistente → 404 idêntico", async () => {
    const [a] = ready;
    if (!a) throw new Error("A");
    const withoutScope = await appCredential(env, "sparkref", ["sessions", "members"]);
    const noScope = await get(a.slug, withoutScope);
    expect(noScope.statusCode).toBe(401);
    expect(noScope.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_APP_CREDENTIAL_INVALID",
    );
    const other = await appCredential(env, "outroproduto", ["connection"]);
    const foreign = await get(a.slug, other);
    const missing = await get("nao-existe");
    expect(foreign.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    const strip = (r: typeof foreign) => {
      const body = r.json<{ error: Record<string, unknown> }>();
      return { ...body.error, correlationId: null };
    };
    expect(strip(foreign)).toEqual(strip(missing));
  });

  it("instância ainda sem recursos prontos → 409 INSTANCE_NOT_READY", async () => {
    const { instanceId } = await requestViaService(env, await requester(env));
    const instance = await getInstance(env.ctx, instanceId);
    for (const state of ["CADASTRADA", "PROVISIONANDO", "FALHA_PROVISIONAMENTO"]) {
      await sql`UPDATE instance SET state = ${state} WHERE id = ${uuidToBin(instanceId)}`.execute(
        env.ctx.core,
      );
      const response = await get(instance?.slug ?? "");
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: { code: string } }>().error.code).toBe("INSTANCE_NOT_READY");
    }
  });

  it("cliente de referência: um pool por instância; 200 aquisições alternadas A/B (T-04)", async () => {
    const [a, b] = ready;
    if (!a || !b) throw new Error("A/B");
    const pools = await Promise.all(
      [a, b].map(async (item) => {
        const connection = await fetchInstanceConnection(http, credential, item.slug);
        // O host entregue aos produtos é configurável; o teste usa o MySQL local.
        return {
          item,
          pools: openInstancePools({
            ...connection,
            host: env.mysql.config.MYSQL_HOST,
            port: env.mysql.config.MYSQL_PORT,
          }),
        };
      }),
    );
    try {
      for (let i = 0; i < 200; i += 1) {
        const { item, pools: current } = pools[i % 2] ?? pools[0]!;
        const [rows] = await current.operational.query(
          "SELECT DATABASE() AS db, HEX(instance_uuid) AS id FROM _spark_instance",
        );
        expect(rows).toEqual([
          {
            db: `sparkref_${item.id.replaceAll("-", "")}`,
            id: item.id.replaceAll("-", "").toUpperCase(),
          },
        ]);
      }
    } finally {
      for (const { pools: p } of pools) await p.end();
    }
  });
});
