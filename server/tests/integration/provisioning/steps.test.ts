import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { decryptSecret } from "../../../src/platform/crypto/index.js";
import { instanceUserName, uuidToBin } from "../../../src/platform/ids.js";
import { accessDatabaseName } from "../../../src/platform/migrations/apply-artifact.js";
import { readHistory } from "../../../src/platform/migrations/migrator.js";
import { tableStructure } from "../../support/mysql.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, runProvisioning, stepRuns } from "../../support/f02.js";

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

async function resources(instanceId: string) {
  const { rows } = await sql<{
    kind: string;
    identifier: string;
    status: string;
    secret_enc: Buffer | null;
    secret_key_version: number | null;
  }>`SELECT kind, identifier, status, secret_enc, secret_key_version FROM instance_resource
      WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY kind`.execute(env.ctx.core);
  return rows;
}

const passwordOf = async (instanceId: string) => {
  const user = (await resources(instanceId)).find((r) => r.kind === "usuario_mysql");
  if (!user?.secret_enc || user.secret_key_version === null) throw new Error("sem segredo");
  return decryptSecret(
    env.ctx.instanceKeyRing,
    user.secret_enc,
    user.secret_key_version,
    uuidToBin(instanceId),
  ).toString("utf8");
};

describe("tarefa de provisionamento até PRONTA (US3, FR-021, SC-019 a SC-021)", () => {
  it("cria bancos, credencial restrita, migrações, marcador, projeção pronta e convite", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId)).toBe("concluida");

    const instance = await getInstance(env.ctx, instanceId);
    expect(instance?.state).toBe("PRONTA");
    expect(instance?.schemaVersion).toBe(2);
    const { rows: transitions } = await sql<{ from_state: string | null; to_state: string }>`
      SELECT from_state, to_state FROM instance_transition
       WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY created_at, id`.execute(env.ctx.core);
    expect(transitions.map((t) => t.to_state)).toEqual(
      expect.arrayContaining(["CADASTRADA", "PROVISIONANDO", "PRONTA"]),
    );

    const runs = await stepRuns(env, taskId);
    for (const step of [
      "validar",
      "reservar",
      "criar_bancos",
      "criar_credencial",
      "aplicar_migracoes",
      "configurar",
      "preparar_convite",
      "verificar",
      "concluir",
    ]) {
      expect(runs.some((r) => r.step === step && r.status !== "falhou")).toBe(true);
    }

    const res = await resources(instanceId);
    expect(res.map((r) => [r.kind, r.status])).toEqual([
      ["banco_operacional", "verificado"],
      ["banco_acesso", "verificado"],
      ["usuario_mysql", "verificado"],
    ]);
    const database = instance?.databaseName ?? "";
    expect(database).toBe(`sparkref_${instanceId.replaceAll("-", "")}`);

    const provisioner = await env.mysql.connect("provisioner", database);
    const history = await readHistory(provisioner);
    expect(history.map((h) => [h.version, h.status])).toEqual([
      [1, "aplicada"],
      [2, "aplicada"],
    ]);
    const [marker] = await provisioner.query(
      "SELECT HEX(instance_uuid) AS id, HEX(owner_task_uuid) AS task FROM _spark_instance",
    );
    expect(marker).toEqual([
      {
        id: instanceId.replaceAll("-", "").toUpperCase(),
        task: taskId.replaceAll("-", "").toUpperCase(),
      },
    ]);
    const access = await env.mysql.connect("provisioner", accessDatabaseName(database));
    const [projection] = await access.query("SELECT state FROM access_instance");
    expect(projection).toEqual([{ state: "pronta" }]);

    const { rows: invitations } = await sql<{
      status: string;
      is_initial: number;
      link_issued_at: Date | null;
      role: string;
    }>`SELECT status, is_initial, link_issued_at, role FROM invitation
        WHERE instance_id = ${uuidToBin(instanceId)}`.execute(env.ctx.identity);
    expect(invitations).toEqual([
      { status: "pendente", is_initial: 1, link_issued_at: null, role: "administrador" },
    ]);
  });

  it("credencial operacional: DML só na própria instância; sem DDL nem outro banco (CS-006, T-04)", async () => {
    const a = await requestViaService(env, accountId);
    const b = await requestViaService(env, accountId);
    expect(await runProvisioning(env, a.taskId)).toBe("concluida");
    const bInstance = await getInstance(env.ctx, b.instanceId);
    expect(await runProvisioning(env, b.taskId)).toBe("concluida");
    const aInstance = await getInstance(env.ctx, a.instanceId);
    if (!aInstance || !bInstance) throw new Error("instâncias");

    const conn = await env.mysql.connectAs(
      instanceUserName(a.instanceId),
      await passwordOf(a.instanceId),
      aInstance.databaseName,
    );
    await conn.query(
      "INSERT INTO ref_item (label, created_at) VALUES ('[SINTÉTICO] x', UTC_TIMESTAMP(6))",
    );
    const denied = async (statement: string) => {
      await expect(conn.query(statement)).rejects.toMatchObject({
        errno: expect.toBeOneOf([1044, 1142, 1227]) as number,
      });
    };
    await denied(`SELECT * FROM \`${bInstance.databaseName}\`._spark_instance`);
    await denied(`SELECT * FROM \`${accessDatabaseName(bInstance.databaseName)}\`.access_instance`);
    await denied("CREATE TABLE intrusa (id INT)");
    await denied(`CREATE DATABASE \`${aInstance.databaseName}_x\``);
    await denied("ALTER TABLE ref_item ADD COLUMN x INT");
  });

  it("provisionar A não altera nada em B (T-04, tarefa)", async () => {
    const b = await requestViaService(env, accountId);
    expect(await runProvisioning(env, b.taskId)).toBe("concluida");
    const bInstance = await getInstance(env.ctx, b.instanceId);
    if (!bInstance) throw new Error("B");
    const provisioner = await env.mysql.connect("provisioner");
    const snapshot = async () => {
      // Privilégios lidos pelo próprio usuário de B (o provisionador não lê mysql.user).
      const own = await env.mysql.connectAs(
        instanceUserName(b.instanceId),
        await passwordOf(b.instanceId),
        bInstance.databaseName,
      );
      const [grants] = await own.query("SHOW GRANTS");
      const access = await env.mysql.connect(
        "provisioner",
        accessDatabaseName(bInstance.databaseName),
      );
      const [projection] = await access.query("SELECT * FROM access_instance");
      return JSON.stringify({
        operational: await tableStructure(provisioner, bInstance.databaseName),
        access: await tableStructure(provisioner, accessDatabaseName(bInstance.databaseName)),
        grants,
        projection,
        resources: await resources(b.instanceId),
        runs: await stepRuns(env, b.taskId),
      });
    };
    const before = await snapshot();
    const a = await requestViaService(env, accountId);
    expect(await runProvisioning(env, a.taskId)).toBe("concluida");
    expect(await snapshot()).toBe(before);
  });

  it("senha só cifrada: não aparece nos registros de etapa nem na tarefa", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    expect(await runProvisioning(env, taskId)).toBe("concluida");
    const password = await passwordOf(instanceId);
    const { rows } = await sql<{ dump: string }>`SELECT CONCAT_WS('|', step, status,
        COALESCE(error_message, '')) AS dump FROM admin_task_step_run
        WHERE task_id = ${uuidToBin(taskId)}`.execute(env.ctx.core);
    expect(rows.map((r) => r.dump).join("\n")).not.toContain(password);
    const res = await resources(instanceId);
    const user = res.find((r) => r.kind === "usuario_mysql");
    expect(user?.secret_enc?.toString("utf8") ?? "").not.toContain(password);
  });
});
