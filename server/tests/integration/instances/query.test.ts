import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidToBin } from "../../../src/platform/ids.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, TEST_CONTRACTOR_ID } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requester, requestViaService, runProvisioning } from "../../support/f02.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
let other: string;
let ready: { instanceId: string; protocol: string };
let pending: string;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-consulta@example.test");
  const accountId = await requester(env);
  const provisioned = await requestViaService(env, accountId, { displayName: "Loja Pronta" });
  await runProvisioning(env, provisioned.taskId);
  ready = provisioned;
  pending = (await requestViaService(env, accountId, { displayName: "Loja Pendente" })).instanceId;
  // Segundo contratante, com uma instância só dele.
  other = crypto.randomUUID();
  await sql`INSERT INTO contractor (id, legal_name, display_name, name_key, person_type,
              contact_name, email, status, version, created_at, updated_at)
            VALUES (${uuidToBin(other)}, 'Outro', 'Outro', 'outro', 'juridica', 'C',
                    'c@example.test', 'ativo', 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`.execute(
    env.ctx.core,
  );
  await env.insertInstanceRow({ state: "ATIVA", contractorId: other });
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const list = async (query = "") => {
  const response = await flow.request("GET", `/api/v1/instances${query}`, { cookie: admin.cookie });
  expectMatchesContract("listInstances", response.statusCode, bodyOf(response));
  return response.json<{
    items: {
      id: string;
      state: string;
      contractorId: string;
      lastTask: { protocol: string; status: string } | null;
      validityExpired: boolean;
      productCode: string;
      slug: string;
      displayName: string;
      synthetic: boolean;
    }[];
    pageInfo: { page: number; pageSize: number; total: number };
  }>();
};

describe("consulta de instâncias (US6, SC-017, SC-018)", () => {
  it("sem parâmetros: primeira página de 25 com os campos de F01 e os novos", async () => {
    const body = await list();
    expect(body.pageInfo).toMatchObject({ page: 1, pageSize: 25 });
    const item = body.items.find((i) => i.id === ready.instanceId);
    expect(item).toMatchObject({
      state: "PRONTA",
      productCode: "sparkref",
      lastTask: { protocol: ready.protocol, status: "concluida" },
      validityExpired: false,
    });
    expect(Object.keys(item ?? {})).toEqual(
      expect.arrayContaining(["id", "productCode", "slug", "displayName", "synthetic"]),
    );
  });

  it("filtros por contratante, produto, estado e período de criação", async () => {
    const byContractor = await list(`?contractorId=${other}`);
    expect(byContractor.items.every((i) => i.contractorId === other)).toBe(true);
    expect(byContractor.pageInfo.total).toBe(1);
    const byState = await list("?state=CADASTRADA");
    expect(byState.items.map((i) => i.id)).toContain(pending);
    expect(byState.items.every((i) => i.state === "CADASTRADA")).toBe(true);
    expect((await list("?productCode=sparkpet")).pageInfo.total).toBe(0);
    // Instantes de criação vêm do relógio de teste: 2026-10-26 em São Paulo.
    expect(
      (await list("?createdFrom=2026-10-26&createdTo=2026-10-26")).pageInfo.total,
    ).toBeGreaterThan(0);
    expect((await list("?createdFrom=2026-10-27")).pageInfo.total).toBe(0);
    expect((await list("?createdTo=2026-10-25")).pageInfo.total).toBe(0);
    const page = await list("?pageSize=1&page=2");
    expect(page.items).toHaveLength(1);
  });

  it("detalhe com transições, convite inicial e sem credencial", async () => {
    const response = await flow.request("GET", `/api/v1/instances/${ready.instanceId}`, {
      cookie: admin.cookie,
    });
    expectMatchesContract("getInstance", response.statusCode, bodyOf(response));
    const body = response.json<{
      transitions: { from: string | null; to: string; actorKind: string; actorName: string }[];
      initialInvitation: { status: string };
      schemaVersion: number;
    }>();
    expect(body.transitions.map((t) => t.to)).toEqual(
      expect.arrayContaining(["CADASTRADA", "PROVISIONANDO", "PRONTA"]),
    );
    expect(body.transitions.find((t) => t.to === "PRONTA")?.actorName).toBe("Sistema");
    expect(body.initialInvitation.status).toBe("aguardando_emissao");
    expect(body.schemaVersion).toBe(2);
    expect(response.body).not.toMatch(/password|secret|inst_/);
    const missing = await flow.request("GET", `/api/v1/instances/${crypto.randomUUID()}`, {
      cookie: admin.cookie,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("edição de nome, anotações e vigência com versão; slug e dono não editáveis", async () => {
    const detail = await flow.request("GET", `/api/v1/instances/${pending}`, {
      cookie: admin.cookie,
    });
    const version = detail.json<{ version: number }>().version;
    const payload = {
      displayName: "Loja Pendente Centro",
      notes: "Contrato assinado em 20/10.",
      validFrom: "2026-01-01",
      validUntil: "2026-10-01",
      version,
    };
    const updated = await flow.request("PUT", `/api/v1/instances/${pending}`, {
      cookie: admin.cookie,
      payload,
    });
    expectMatchesContract("updateInstance", updated.statusCode, bodyOf(updated));
    expect(
      updated.json<{ displayName: string; validityExpired: boolean; version: number }>(),
    ).toMatchObject({
      displayName: "Loja Pendente Centro",
      validityExpired: true,
      version: version + 1,
    });
    const stale = await flow.request("PUT", `/api/v1/instances/${pending}`, {
      cookie: admin.cookie,
      payload,
    });
    expect(stale.statusCode).toBe(409);
    for (const extra of [
      { slug: "outro" },
      { productCode: "sparkpet" },
      { contractorId: TEST_CONTRACTOR_ID },
    ]) {
      const refused = await flow.request("PUT", `/api/v1/instances/${pending}`, {
        cookie: admin.cookie,
        payload: { ...payload, version: version + 1, ...extra },
      });
      expect(refused.statusCode).toBe(422);
    }
    const inverted = await flow.request("PUT", `/api/v1/instances/${pending}`, {
      cookie: admin.cookie,
      payload: { ...payload, validFrom: "2026-12-01", version: version + 1 },
    });
    expect(inverted.statusCode).toBe(422);
    const { rows } = await sql<{ action: string }>`SELECT action FROM core_audit_event
       WHERE object_id = ${pending} AND action = 'instancia.editada'`.execute(env.ctx.core);
    expect(rows).toHaveLength(1);
    // Vigência vencida é só pendência: o estado não muda (RN-SC-003).
    const after = await flow.request("GET", `/api/v1/instances/${pending}`, {
      cookie: admin.cookie,
    });
    expect(after.json<{ state: string }>().state).toBe("CADASTRADA");
  });
});
