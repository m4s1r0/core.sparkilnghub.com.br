import { sql } from "kysely";
import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { requestInstance } from "../../../src/modules/instances/request.js";
import { SimulatedCrash } from "../../../src/modules/provisioning/errors.js";
import { LEASE_MS } from "../../../src/modules/provisioning/tasks.js";
import { decryptSecret } from "../../../src/platform/crypto/index.js";
import { instanceUserName, uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import {
  requestBody,
  requester,
  requestViaService,
  runProvisioning,
  taskRow,
  trackInstance,
} from "../../support/f02.js";

// Spec 009 (cadastro do Cortivo no Core): duas instâncias sintéticas, isolamento, falha e retomada
// contra MySQL 8.4 real (FR-013, FR-014, FR-019; CS-COR-002 a CS-COR-005; AC-COR-001, parte Core).

let env: F01TestEnv;
let accountId: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  accountId = await requester(env);
});
afterAll(async () => {
  await env?.cleanup();
});

const cortivo = { productCode: "cortivo" } as const;

/** Conexão com o usuário operacional da instância (credencial que o produto recebe do Core). */
async function operational(instanceId: string): Promise<Connection> {
  const instance = await getInstance(env.ctx, instanceId);
  const id = uuidToBin(instanceId);
  const { rows } = await sql<{ secret_enc: Buffer; secret_key_version: number }>`
    SELECT secret_enc, secret_key_version FROM instance_resource
     WHERE instance_id = ${id} AND kind = 'usuario_mysql'`.execute(env.ctx.core);
  const row = rows[0];
  if (!row || !instance) throw new Error("instância sem usuário operacional");
  const password = decryptSecret(
    env.ctx.instanceKeyRing,
    row.secret_enc,
    row.secret_key_version,
    id,
  ).toString("utf8");
  return env.mysql.connectAs(instanceUserName(instanceId), password, instance.databaseName);
}

async function provision() {
  const created = await requestViaService(env, accountId, cortivo);
  expect(await runProvisioning(env, created.taskId)).toBe("concluida");
  return created;
}

describe("duas instâncias Cortivo isoladas (US1, CS-COR-002, CS-COR-004)", () => {
  it("cada uma chega a PRONTA com 2 bancos, marcador próprio e esquema na versão 1", async () => {
    const a = await provision();
    const b = await provision();
    expect(a.instanceId).not.toBe(b.instanceId);

    for (const created of [a, b]) {
      const instance = await getInstance(env.ctx, created.instanceId);
      expect(instance?.state).toBe("PRONTA");
      const hex = created.instanceId.replaceAll("-", "");
      expect(instance?.databaseName).toBe(`cortivo_${hex}`);

      const provisioner = await env.mysql.connect("provisioner");
      const [dbs] = await provisioner.query(
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
        [`cortivo\\_${hex}%`],
      );
      expect((dbs as { name: string }[]).map((d) => d.name).sort()).toEqual([
        `cortivo_${hex}`,
        `cortivo_${hex}_acc`,
      ]);

      const op = await operational(created.instanceId);
      const [marker] = await op.query(
        "SELECT HEX(instance_uuid) AS id, product_code AS code FROM _spark_instance",
      );
      expect(marker).toEqual([{ id: hex.toUpperCase(), code: "cortivo" }]);
      const [history] = await op.query(
        "SELECT version, status FROM _spark_schema_history ORDER BY version",
      );
      expect(history).toEqual([{ version: 1, status: "aplicada" }]);
    }
  });

  it("a credencial de uma instância não acessa os bancos da outra (0 acessos cruzados)", async () => {
    const a = await provision();
    const b = await provision();
    const opA = await operational(a.instanceId);
    const dbB = (await getInstance(env.ctx, b.instanceId))?.databaseName ?? "";
    const dbBAcc = `${dbB}_acc`;
    await expect(opA.query(`SELECT 1 FROM \`${dbB}\`._spark_instance`)).rejects.toThrow(/denied/i);
    await expect(opA.query(`SELECT 1 FROM \`${dbBAcc}\`.access_instance`)).rejects.toThrow(
      /denied/i,
    );
  });

  it("a credencial operacional só lê e insere na auditoria (CS-COR-005, SEC-BASE-12)", async () => {
    const created = await provision();
    const op = await operational(created.instanceId);
    const id = Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex");
    await op.query(
      `INSERT INTO auditoria (id, ocorrido_em, ator_membership_id, ator_nome, acao, resultado,
                              entidade, entidade_id, correlation_id)
       VALUES (?, UTC_TIMESTAMP(6), ?, 'Administrador', 'perfil.definir', 'sucesso',
               'perfil_colaborador', NULL, ?)`,
      [id, id, crypto.randomUUID()],
    );
    const [rows] = await op.query("SELECT acao FROM auditoria WHERE id = ?", [id]);
    expect(rows).toEqual([{ acao: "perfil.definir" }]);
    await expect(
      op.query("UPDATE auditoria SET acao = 'x' WHERE id = ?", [id]),
    ).rejects.toMatchObject({
      code: "ER_TABLEACCESS_DENIED_ERROR",
    });
    await expect(op.query("DELETE FROM auditoria WHERE id = ?", [id])).rejects.toMatchObject({
      code: "ER_TABLEACCESS_DENIED_ERROR",
    });
    // Contraste: tabela comum da base continua com escrita completa.
    await op.query(
      `INSERT INTO unidade (nome_atendimento, criado_em, atualizado_em)
       VALUES ('[SINTÉTICO] Unidade', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
    );
    await op.query("UPDATE unidade SET nome_atendimento = 'Outro nome' WHERE id = 1");
  });

  it("a credencial operacional não cria bancos nem altera estrutura (FR-013)", async () => {
    const created = await provision();
    const op = await operational(created.instanceId);
    await expect(op.query("CREATE DATABASE cortivo_intruso")).rejects.toMatchObject({
      code: "ER_DBACCESS_DENIED_ERROR",
    });
    await expect(op.query("CREATE TABLE intrusa (id INT)")).rejects.toMatchObject({
      code: "ER_TABLEACCESS_DENIED_ERROR",
    });
  });
});

describe("solicitação repetida e retomada sem duplicar (US2, CS-COR-003, AC-COR-001)", () => {
  const actor = () => ({ accountId, correlationId: crypto.randomUUID() });

  it("solicitações idênticas concorrentes resultam em 1 instância e 1 protocolo", async () => {
    const body = requestBody(cortivo);
    const key = crypto.randomUUID();
    const results = await Promise.all([
      requestInstance(env.ctx, body, actor(), key),
      requestInstance(env.ctx, body, actor(), key),
      requestInstance(env.ctx, body, actor(), key),
    ]);
    const first = results[0];
    if (!first) throw new Error("sem resultado");
    await trackInstance(env, first.instance.id);
    expect(new Set(results.map((r) => r.instance.id)).size).toBe(1);
    expect(new Set(results.map((r) => r.task.protocol)).size).toBe(1);
    const { rows } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM instance WHERE slug = ${body.slug}`.execute(env.ctx.core);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it("queda do trabalhador depois de criar o banco: retoma sem recurso duplicado nem órfão", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId, cortivo);
    await expect(
      runProvisioning(env, taskId, {
        afterEffect: (step) => {
          if (step === "criar_bancos") throw new SimulatedCrash(step);
        },
      }),
    ).rejects.toBeInstanceOf(SimulatedCrash);
    env.clock.advance(LEASE_MS + 1_000);
    expect(await runProvisioning(env, taskId)).toBe("concluida");

    const instance = await getInstance(env.ctx, instanceId);
    expect(instance?.state).toBe("PRONTA");
    const hex = instanceId.replaceAll("-", "");
    const provisioner = await env.mysql.connect("provisioner");
    const [dbs] = await provisioner.query(
      "SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE ?",
      [`cortivo\\_${hex}%`],
    );
    expect(Number((dbs as { n: number }[])[0]?.n)).toBe(2);
    const { rows: resources } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instanceId)} AND status = 'verificado'`.execute(
      env.ctx.core,
    );
    expect(Number(resources[0]?.n)).toBe(3);
    const { rows: users } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM instance_resource
       WHERE instance_id = ${uuidToBin(instanceId)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    expect(Number(users[0]?.n)).toBe(1);
  });

  it("banco cortivo_<uuid> já existente sem pertencer à tarefa: não é reutilizado nem removido", async () => {
    const { instanceId, taskId } = await requestViaService(env, accountId, cortivo);
    const database = (await getInstance(env.ctx, instanceId))?.databaseName ?? "";
    const provisioner = await env.mysql.connect("provisioner");
    await provisioner.query(`CREATE DATABASE \`${database}\``);
    await provisioner.query(`CREATE TABLE \`${database}\`.alheia (id INT PRIMARY KEY)`);
    await provisioner.query(`INSERT INTO \`${database}\`.alheia VALUES (1)`);

    expect(await runProvisioning(env, taskId)).toBe("falhou");
    expect(await taskRow(env, taskId)).toMatchObject({
      status: "falhou",
      error_code: "PROVISIONING_RESOURCE_CONFLICT",
    });
    expect((await getInstance(env.ctx, instanceId))?.state).toBe("FALHA_PROVISIONAMENTO");
    const [tables] = await provisioner.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [database],
    );
    expect(tables).toEqual([{ name: "alheia" }]);
    const [rows] = await provisioner.query(`SELECT id FROM \`${database}\`.alheia`);
    expect(rows).toEqual([{ id: 1 }]);
  });
});
