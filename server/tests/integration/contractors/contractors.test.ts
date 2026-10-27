import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidToBin } from "../../../src/platform/ids.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-contratantes@example.test");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const checked = <R extends { statusCode: number; body: string }>(operation: string, r: R): R => {
  expectMatchesContract(operation, r.statusCode, bodyOf(r));
  return r;
};

interface Contractor {
  id: string;
  legalName: string;
  displayName: string;
  document: string | null;
  status: string;
  version: number;
}

const base = {
  legalName: "Pet Feliz Comércio de Rações Ltda",
  displayName: "Pet Feliz",
  personType: "juridica",
  contactName: "Fernanda Souza",
  email: "contato@petfeliz.example.test",
};

const create = (payload: Record<string, unknown>, key: string = crypto.randomUUID()) =>
  flow
    .request("POST", "/api/v1/contractors", {
      cookie: admin.cookie,
      payload,
      headers: { "idempotency-key": key },
    })
    .then((r) => checked("createContractor", r));

async function audit(objectId: string) {
  const { rows } = await sql<{ action: string; changes: unknown }>`
    SELECT action, changes FROM core_audit_event WHERE object_id = ${objectId}
     ORDER BY created_at, id`.execute(env.ctx.core);
  return rows;
}

describe("contratantes (US1, SC-003 a SC-006)", () => {
  let petFeliz: Contractor;

  it("cria com campos obrigatórios e opcionais, ativo, versão 1 e auditoria", async () => {
    const response = await create({
      ...base,
      document: "11.222.333/0001-81",
      phone: "(11) 98765-4321",
      address: { cep: "01310100", cidade: "São Paulo", uf: "SP" },
    });
    expect(response.statusCode).toBe(201);
    petFeliz = response.json<Contractor>();
    expect(petFeliz).toMatchObject({
      legalName: base.legalName,
      document: "11222333000181",
      status: "ativo",
      version: 1,
    });
    expect(response.json<{ phone: string }>().phone).toBe("11987654321");
    expect((await audit(petFeliz.id)).map((r) => r.action)).toEqual(["contratante.criado"]);
  });

  it("mesma chave de idempotência devolve o mesmo contratante", async () => {
    const key = crypto.randomUUID();
    const payload = { ...base, legalName: "Mesma Chave Ltda", email: "x@example.test" };
    const first = await create(payload, key);
    const second = await create(payload, key);
    expect(second.json<Contractor>().id).toBe(first.json<Contractor>().id);
  });

  it("documento repetido → 409 com o existente; e-mail repetido é permitido", async () => {
    const duplicated = await create({
      ...base,
      legalName: "Outra Razão",
      document: "11222333000181",
    });
    expect(duplicated.statusCode).toBe(409);
    const error = duplicated.json<{
      error: { code: string; field: string; details: { code: string }[] };
    }>().error;
    expect(error.code).toBe("CONFLICT_DOCUMENT_TAKEN");
    expect(error.field).toBe("/document");
    expect(error.details[0]?.code).toBe(petFeliz.id);

    const sameEmail = await create({ ...base, legalName: "Mesmo E-mail Ltda" });
    expect(sameEmail.statusCode).toBe(201);
  });

  it("documento inválido, tipo errado, telefone e UF inválidos → 422 no campo", async () => {
    const invalid = [
      [{ document: "11.222.333/0001-80" }, "/document"],
      [{ personType: "fisica", document: "11.222.333/0001-81" }, "/document"],
      [{ phone: "123" }, "/phone"],
      [{ address: { uf: "XX" } }, "/address/uf"],
    ] as const;
    for (const [patch, field] of invalid) {
      const response = await create({ ...base, ...patch });
      expect(response.statusCode).toBe(422);
      expect(response.json<{ error: { field: string } }>().error.field).toBe(field);
    }
  });

  it("possíveis homônimos por nome e por documento, até 10, sem fundir", async () => {
    const response = checked(
      "findSimilarContractors",
      await flow.request(
        "GET",
        `/api/v1/contractors/similar?legalName=${encodeURIComponent("PET FELIZ COMÉRCIO DE RAÇÕES")}`,
        { cookie: admin.cookie },
      ),
    );
    const items = response.json<{ items: { id: string; match: string }[] }>().items;
    expect(items.map((i) => i.id)).toContain(petFeliz.id);

    // Texto com acento no campo de documento não quebra a busca (regressão: collation ASCII).
    const accented = await flow.request(
      "GET",
      `/api/v1/contractors/similar?legalName=X&document=${encodeURIComponent("Ração")}`,
      { cookie: admin.cookie },
    );
    expect(accented.statusCode).toBe(200);

    const byDocument = await flow.request(
      "GET",
      "/api/v1/contractors/similar?document=11.222.333%2F0001-81",
      { cookie: admin.cookie },
    );
    expect(byDocument.json<{ items: { id: string; match: string }[] }>().items).toEqual([
      expect.objectContaining({ id: petFeliz.id, match: "documento" }),
    ]);
  });

  it("busca paginada por nome, documento e contato, com produtos e instâncias", async () => {
    await env.insertInstanceRow({ state: "PRONTA", contractorId: petFeliz.id });
    for (const q of [
      "Pet Feliz",
      "11222333000181",
      "petfeliz.example.test",
      "Fernanda",
      "Comércio de Rações",
    ]) {
      const response = checked(
        "listContractors",
        await flow.request("GET", `/api/v1/contractors?q=${encodeURIComponent(q)}&pageSize=10`, {
          cookie: admin.cookie,
        }),
      );
      const body = response.json<{
        items: { id: string; products: string[]; instanceCount: number }[];
        pageInfo: { page: number; pageSize: number; total: number };
      }>();
      expect(body.items.find((i) => i.id === petFeliz.id)).toMatchObject({
        products: ["sparkref"],
        instanceCount: 1,
      });
      expect(body.pageInfo.pageSize).toBe(10);
    }
    const page = await flow.request("GET", "/api/v1/contractors?pageSize=1&page=2", {
      cookie: admin.cookie,
    });
    const paged = page.json<{ items: unknown[]; pageInfo: { total: number } }>();
    expect(paged.items).toHaveLength(1);
    expect(paged.pageInfo.total).toBeGreaterThanOrEqual(3);
  });

  it("edição com versão otimista; nome novo não altera instâncias (CA-SC-002)", async () => {
    const instanceId = await env.insertInstanceRow({ state: "PRONTA", contractorId: petFeliz.id });
    const before = await sql<{ slug: string; database_name: string }>`
      SELECT slug, database_name FROM instance WHERE id = ${uuidToBin(instanceId)}`.execute(
      env.ctx.core,
    );
    const update = (version: number, displayName: string) =>
      flow.request("PUT", `/api/v1/contractors/${petFeliz.id}`, {
        cookie: admin.cookie,
        payload: { ...base, document: "11222333000181", displayName, version },
      });
    const ok = checked("updateContractor", await update(petFeliz.version, "Pet Feliz Matriz"));
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Contractor>()).toMatchObject({ displayName: "Pet Feliz Matriz", version: 2 });
    const stale = checked("updateContractor", await update(petFeliz.version, "Outro nome"));
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ error: { code: string } }>().error.code).toBe("CONFLICT_VERSION");
    const after = await sql<{ slug: string; database_name: string }>`
      SELECT slug, database_name FROM instance WHERE id = ${uuidToBin(instanceId)}`.execute(
      env.ctx.core,
    );
    expect(after.rows).toEqual(before.rows);
    expect((await audit(petFeliz.id)).map((r) => r.action)).toContain("contratante.editado");
    petFeliz = ok.json<Contractor>();
  });

  it("inativar com instância ATIVA → 409 com a lista; sem ATIVA → inativo; reativar", async () => {
    const active = await env.insertInstanceRow({ state: "ATIVA", contractorId: petFeliz.id });
    const refused = checked(
      "inactivateContractor",
      await flow.request("POST", `/api/v1/contractors/${petFeliz.id}/inactivate`, {
        cookie: admin.cookie,
        payload: { reason: "encerramento do contrato", version: petFeliz.version },
      }),
    );
    expect(refused.statusCode).toBe(409);
    const error = refused.json<{ error: { code: string; details: { code: string }[] } }>().error;
    expect(error.code).toBe("CONFLICT_CONTRACTOR_HAS_ACTIVE_INSTANCES");
    expect(error.details.map((d) => d.code)).toEqual([active]);
    const unchanged = await flow.request("GET", `/api/v1/contractors/${petFeliz.id}`, {
      cookie: admin.cookie,
    });
    expect(unchanged.json<Contractor>().status).toBe("ativo");

    await sql`UPDATE instance SET state = 'SUSPENSA' WHERE id = ${uuidToBin(active)}`.execute(
      env.ctx.core,
    );
    const inactivated = checked(
      "inactivateContractor",
      await flow.request("POST", `/api/v1/contractors/${petFeliz.id}/inactivate`, {
        cookie: admin.cookie,
        payload: { reason: "encerramento do contrato", version: petFeliz.version },
      }),
    );
    expect(inactivated.json<Contractor>()).toMatchObject({ status: "inativo" });
    const reactivated = checked(
      "reactivateContractor",
      await flow.request("POST", `/api/v1/contractors/${petFeliz.id}/reactivate`, {
        cookie: admin.cookie,
        payload: { reason: "novo contrato", version: inactivated.json<Contractor>().version },
      }),
    );
    expect(reactivated.json<Contractor>().status).toBe("ativo");
    const actions = (await audit(petFeliz.id)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(["contratante.inativado", "contratante.reativado"]),
    );
  });

  it("detalhe traz as instâncias; contratante inexistente → 404; sem sessão → 401", async () => {
    const detail = checked(
      "getContractor",
      await flow.request("GET", `/api/v1/contractors/${petFeliz.id}`, { cookie: admin.cookie }),
    );
    expect(detail.json<{ instances: unknown[] }>().instances.length).toBeGreaterThanOrEqual(2);
    const missing = await flow.request("GET", `/api/v1/contractors/${crypto.randomUUID()}`, {
      cookie: admin.cookie,
    });
    expect(missing.statusCode).toBe(404);
    expect((await flow.request("GET", "/api/v1/contractors")).statusCode).toBe(401);
  });
});
