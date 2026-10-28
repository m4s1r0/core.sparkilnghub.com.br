import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInstanceEligibility } from "../../../src/modules/instances/eligibility.js";
import { getInstance } from "../../../src/modules/instances/instances.js";
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

describe("checkInstanceEligibility (SC-029, SC-024)", () => {
  it("instância PRONTA recém-provisionada é elegível pelo convite inicial ainda pendente", async () => {
    const { instance } = await instanceAtState(env, "PRONTA");
    const result = await checkInstanceEligibility(env.ctx, instance);
    expect(result).toEqual({ eligible: true });
  });

  it("contratante inativo recusa com o motivo estável", async () => {
    const { instance } = await instanceAtState(env, "PRONTA");
    await sql`UPDATE contractor SET status = 'inativo'
               WHERE id = ${uuidToBin(instance.contractorId)}`.execute(env.ctx.core);
    try {
      const result = await checkInstanceEligibility(env.ctx, instance);
      expect(result).toEqual({ eligible: false, reason: "CONTRACTOR_INACTIVE" });
    } finally {
      // O contratante sintético é compartilhado por todo o arquivo; devolver o estado.
      await sql`UPDATE contractor SET status = 'ativo'
                 WHERE id = ${uuidToBin(instance.contractorId)}`.execute(env.ctx.core);
    }
  });

  it("schema diferente do manifesto vigente recusa", async () => {
    const { instance } = await instanceAtState(env, "PRONTA");
    await sql`UPDATE instance SET schema_version = 999
               WHERE id = ${uuidToBin(instance.id)}`.execute(env.ctx.core);
    const refreshed = await getInstance(env.ctx, instance.id);
    const result = await checkInstanceEligibility(env.ctx, refreshed!);
    expect(result).toEqual({ eligible: false, reason: "SCHEMA_INCOMPATIBLE" });
  });

  it("sem administrador ativo e sem convite pendente válido recusa", async () => {
    const { instance } = await instanceAtState(env, "PRONTA");
    await sql`UPDATE invitation SET status = 'revogado'
               WHERE target = 'instancia' AND instance_id = ${uuidToBin(instance.id)}
                 AND is_initial = TRUE`.execute(env.ctx.identity);
    const result = await checkInstanceEligibility(env.ctx, instance);
    expect(result).toEqual({ eligible: false, reason: "NO_ADMIN_PATH" });
  });

  it("com administrador ativo na instância é elegível mesmo sem convite pendente", async () => {
    const { instance, requesterId } = await instanceAtState(env, "PRONTA");
    await sql`UPDATE invitation SET status = 'revogado'
               WHERE target = 'instancia' AND instance_id = ${uuidToBin(instance.id)}
                 AND is_initial = TRUE`.execute(env.ctx.identity);
    await env.insertMembership(requesterId, instance.id, "administrador");
    const refreshed = await getInstance(env.ctx, instance.id);
    const result = await checkInstanceEligibility(env.ctx, refreshed!);
    expect(result).toEqual({ eligible: true });
  });
});
