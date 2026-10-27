import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppContext } from "../../../src/platform/context.js";
import { decryptSecret } from "../../../src/platform/crypto/index.js";
import { instanceUserName, uuidToBin } from "../../../src/platform/ids.js";
import { captureLogger } from "../../support/app.js";
import { AuthFlow } from "../../support/auth-flow.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requestBody, runProvisioning, trackInstance } from "../../support/f02.js";
import { appCredential } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("nenhum segredo do provisionamento vaza (CS-007, constituição VI)", () => {
  it("senha operacional, usuário MySQL, SQL e token do convite fora de logs, tabelas e respostas", async () => {
    const flow = new AuthFlow(env, app);
    const admin = await flow.admin("admin-segredos-f02@example.test");
    const worker = captureLogger();
    const workerCtx = Object.create(env.ctx, {
      logger: { value: worker.logger },
      config: { value: { ...env.ctx.config, PROVISIONING_MAX_ATTEMPTS: 1 } },
    }) as AppContext;
    const ordinary: string[] = [];

    // Solicitação e provisionamento até PRONTA.
    const created = await flow.request("POST", "/api/v1/instances", {
      cookie: admin.cookie,
      payload: requestBody(),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    ordinary.push(created.body);
    const { instance, task } = created.json<{
      instance: { id: string; slug: string };
      task: { id: string };
    }>();
    await trackInstance(env, instance.id);
    expect(await runProvisioning(env, task.id, { ctx: workerCtx })).toBe("concluida");

    // Uma falha (com nova execução) para exercitar mensagens de erro.
    const failing = await flow.request("POST", "/api/v1/instances", {
      cookie: admin.cookie,
      payload: requestBody(),
      headers: { "idempotency-key": crypto.randomUUID() },
    });
    const failed = failing.json<{ instance: { id: string }; task: { id: string } }>();
    await trackInstance(env, failed.instance.id);
    await runProvisioning(env, failed.task.id, {
      ctx: workerCtx,
      config: { ...env.mysql.config, MYSQL_PORT: 1 },
    });
    for (const id of [instance.id, failed.instance.id]) {
      ordinary.push(
        (
          await flow.request("GET", `/api/v1/instances/${id}/provisioning`, {
            cookie: admin.cookie,
          })
        ).body,
        (await flow.request("GET", `/api/v1/instances/${id}`, { cookie: admin.cookie })).body,
      );
    }
    ordinary.push((await flow.request("GET", "/api/v1/instances", { cookie: admin.cookie })).body);
    ordinary.push(
      (
        await flow.request("POST", `/api/v1/instances/${failed.instance.id}/provisioning/retry`, {
          cookie: admin.cookie,
          payload: { reason: "teste de segredos" },
          headers: { "idempotency-key": crypto.randomUUID() },
        })
      ).body,
    );

    // Emissão do convite inicial: o link é a resposta de exibição única.
    const issued = await flow.request(
      "POST",
      `/api/v1/instances/${instance.id}/initial-invitation/issue`,
      {
        cookie: admin.cookie,
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
    const inviteToken = issued.json<{ link: string }>().link.split("/").pop() ?? "";

    // Contrato de conexão: a senha é a resposta esperada; nada mais pode contê-la.
    const credential = await appCredential(env, "sparkref", ["connection"]);
    const connection = await app.app.inject({
      method: "GET",
      url: `/internal/v1/instances/${instance.slug}/connection`,
      headers: { authorization: `Bearer ${credential}` },
    });
    const password = connection.json<{ password: string }>().password;

    // Senha guardada (cifrada) confere com a entregue.
    const { rows: stored } = await sql<{ secret_enc: Buffer; secret_key_version: number }>`
      SELECT secret_enc, secret_key_version FROM instance_resource
       WHERE instance_id = ${uuidToBin(instance.id)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    const row = stored[0];
    if (!row) throw new Error("sem segredo");
    expect(
      decryptSecret(
        env.ctx.instanceKeyRing,
        row.secret_enc,
        row.secret_key_version,
        uuidToBin(instance.id),
      ).toString("utf8"),
    ).toBe(password);

    const dumps: Record<string, string> = {
      logsServidor: app.raw.join("\n"),
      logsTrabalhador: worker.raw.join("\n"),
      respostas: ordinary.join("\n"),
    };
    for (const [table, db] of [
      ["admin_task", env.ctx.core],
      ["admin_task_step_run", env.ctx.core],
      ["core_audit_event", env.ctx.core],
      ["instance_transition", env.ctx.core],
      ["security_event", env.ctx.identity],
    ] as const) {
      const { rows } = await sql<
        Record<string, unknown>
      >`SELECT * FROM ${sql.table(table)}`.execute(db);
      dumps[table] = JSON.stringify(rows, (_key, value: unknown) =>
        Buffer.isBuffer(value) ? value.toString("hex") : value,
      );
    }
    const user = instanceUserName(instance.id);
    for (const [where, text] of Object.entries(dumps)) {
      expect(text, where).not.toContain(password);
      expect(text, where).not.toContain(inviteToken);
      expect(text, where).not.toMatch(/CREATE (USER|DATABASE)|GRANT |IDENTIFIED BY/);
      if (where !== "logsTrabalhador") expect(text, where).not.toContain(user);
    }
  });
});
