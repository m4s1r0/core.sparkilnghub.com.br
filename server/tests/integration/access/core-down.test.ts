import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app/build-app.js";
import { registerModules } from "../../../src/app/modules.js";
import { createAppContext } from "../../../src/platform/context.js";
import { PoolRegistry } from "../../../src/platform/db/pools.js";
import { createLogger } from "../../../src/platform/logging/logger.js";
import type { ReferenceProductClient } from "../../../reference-product/client.js";
import { fixedStatusService, healthyStatus } from "../../support/app.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let product: ReferenceProductClient;
let account: { email: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("ref-a");
  const credential = await appCredential(env);
  product = await productFor(env, app, a, credential);
  const created = await env.insertAccount();
  account = created;
  await env.insertMembership(created.id, a.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("Core indisponível (T-15, FR-028, CS-009)", () => {
  it("sessões existentes seguem válidas no produto; login novo recebe 503 explícito", async () => {
    const tokens: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await product.login(account.email, account.password, "198.51.100.30");
      tokens.push((response.body as { token: string }).token);
    }

    // Core sem banco de identidade: mesma configuração com a porta do MySQL fechada.
    const down = { ...env.ctx.config, MYSQL_PORT: 1 };
    const pools = new PoolRegistry(down);
    const ctx = createAppContext(down, pools, {
      identityDatabase: env.databases.identity,
      coreDatabase: env.databases.core,
      role: "test",
      clock: env.clock.now,
      logger: createLogger({ level: "silent" }),
    });
    const downApp = await buildApp({
      config: down,
      logger: createLogger({ level: "silent" }),
      register: (instance) =>
        registerModules(instance, {
          config: down,
          pools,
          ctx,
          statusService: fixedStatusService(healthyStatus()),
        }),
    });
    try {
      const login = await downApp.inject({
        method: "POST",
        url: `/internal/v1/instances/${a.slug}/sessions`,
        headers: { authorization: `Bearer ${await appCredential(env)}` },
        payload: { email: account.email, password: account.password, clientIp: "198.51.100.31" },
      });
      expect(login.statusCode).toBe(503);
      expect(login.json()).toMatchObject({
        error: { code: "SYSTEM_IDENTITY_UNAVAILABLE", retryable: true },
      });
      expect(Number(login.headers["retry-after"])).toBeGreaterThan(0);

      for (const token of tokens) {
        expect(await product.validate(token, env.clock.now())).not.toBeNull();
      }
    } finally {
      await downApp.close();
      await pools.closeAll();
    }
  });
});
