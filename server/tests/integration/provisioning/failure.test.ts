import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { SimulatedCrash } from "../../../src/modules/provisioning/errors.js";
import { LEASE_MS } from "../../../src/modules/provisioning/tasks.js";
import type { AppContext } from "../../../src/platform/context.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { referenceProductDir } from "../../../src/platform/paths.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, TEST_CONTRACTOR_ID } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import {
  artifactVariant,
  requester,
  requestViaService,
  runProvisioning,
  stepRuns,
  taskRow,
} from "../../support/f02.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
let accountId: string;
const MIN = 60_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-falhas@example.test");
  accountId = await requester(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const transient = (step: string) => (current: string) => {
  if (current === step) throw Object.assign(new Error("conexão perdida"), { code: "ECONNRESET" });
};

const withMaxAttempts = (max: number): AppContext =>
  Object.create(env.ctx, {
    config: { value: { ...env.ctx.config, PROVISIONING_MAX_ATTEMPTS: max } },
  }) as AppContext;

const retry = (instanceId: string, key: string = crypto.randomUUID(), reason = "MySQL voltou") =>
  flow.request("POST", `/api/v1/instances/${instanceId}/provisioning/retry`, {
    cookie: admin.cookie,
    payload: { reason },
    headers: { "idempotency-key": key },
  });

describe("falhas, tentativas e nova execução (US4, FR-025, FR-026, SC-023)", () => {
  it("falha transitória → aguardando repetição com espera progressiva; depois conclui", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId, { afterEffect: transient("criar_bancos") })).toBe(
      "aguardando_repeticao",
    );
    const row = await taskRow(env, taskId);
    expect(row).toMatchObject({
      status: "aguardando_repeticao",
      attempt: 1,
      error_code: "PROVISIONING_DEPENDENCY_UNAVAILABLE",
    });
    expect(await runProvisioning(env, taskId)).toBeNull();
    env.clock.advance(5_000);
    expect(await runProvisioning(env, taskId)).toBe("concluida");
    expect((await getInstance(env.ctx, instanceId))?.state).toBe("PRONTA");
  });

  it("tentativas esgotadas → FALHA_PROVISIONAMENTO, mensagem segura, login bloqueado", async () => {
    const ctx = withMaxAttempts(2);
    const { instanceId, taskId } = await requestViaService(env, accountId);
    // MySQL inalcançável para o provisionador: ECONNREFUSED real em toda tentativa.
    const options = { ctx, config: { ...env.mysql.config, MYSQL_PORT: 1 } };
    expect(await runProvisioning(env, taskId, options)).toBe("aguardando_repeticao");
    env.clock.advance(5_000);
    expect(await runProvisioning(env, taskId, options)).toBe("falhou");
    const row = await taskRow(env, taskId);
    expect(row).toMatchObject({
      status: "falhou",
      error_code: "PROVISIONING_DEPENDENCY_UNAVAILABLE",
    });
    expect(row.error_message).not.toMatch(/ECONNRESET|SELECT|inst_/);
    expect((await getInstance(env.ctx, instanceId))?.state).toBe("FALHA_PROVISIONAMENTO");

    const view = await flow.request("GET", `/api/v1/instances/${instanceId}/provisioning`, {
      cookie: admin.cookie,
    });
    expectMatchesContract("getProvisioning", view.statusCode, bodyOf(view));
    expect(view.json<{ error: { step: string; retryable: boolean } }>().error).toMatchObject({
      step: "criar_bancos",
      retryable: true,
    });
  });

  it("nova execução: reautenticação, só em falha, retoma e preserva o histórico", async () => {
    const ctx = withMaxAttempts(1);
    const { instanceId, taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId, { ctx, afterEffect: transient("configurar") })).toBe(
      "falhou",
    );
    const firstRun = (await stepRuns(env, taskId)).filter((r) => r.run_number === 1);

    env.clock.advance(6 * MIN);
    const stale = await retry(instanceId);
    expect(stale.statusCode).toBe(403);
    expect((await flow.reauth(admin)).statusCode).toBe(200);

    const key = crypto.randomUUID();
    const accepted = await retry(instanceId, key);
    expectMatchesContract("retryProvisioning", accepted.statusCode, bodyOf(accepted));
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json<{ runNumber: number; status: string }>()).toMatchObject({
      runNumber: 2,
      status: "pendente",
    });
    const replay = await retry(instanceId, key);
    expect(replay.statusCode).toBe(202);
    expect(replay.body).toBe(accepted.body);

    expect(await runProvisioning(env, taskId)).toBe("concluida");
    expect((await getInstance(env.ctx, instanceId))?.state).toBe("PRONTA");
    const runs = await stepRuns(env, taskId);
    expect(runs.filter((r) => r.run_number === 1)).toEqual(firstRun);
    expect(runs.some((r) => r.run_number === 2 && r.step === "configurar")).toBe(true);
    const { rows } = await sql<{ action: string; reason: string }>`
      SELECT action, reason FROM core_audit_event
       WHERE object_id = ${instanceId} AND action = 'provisionamento.repetido'`.execute(
      env.ctx.core,
    );
    expect(rows).toEqual([{ action: "provisionamento.repetido", reason: "MySQL voltou" }]);

    const notFailed = await retry(instanceId);
    expect(notFailed.statusCode).toBe(409);
    expect(notFailed.json<{ error: { code: string } }>().error.code).toBe("CONFLICT_STATE");
  });

  it("versão do artefato que falha → PROVISIONING_MIGRATION_FAILED, sem repetição", async () => {
    const registry = artifactVariant({
      "0002_ref_item": "CREATE TABLE ref_item (id INT);\nCREATE TABLE ref_item (id INT);\n",
    });
    const { taskId } = await requestViaService(env, accountId, {}, crypto.randomUUID(), registry);
    expect(await runProvisioning(env, taskId, { registry })).toBe("falhou");
    expect(await taskRow(env, taskId)).toMatchObject({
      error_code: "PROVISIONING_MIGRATION_FAILED",
    });
  });

  it("versão interrompida no meio (linha falha no histórico) → PROVISIONING_MIGRATION_INTERRUPTED", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    await expect(
      runProvisioning(env, taskId, {
        afterEffect: (step) => {
          if (step === "criar_credencial") throw new SimulatedCrash(step);
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    const database = (await getInstance(env.ctx, instanceId))?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner", database);
    await provisioner.query(
      `CREATE TABLE _spark_schema_history (version INT UNSIGNED NOT NULL PRIMARY KEY,
         name VARCHAR(120) NOT NULL, checksum CHAR(64) NOT NULL, artifact VARCHAR(64) NOT NULL,
         status ENUM('aplicada','falha') NOT NULL, started_at DATETIME(6) NOT NULL,
         finished_at DATETIME(6) NULL, applied_by VARCHAR(64) NOT NULL)`,
    );
    await provisioner.query(
      `INSERT INTO _spark_schema_history VALUES (1, '0001_baseline', ?, 'sparkref', 'falha',
         UTC_TIMESTAMP(6), NULL, 'teste')`,
      [(await loadManifest(referenceProductDir)).migrations[0]?.sha256],
    );
    env.clock.advance(LEASE_MS + 1_000);
    expect(await runProvisioning(env, taskId)).toBe("falhou");
    expect(await taskRow(env, taskId)).toMatchObject({
      error_code: "PROVISIONING_MIGRATION_INTERRUPTED",
    });
  });

  it("contratante e produto inativados depois da solicitação: a tarefa conclui", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    await sql`UPDATE contractor SET status = 'inativo'
               WHERE id = ${uuidToBin(TEST_CONTRACTOR_ID)}`.execute(env.ctx.core);
    await sql`UPDATE product SET status = 'inativo' WHERE code = 'sparkref'`.execute(env.ctx.core);
    try {
      expect(await runProvisioning(env, taskId)).toBe("concluida");
      expect((await getInstance(env.ctx, instanceId))?.state).toBe("PRONTA");
    } finally {
      await sql`UPDATE contractor SET status = 'ativo'
                 WHERE id = ${uuidToBin(TEST_CONTRACTOR_ID)}`.execute(env.ctx.core);
      await sql`UPDATE product SET status = 'ativo' WHERE code = 'sparkref'`.execute(env.ctx.core);
    }
  });

  it("artefato implantado alterado depois da solicitação → PROVISIONING_ARTIFACT_CHANGED", async () => {
    const { taskId } = await requestViaService(env, accountId);
    const changed = artifactVariant({ "0003_extra": "CREATE TABLE ref_extra (id INT);\n" });
    expect(await runProvisioning(env, taskId, { registry: changed })).toBe("falhou");
    expect(await taskRow(env, taskId)).toMatchObject({
      error_code: "PROVISIONING_ARTIFACT_CHANGED",
    });
  });

  it("credencial de provisionamento sem privilégio → PROVISIONING_PRIVILEGE_MISSING", async () => {
    const { taskId } = await requestViaService(env, accountId);
    await expect(
      runProvisioning(env, taskId, {
        afterEffect: (step) => {
          if (step === "criar_bancos") throw new SimulatedCrash(step);
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    env.clock.advance(LEASE_MS + 1_000);
    const broken = {
      ...env.mysql.config,
      credentials: { ...env.mysql.config.credentials, provisioner: "senha-errada-123" },
    };
    expect(await runProvisioning(env, taskId, { config: broken })).toBe("falhou");
    const runs = await stepRuns(env, taskId);
    expect(runs.at(-1)).toMatchObject({
      step: "criar_bancos",
      status: "falhou",
      error_code: "PROVISIONING_PRIVILEGE_MISSING",
    });
  });

  it("não existe rota para editar estado, etapa, SQL ou credencial", () => {
    const routes = app.app.printRoutes({ commonPrefix: false });
    expect(routes).not.toMatch(/\/(state|estado|step|etapa|sql|credential|credencial)\b/i);
    expect(routes).not.toMatch(/instances\/:instanceId\/provisioning \(PUT|PATCH|DELETE\)/);
  });
});
