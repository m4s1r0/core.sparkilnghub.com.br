import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDueJobs } from "../../../src/worker/jobs/access-sync.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
let a: TestInstance;
let b: TestInstance;
let carla: { id: string };

beforeAll(async () => {
  env = await F01TestEnv.create();
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
  carla = await env.insertAccount();
  await env.insertMembership(carla.id, a.id, "colaborador");
  await env.insertMembership(carla.id, b.id, "colaborador");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("revogação com instância inacessível (FR-027, R-10)", () => {
  it("bloqueio: A aplicada, B pendente; pendência listada até o trabalhador concluir", async () => {
    await env.setWriterAccess(b, false);
    try {
      // App com pools novos: privilégio revogado só vale para conexões abertas depois.
      app = await buildF01App(env, undefined, {}, env.freshContext());
      flow = new AuthFlow(env, app);
      admin = await flow.admin("plataforma@example.test");
      const blocked = await flow.request("POST", `/api/v1/accounts/${carla.id}/block`, {
        cookie: admin.cookie,
        payload: { reason: "incidente com B fora" },
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      expectMatchesContract("blockAccount", blocked.statusCode, bodyOf(blocked));
      expect(blocked.json<{ instances: unknown[] }>().instances).toEqual(
        expect.arrayContaining([
          { instanceId: a.id, status: "aplicada" },
          { instanceId: b.id, status: "pendente" },
        ]),
      );
      const pending = await flow.request("GET", "/api/v1/access-sync/pending", {
        cookie: admin.cookie,
      });
      expectMatchesContract("listPendingAccessSync", pending.statusCode, bodyOf(pending));
      expect(
        pending.json<{ items: { instanceId: string; instanceName: string }[] }>().items,
      ).toEqual([expect.objectContaining({ instanceId: b.id, instanceName: b.displayName })]);
    } finally {
      await env.setWriterAccess(b, true);
    }

    env.clock.advance(60_000);
    expect(await processDueJobs(env.freshContext())).toBe(1);
    const after = await flow.request("GET", "/api/v1/access-sync/pending", {
      cookie: admin.cookie,
    });
    expect(after.json<{ items: unknown[] }>().items).toEqual([]);
  });
});
