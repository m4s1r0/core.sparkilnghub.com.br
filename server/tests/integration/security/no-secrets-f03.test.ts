import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getResource, resourceSecret } from "../../../src/modules/provisioning/resources.js";
import { instanceUserName, uuidToBin } from "../../../src/platform/ids.js";
import { AuthFlow } from "../../support/auth-flow.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { insertBackupRecord, instanceAtState, openSessionFor } from "../../support/f03.js";

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

describe("nenhum segredo do ciclo de operação vaza (CS-018, constituição VI)", () => {
  it("senha operacional, SQL e usuário MySQL fora de logs, tabelas novas e respostas", async () => {
    const flow = new AuthFlow(env, app);
    const admin = await flow.admin("admin-segredos-f03@example.test");
    const ordinary: string[] = [];
    const push = (body: string) => ordinary.push(body);
    const key = () => crypto.randomUUID();
    const post = (url: string, payload?: unknown) =>
      flow.request("POST", url, {
        cookie: admin.cookie,
        payload,
        headers: { "idempotency-key": key() },
      });
    const get = (url: string) => flow.request("GET", url, { cookie: admin.cookie });

    const { instance } = await instanceAtState(env, "PRONTA");
    const resource = await getResource(env.ctx.core, instance.id, "usuario_mysql");
    const password = resourceSecret(env.ctx, instance.id, resource!);
    await insertBackupRecord(env, instance.id);

    push((await post(`/api/v1/instances/${instance.id}/activate`)).body);
    const session = await openSessionFor(env, instance);
    push(
      (await post(`/api/v1/instances/${instance.id}/suspend`, { reason: "teste de segredos" }))
        .body,
    );
    push((await get(`/i/${instance.slug}`)).body);
    push((await post(`/api/v1/instances/${instance.id}/reactivate`)).body);
    push(
      (
        await post(`/api/v1/instances/${instance.id}/maintenance/enter`, {
          reason: "teste de segredos",
        })
      ).body,
    );
    push((await get(`/api/v1/instances/${instance.id}/health`)).body);
    push((await post(`/api/v1/instances/${instance.id}/health`)).body);
    push((await post(`/api/v1/instances/${instance.id}/maintenance/exit`)).body);
    push(
      (await post(`/api/v1/instances/${instance.id}/suspend`, { reason: "teste de segredos 2" }))
        .body,
    );
    push(
      (
        await post(`/api/v1/instances/${instance.id}/terminate`, {
          reason: "teste de segredos",
          retentionPolicy: "30 dias",
        })
      ).body,
    );

    const dumps: Record<string, string> = {
      logsServidor: app.raw.join("\n"),
      respostas: ordinary.join("\n"),
    };
    for (const table of [
      "instance_health_check",
      "instance_backup_record",
      "instance_termination",
      "instance_transition",
    ] as const) {
      const { rows } = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)}
         WHERE instance_id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
      dumps[table] = JSON.stringify(rows, (_key, value: unknown) =>
        Buffer.isBuffer(value) ? value.toString("hex") : value,
      );
    }
    const { rows: audit } = await sql<Record<string, unknown>>`SELECT * FROM core_audit_event
       WHERE object_type = 'instancia' AND object_id = ${instance.id}`.execute(env.ctx.core);
    dumps.core_audit_event = JSON.stringify(audit, (_key, value: unknown) =>
      Buffer.isBuffer(value) ? value.toString("hex") : value,
    );
    const user = instanceUserName(instance.id);
    for (const [where, text] of Object.entries(dumps)) {
      expect(text, where).not.toContain(password);
      expect(text, where).not.toMatch(/CREATE (USER|DATABASE)|GRANT |IDENTIFIED BY/);
      expect(text, where).not.toContain(user);
    }
    void session;
  });
});
