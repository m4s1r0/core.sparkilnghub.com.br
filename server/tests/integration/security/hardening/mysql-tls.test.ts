import { createConnection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance, type Instance } from "../../../../src/modules/instances/instances.js";
import { getResource, resourceSecret } from "../../../../src/modules/provisioning/resources.js";
import { F01TestEnv } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../../../support/f02.js";
import { appCredential } from "../../../support/product.js";

/**
 * SEC-15 / SEC-BASE-15: com TLS ligado (obrigatório fora do desenvolvimento), a credencial
 * operacional criada pelo provisionador exige TLS; o Core fala TLS com o MySQL e o contrato de
 * conexão avisa o produto.
 */
let env: F01TestEnv;
let app: F01App;
let instance: Instance;
let secret: { user: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  const tlsConfig = { ...env.mysql.config, MYSQL_TLS: "required" as const };
  app = await buildF01App(env, undefined, { MYSQL_TLS: "required" });
  const { instanceId, taskId } = await requestViaService(env, await requester(env));
  expect(await runProvisioning(env, taskId, { config: tlsConfig })).toBe("concluida");
  const found = await getInstance(env.ctx, instanceId);
  if (!found) throw new Error("instância");
  instance = found;
  const user = await getResource(env.ctx.core, instance.id, "usuario_mysql");
  if (!user) throw new Error("credencial");
  secret = { user: user.identifier, password: resourceSecret(env.ctx, instance.id, user) };
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const connect = (ssl: boolean) =>
  createConnection({
    host: env.mysql.config.MYSQL_HOST,
    port: env.mysql.config.MYSQL_PORT,
    user: secret.user,
    password: secret.password,
    database: instance.databaseName,
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });

describe("SEC-15 — credencial operacional exige TLS", () => {
  it("conexão sem TLS é recusada; com TLS funciona", async () => {
    await expect(connect(false)).rejects.toSatisfy((error) =>
      /ACCESS_DENIED/.test(String((error as { code?: string }).code)),
    );
    const secure = await connect(true);
    try {
      const [rows] = await secure.query("SHOW STATUS LIKE 'Ssl_cipher'");
      expect((rows as { Value: string }[])[0]?.Value).not.toBe("");
    } finally {
      await secure.end();
    }
  });

  it("/connection informa tls: required ao produto", async () => {
    const credential = await appCredential(env, "sparkref", ["connection"], instance.id);
    const response = await app.app.inject({
      method: "GET",
      url: `/internal/v1/instances/${instance.slug}/connection`,
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ tls: string }>().tls).toBe("required");
  });
});
