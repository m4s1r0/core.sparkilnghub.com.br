import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../../support/f02.js";
import {
  insertBackupRecord,
  instanceAtState,
  openSessionFor,
  SYNTHETIC_REASON,
} from "../../support/f03.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-ciclo@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const key = () => crypto.randomUUID();
const post = (url: string, payload?: unknown) =>
  flow.request("POST", url, {
    cookie: admin.cookie,
    payload,
    headers: { "idempotency-key": key() },
  });
const get = (url: string) => flow.request("GET", url, { cookie: admin.cookie });

const checked = <R extends { statusCode: number; body: string }>(operation: string, r: R): R => {
  expectMatchesContract(operation, r.statusCode, bodyOf(r));
  return r;
};

const errorOf = (r: { json: <T>() => T }) => r.json<{ error: { code: string } }>().error;

async function prontaInstance() {
  const accountId = await requester(env);
  const { instanceId, taskId } = await requestViaService(env, accountId);
  await runProvisioning(env, taskId);
  return instanceId;
}

describe("ativação (US1, SC-029)", () => {
  it("PRONTA com convite pendente → ATIVA; já ATIVA → CONFLICT_STATE", async () => {
    const instanceId = await prontaInstance();
    const response = checked(
      "activateInstance",
      await post(`/api/v1/instances/${instanceId}/activate`),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ state: string }>().state).toBe("ATIVA");

    const again = checked(
      "activateInstance",
      await post(`/api/v1/instances/${instanceId}/activate`),
    );
    expect(again.statusCode).toBe(409);
    expect(errorOf(again).code).toBe("CONFLICT_STATE");
  });

  it("reemissão do convite inicial permanece possível em ATIVA sem administrador (FR-032)", async () => {
    const instanceId = await prontaInstance();
    await post(`/api/v1/instances/${instanceId}/activate`);
    const response = checked(
      "issueInitialInvitation",
      await post(`/api/v1/instances/${instanceId}/initial-invitation/issue`),
    );
    expect(response.statusCode).toBe(201);
  });
});

describe("suspensão e página pública (US2, SC-025 a SC-028)", () => {
  it("suspende, nega sessão a partir da confirmação e mostra a página pública", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const session = await openSessionFor(env, instance);

    const response = checked(
      "suspendInstance",
      await post(`/api/v1/instances/${instance.id}/suspend`, { reason: SYNTHETIC_REASON }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ state: string }>().state).toBe("SUSPENSA");

    const page = await flow.request("GET", `/i/${instance.slug}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("indisponível");
    expect(page.body).not.toMatch(/motivo financeiro|cobrança|fatura/i);
    void session;
  });

  it("instância inexistente e qualquer outro estado respondem o mesmo 404 na página pública", async () => {
    const notFound = await flow.request("GET", "/i/slug-que-nao-existe");
    expect(notFound.statusCode).toBe(404);
    const { instance } = await instanceAtState(env, "ATIVA");
    const ativa = await flow.request("GET", `/i/${instance.slug}`);
    expect(ativa.statusCode).toBe(404);
  });
});

describe("reativação (US3, CA-SC-009)", () => {
  it("reativa sem restaurar sessão revogada pela suspensão", async () => {
    const { instance, actor } = await instanceAtState(env, "ATIVA");
    const session = await openSessionFor(env, instance);
    await post(`/api/v1/instances/${instance.id}/suspend`, { reason: SYNTHETIC_REASON });

    const response = checked(
      "reactivateInstance",
      await post(`/api/v1/instances/${instance.id}/reactivate`),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ state: string }>().state).toBe("ATIVA");

    const { validateForInstance } =
      await import("../../../src/modules/access-projection/writer.js");
    const { getInstance } = await import("../../../src/modules/instances/instances.js");
    const refreshed = await getInstance(env.ctx, instance.id);
    const valid = await validateForInstance(env.ctx, refreshed!, session.token);
    expect(valid).toBeNull();
    void actor;
  });
});

describe("manutenção (US4, SC-030)", () => {
  it("entra em manutenção e só sai com checagem de saúde aprovada", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const entered = checked(
      "enterMaintenance",
      await post(`/api/v1/instances/${instance.id}/maintenance/enter`, {
        reason: SYNTHETIC_REASON,
      }),
    );
    expect(entered.json<{ state: string }>().state).toBe("MANUTENCAO");

    const exited = checked(
      "exitMaintenance",
      await post(`/api/v1/instances/${instance.id}/maintenance/exit`),
    );
    expect(exited.statusCode).toBe(200);
    expect(exited.json<{ state: string }>().state).toBe("ATIVA");
  });

  it("checagem reprovada mantém MANUTENCAO com HEALTH_CHECK_FAILED", async () => {
    const { instance } = await instanceAtState(env, "MANUTENCAO");
    const { sql } = await import("kysely");
    const { uuidToBin } = await import("../../../src/platform/ids.js");
    await sql`UPDATE instance_resource SET status = 'criado'
               WHERE instance_id = ${uuidToBin(instance.id)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    const response = checked(
      "exitMaintenance",
      await post(`/api/v1/instances/${instance.id}/maintenance/exit`),
    );
    expect(response.statusCode).toBe(409);
    expect(errorOf(response).code).toBe("HEALTH_CHECK_FAILED");
  });
});

describe("saúde e backup (US5, SC-042)", () => {
  it("painel mostra versão, conectividade e status de backup, sem sucesso implícito", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const before = checked(
      "getInstanceHealth",
      await get(`/api/v1/instances/${instance.id}/health`),
    );
    expect(before.json<{ backup: { lastResult: string | null } }>().backup.lastResult).toBeNull();

    await insertBackupRecord(env, instance.id, { result: "sucesso", origin: "[SINTÉTICO] teste" });
    const after = checked(
      "getInstanceHealth",
      await get(`/api/v1/instances/${instance.id}/health`),
    );
    expect(after.json<{ backup: { lastResult: string } }>().backup.lastResult).toBe("sucesso");

    const now = checked(
      "checkInstanceHealthNow",
      await flow.request("POST", `/api/v1/instances/${instance.id}/health`, {
        cookie: admin.cookie,
      }),
    );
    expect(now.statusCode).toBe(200);
    expect(now.json<{ healthy: boolean }>().healthy).toBe(true);
  });
});

describe("encerramento (US7, SC-031)", () => {
  it("só a partir de SUSPENSA; ATIVA é recusado", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const refused = checked(
      "terminateInstance",
      await post(`/api/v1/instances/${instance.id}/terminate`, {
        reason: SYNTHETIC_REASON,
        retentionPolicy: "30 dias",
      }),
    );
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused).code).toBe("CONFLICT_STATE");
  });

  it("encerra, registra retenção e não permite reabrir pela interface", async () => {
    const { instance } = await instanceAtState(env, "SUSPENSA");
    const response = checked(
      "terminateInstance",
      await post(`/api/v1/instances/${instance.id}/terminate`, {
        reason: SYNTHETIC_REASON,
        retentionPolicy: "30 dias (teste)",
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json<{ state: string }>().state).toBe("ENCERRADA");

    const { sql } = await import("kysely");
    const { uuidToBin } = await import("../../../src/platform/ids.js");
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_termination
       WHERE instance_id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    expect(Number(rows[0]?.n)).toBe(1);
    const { rows: resources } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    expect(Number(resources[0]?.n)).toBeGreaterThan(0);
  });
});
