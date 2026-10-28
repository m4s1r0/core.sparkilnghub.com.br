import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInstanceHealth, latestHealthCheck } from "../../../src/modules/instances/health.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { F01TestEnv } from "../../support/f01.js";
import { instanceAtState } from "../../support/f03.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

describe("checkInstanceHealth (research.md R-04, SC-042)", () => {
  it("instância pronta e com credencial verificada está saudável, na versão vigente do manifesto", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const result = await checkInstanceHealth(env.ctx, instance, "painel");
    expect(result.healthy).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.schemaVersion).toBeGreaterThan(0);
    const latest = await latestHealthCheck(env.ctx, instance.id);
    expect(latest).toMatchObject({ healthy: true, schemaVersion: result.schemaVersion });
  });

  it("marcador divergente (outro UUID) reprova com motivo sanitizado, sem SQL", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    const resource = await env.mysql.connect("provisioner");
    await resource.query(
      `UPDATE \`${instance.databaseName}\`._spark_instance SET instance_uuid = UNHEX(REPLACE(UUID(), '-', ''))`,
    );
    const result = await checkInstanceHealth(env.ctx, instance, "painel");
    expect(result.healthy).toBe(false);
    expect(result.reason).not.toMatch(/SELECT|INSERT|UPDATE|password/i);
    expect(result.reason).toMatch(/marcador/);
  });

  it("sem credencial verificada (recurso ausente) reprova sem tentar conectar", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    await sql`UPDATE instance_resource SET status = 'criado'
               WHERE instance_id = ${uuidToBin(instance.id)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    const result = await checkInstanceHealth(env.ctx, instance, "painel");
    expect(result.healthy).toBe(false);
    expect(result.reason).toBe("sem credencial operacional verificada");
  });

  it("grava sempre uma linha em instance_health_check, mesmo em falha", async () => {
    const { instance } = await instanceAtState(env, "ATIVA");
    await sql`UPDATE instance_resource SET status = 'criado'
               WHERE instance_id = ${uuidToBin(instance.id)} AND kind = 'usuario_mysql'`.execute(
      env.ctx.core,
    );
    await checkInstanceHealth(env.ctx, instance, "saida_manutencao");
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_health_check
       WHERE instance_id = ${uuidToBin(instance.id)} AND origin = 'saida_manutencao'`.execute(
      env.ctx.core,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
