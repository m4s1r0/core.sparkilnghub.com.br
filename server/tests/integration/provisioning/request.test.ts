import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidToBin } from "../../../src/platform/ids.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, TEST_CONTRACTOR_ID } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requestBody, stepRuns, trackInstance } from "../../support/f02.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
const MIN = 60_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-solicitacao@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const post = (payload: unknown, key: string = crypto.randomUUID()) =>
  flow.request("POST", "/api/v1/instances", {
    cookie: admin.cookie,
    payload,
    headers: { "idempotency-key": key },
  });

const checked = <R extends { statusCode: number; body: string }>(operation: string, r: R): R => {
  expectMatchesContract(operation, r.statusCode, bodyOf(r));
  return r;
};

const errorOf = (r: { json: <T>() => T }) =>
  r.json<{ error: { code: string; field: string | null } }>().error;

describe("solicitação de instância (US3, FR-011 a FR-020)", () => {
  it("sem TOTP recente → 403 AUTH_REAUTH_REQUIRED", async () => {
    env.clock.advance(6 * MIN);
    const response = checked("requestInstance", await post(requestBody()));
    expect(response.statusCode).toBe(403);
    expect(errorOf(response).code).toBe("AUTH_REAUTH_REQUIRED");
    expect((await flow.reauth(admin)).statusCode).toBe(200);
  });

  it("cria instância CADASTRADA e tarefa numa transação, sem esperar o provisionamento", async () => {
    const response = checked("requestInstance", await post(requestBody({ slug: "Loja Centro!" })));
    expect(response.statusCode).toBe(201);
    const body = response.json<{
      instance: { id: string; state: string; slug: string };
      task: { id: string; protocol: string; status: string };
    }>();
    await trackInstance(env, body.instance.id);
    expect(body.instance).toMatchObject({ state: "CADASTRADA", slug: "loja-centro" });
    expect(body.task).toMatchObject({ status: "pendente" });
    expect(body.task.protocol).toMatch(/^PRV-\d{6,}$/);

    const id = uuidToBin(body.instance.id);
    const hex = body.instance.id.replaceAll("-", "");
    const { rows } = await sql<{ database_name: string; access_database_name: string }>`
      SELECT database_name, access_database_name FROM instance WHERE id = ${id}`.execute(
      env.ctx.core,
    );
    expect(rows[0]).toEqual({
      database_name: `sparkref_${hex}`,
      access_database_name: `sparkref_${hex}_acc`,
    });
    const { rows: task } = await sql<{ artifact_version: number; manifest_sha256: string }>`
      SELECT artifact_version, manifest_sha256 FROM admin_task WHERE instance_id = ${id}`.execute(
      env.ctx.core,
    );
    expect(task[0]?.artifact_version).toBe(2);
    expect(task[0]?.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    const { rows: transitions } = await sql<{ to_state: string }>`
      SELECT to_state FROM instance_transition WHERE instance_id = ${id}`.execute(env.ctx.core);
    expect(transitions).toEqual([{ to_state: "CADASTRADA" }]);
    const { rows: audit } = await sql<{ action: string }>`
      SELECT action FROM core_audit_event WHERE object_id = ${body.instance.id}`.execute(
      env.ctx.core,
    );
    expect(audit).toEqual([{ action: "instancia.solicitada" }]);
    expect((await stepRuns(env, body.task.id)).map((r) => [r.step, r.status])).toEqual([
      ["validar", "concluida"],
      ["reservar", "concluida"],
    ]);
  });

  it("contratante inativo, produto não provisionável e campos inválidos são recusados", async () => {
    await sql`UPDATE contractor SET status = 'inativo'
               WHERE id = ${uuidToBin(TEST_CONTRACTOR_ID)}`.execute(env.ctx.core);
    const inactive = checked("requestInstance", await post(requestBody()));
    expect(inactive.statusCode).toBe(409);
    expect(errorOf(inactive).code).toBe("CONFLICT_CONTRACTOR_INACTIVE");
    await sql`UPDATE contractor SET status = 'ativo'
               WHERE id = ${uuidToBin(TEST_CONTRACTOR_ID)}`.execute(env.ctx.core);

    // Tuteli (sparkpet) tem artefato publicado; inativar simula produto não provisionável.
    await sql`UPDATE product SET status = 'inativo' WHERE code = 'sparkpet'`.execute(env.ctx.core);
    const pet = checked("requestInstance", await post(requestBody({ productCode: "sparkpet" })));
    expect(pet.statusCode).toBe(409);
    expect(errorOf(pet).code).toBe("CONFLICT_PRODUCT_NOT_PROVISIONABLE");
    await sql`UPDATE product SET status = 'ativo' WHERE code = 'sparkpet'`.execute(env.ctx.core);

    for (const [patch, field] of [
      [{ slug: "admin" }, "/slug"],
      [{ slug: "ab" }, "/slug"],
      [{ timezone: "Europe/Lisbon" }, "/timezone"],
      [{ validFrom: "2026-12-01", validUntil: "2026-11-01" }, "/validUntil"],
      [{ contractorId: crypto.randomUUID() }, "/contractorId"],
    ] as const) {
      const response = checked("requestInstance", await post(requestBody(patch)));
      expect(response.statusCode).toBe(422);
      expect(errorOf(response).field).toBe(field);
    }
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance
       WHERE slug IN ('admin', 'ab')`.execute(env.ctx.core);
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("prévia normaliza o slug e informa disponibilidade sem reservar; fusos suportados", async () => {
    const preview = checked(
      "previewInstance",
      await flow.request("POST", "/api/v1/instances/preview", {
        cookie: admin.cookie,
        payload: requestBody({ slug: "Loja Centro!" }),
      }),
    );
    expect(preview.json<{ slug: string; slugAvailable: boolean }>()).toMatchObject({
      slug: "loja-centro",
      slugAvailable: false,
    });
    const free = await flow.request("POST", "/api/v1/instances/preview", {
      cookie: admin.cookie,
      payload: requestBody({ slug: "Loja Nova Prévia" }),
    });
    expect(free.json<{ slug: string; slugAvailable: boolean }>()).toMatchObject({
      slug: "loja-nova-previa",
      slugAvailable: true,
    });
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance
       WHERE slug = 'loja-nova-previa'`.execute(env.ctx.core);
    expect(Number(rows[0]?.n)).toBe(0);

    const zones = checked(
      "listTimezones",
      await flow.request("GET", "/api/v1/instances/timezones", { cookie: admin.cookie }),
    );
    expect(zones.json<{ default: string }>().default).toBe("America/Sao_Paulo");
  });

  it("sem Idempotency-Key → 422", async () => {
    const response = await flow.request("POST", "/api/v1/instances", {
      cookie: admin.cookie,
      payload: requestBody(),
    });
    expect(response.statusCode).toBe(422);
  });
});
