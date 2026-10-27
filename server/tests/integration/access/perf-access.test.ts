import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../../../src/platform/paths.js";
import type { ReferenceProductClient } from "../../../reference-product/client.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let product: ReferenceProductClient;
let account: { id: string; email: string; password: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  const a = await env.createInstance("ref-a");
  product = await productFor(env, app, a, await appCredential(env));
  account = await env.insertAccount();
  await env.insertMembership(account.id, a.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const p95 = (samples: number[]) => {
  const sorted = [...samples].sort((x, y) => x - y);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
};

describe("desempenho do acesso de produto (CS-006, R-14)", () => {
  it("validação local p95 ≤ 10 ms e login de produto p95 ≤ 1 s", async () => {
    const logins: number[] = [];
    let token = "";
    for (let i = 0; i < 50; i += 1) {
      const started = performance.now();
      const response = await product.login(account.email, account.password, `198.51.100.${i}`);
      logins.push(performance.now() - started);
      expect(response.status).toBe(201);
      token = (response.body as { token: string }).token;
    }
    const validations: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      expect(await product.validate(token, env.clock.now())).not.toBeNull();
      validations.push(performance.now() - started);
    }
    const result = {
      medidoEm: new Date().toISOString(),
      validacaoP95Ms: Number(p95(validations).toFixed(2)),
      loginProdutoP95Ms: Number(p95(logins).toFixed(2)),
      amostras: { validacoes: validations.length, logins: logins.length },
    };
    const dir = join(repoRoot, "test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "perf-access.json"), `${JSON.stringify(result, null, 2)}\n`);
    expect(result.validacaoP95Ms).toBeLessThanOrEqual(10);
    expect(result.loginProdutoP95Ms).toBeLessThanOrEqual(1000);
  });
});
