import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoRoot } from "../../../src/platform/paths.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, runProvisioning } from "../../support/f02.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

const p95 = (samples: number[]) => {
  const sorted = [...samples].sort((x, y) => x - y);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;
};

const ROUNDS = 20;

describe("tempo até PRONTA (CS-002)", () => {
  it(`${ROUNDS} provisionamentos sequenciais do produto de referência: p95 ≤ 2 min`, async () => {
    const accountId = await requester(env);
    const durations: number[] = [];
    for (let i = 0; i < ROUNDS; i += 1) {
      const started = performance.now();
      const { taskId } = await requestViaService(env, accountId);
      expect(await runProvisioning(env, taskId)).toBe("concluida");
      durations.push(performance.now() - started);
    }
    const result = {
      medidoEm: new Date().toISOString(),
      provisionamentoP95Ms: Math.round(p95(durations)),
      provisionamentoMedianaMs: Math.round([...durations].sort((a, b) => a - b)[ROUNDS / 2] ?? 0),
      amostras: durations.length,
    };
    const dir = join(repoRoot, "test-results");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "perf-provisioning.json"), `${JSON.stringify(result, null, 2)}\n`);
    expect(result.provisionamentoP95Ms).toBeLessThanOrEqual(120_000);
  }, 600_000);
});
