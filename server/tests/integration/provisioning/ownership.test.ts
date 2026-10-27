import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { SimulatedCrash } from "../../../src/modules/provisioning/errors.js";
import { LEASE_MS } from "../../../src/modules/provisioning/tasks.js";
import { instanceUserName, newId, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { requester, requestViaService, runProvisioning, taskRow } from "../../support/f02.js";

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

const tablesOf = async (database: string) => {
  const provisioner = await env.mysql.connect("provisioner");
  const [rows] = await provisioner.query(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY 1",
    [database],
  );
  return (rows as { name: string }[]).map((r) => r.name);
};

async function expectConflict(instanceId: string, taskId: string) {
  const row = await taskRow(env, taskId);
  expect(row).toMatchObject({ status: "falhou", error_code: "PROVISIONING_RESOURCE_CONFLICT" });
  expect((await getInstance(env.ctx, instanceId))?.state).toBe("FALHA_PROVISIONAMENTO");
  // Falha não transitória: nenhuma nova tentativa automática.
  env.clock.advance(LEASE_MS * 10);
  expect(await runProvisioning(env, taskId)).toBeNull();
}

/** Primeira execução cai logo depois de criar o banco operacional (intenção gravada). */
async function crashAfterDatabase(taskId: string) {
  await expect(
    runProvisioning(env, taskId, {
      afterEffect: (step) => {
        if (step === "criar_bancos") throw new SimulatedCrash(step);
      },
    }),
  ).rejects.toBeInstanceOf(SimulatedCrash);
  env.clock.advance(LEASE_MS + 1_000);
}

describe("prova de propriedade antes de reutilizar recurso (CS-005, SC-021, RN-SC-004)", () => {
  it("banco com o nome derivado existe sem intenção → conflito, nada alterado", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    const instance = await getInstance(env.ctx, instanceId);
    const database = instance?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner");
    await provisioner.query(`CREATE DATABASE \`${database}\``);
    await provisioner.query(`CREATE TABLE \`${database}\`.alheia (id INT PRIMARY KEY)`);
    await provisioner.query(`INSERT INTO \`${database}\`.alheia VALUES (1)`);

    expect(await runProvisioning(env, taskId)).toBe("falhou");
    await expectConflict(instanceId, taskId);
    expect(await tablesOf(database)).toEqual(["alheia"]);
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instanceId)}`.execute(env.ctx.core);
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("intenção existe, mas o banco ganhou tabelas sem marcador → conflito", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    await crashAfterDatabase(taskId);
    const database = (await getInstance(env.ctx, instanceId))?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner", database);
    await provisioner.query("CREATE TABLE intrusa (id INT)");
    expect(await runProvisioning(env, taskId)).toBe("falhou");
    await expectConflict(instanceId, taskId);
    expect(await tablesOf(database)).toEqual(["intrusa"]);
  });

  it("marcador de outra instância → conflito", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    await crashAfterDatabase(taskId);
    const database = (await getInstance(env.ctx, instanceId))?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner", database);
    await provisioner.query(
      `CREATE TABLE _spark_instance (instance_uuid BINARY(16) NOT NULL PRIMARY KEY,
         product_code VARCHAR(32) NOT NULL, owner_task_uuid BINARY(16) NULL,
         synthetic BOOLEAN NOT NULL, created_at DATETIME(6) NOT NULL)`,
    );
    await provisioner.query(
      "INSERT INTO _spark_instance VALUES (?, 'sparkref', NULL, TRUE, UTC_TIMESTAMP(6))",
      [uuidToBin(newId())],
    );
    expect(await runProvisioning(env, taskId)).toBe("falhou");
    await expectConflict(instanceId, taskId);
  });

  it("usuário inst_* já existente sem intenção → conflito, senha e privilégios intocados", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId);
    const user = instanceUserName(instanceId);
    const provisioner = await env.mysql.connect("provisioner");
    await provisioner.query(`CREATE USER '${user}'@'%' IDENTIFIED BY 'senha-alheia-123'`);

    expect(await runProvisioning(env, taskId)).toBe("falhou");
    await expectConflict(instanceId, taskId);
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instanceId)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    expect(Number(rows[0]?.n)).toBe(0);
    const own = await env.mysql.connectAs(user, "senha-alheia-123");
    const [grants] = await own.query("SHOW GRANTS");
    expect(JSON.stringify(grants)).not.toMatch(/sparkref/);
  });
});
