import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  ProductHttpResponse,
  ReferenceProductClient,
} from "../../../reference-product/client.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let b: TestInstance;
let productA: ReferenceProductClient;
let productB: ReferenceProductClient;
let anaToken: string;
let carlaToken: string;
let brunoToken: string;
let carlaMembership: string;
let brunoMembership: string;

const check = (operationId: string, response: ProductHttpResponse) => {
  expectMatchesContract(operationId, response.status, response.body);
  return response;
};

async function tokenFor(product: ReferenceProductClient, email: string, password: string) {
  const response = await product.login(email, password, "198.51.100.40");
  if (response.status !== 201) throw new Error(`login ${response.status}`);
  return (response.body as { token: string }).token;
}

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
  const credential = await appCredential(env);
  productA = await productFor(env, app, a, credential);
  productB = await productFor(env, app, b, credential);
  const ana = await env.insertAccount({ displayName: "[SINTÉTICO] Ana" });
  const carla = await env.insertAccount({ displayName: "[SINTÉTICO] Carla" });
  const bruno = await env.insertAccount({ displayName: "[SINTÉTICO] Bruno" });
  await env.insertMembership(ana.id, a.id, "administrador");
  carlaMembership = await env.insertMembership(carla.id, a.id, "colaborador");
  brunoMembership = await env.insertMembership(bruno.id, b.id, "administrador");
  anaToken = await tokenFor(productA, ana.email, ana.password);
  carlaToken = await tokenFor(productA, carla.email, carla.password);
  brunoToken = await tokenFor(productB, bruno.email, bruno.password);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const key = () => ({ "idempotency-key": crypto.randomUUID() });

describe("vínculos locais pelo produto (SP-005, COM-012)", () => {
  it("administrador local lista só A, sem e-mail de membros ativos", async () => {
    const response = check("listLocalMembers", await productA.members(anaToken, "GET", "/members"));
    expect(response.status).toBe(200);
    const items = (
      response.body as { items: { displayName: string; emailMasked: string | null }[] }
    ).items;
    expect(items.map((i) => i.displayName).sort()).toEqual([
      "[SINTÉTICO] Ana",
      "[SINTÉTICO] Carla",
    ]);
    expect(items.every((i) => i.emailMasked === null)).toBe(true);
  });

  it("colaborador → 403; sessão inválida → 401", async () => {
    const forbidden = check(
      "listLocalMembers",
      await productA.members(carlaToken, "GET", "/members"),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toMatchObject({ error: { code: "AUTH_FORBIDDEN" } });
    expect((await productA.members("x".repeat(43), "GET", "/members")).status).toBe(401);
    // Token de B apresentado em A.
    expect((await productA.members(brunoToken, "GET", "/members")).status).toBe(401);
  });

  it("convidar exige Idempotency-Key; o convite fica pendente em A", async () => {
    const noKey = await productA.members(anaToken, "POST", "/invitations", {
      email: "dora@example.test",
      role: "colaborador",
    });
    expect(noKey.status).toBe(422);
    const created = check(
      "inviteLocalMember",
      await productA.members(
        anaToken,
        "POST",
        "/invitations",
        { email: "dora@example.test", role: "colaborador" },
        key(),
      ),
    );
    expect(created.status).toBe(201);
    const list = await productA.members(anaToken, "GET", "/members");
    const pending = (
      list.body as { items: { status: string; emailMasked: string | null }[] }
    ).items.find((i) => i.status === "convite_pendente");
    expect(pending?.emailMasked).toBe("d***@example.test");
  });

  it("mudar papel e revogar em A; vínculo de B → 404 sem revelar B", async () => {
    const role = check(
      "changeLocalMemberRole",
      await productA.members(
        anaToken,
        "POST",
        `/members/${carlaMembership}/role`,
        { role: "administrador", reason: "promoção local", version: 1 },
        key(),
      ),
    );
    expect(role.body).toEqual({ instances: [{ instanceId: a.id, status: "aplicada" }] });

    const fromB = check(
      "changeLocalMemberRole",
      await productA.members(
        anaToken,
        "POST",
        `/members/${brunoMembership}/role`,
        { role: "colaborador", reason: "tentativa", version: 1 },
        key(),
      ),
    );
    expect(fromB.status).toBe(404);
    const revokeB = check(
      "revokeLocalMember",
      await productA.members(
        anaToken,
        "POST",
        `/members/${brunoMembership}/revoke`,
        { reason: "tentativa", version: 1 },
        key(),
      ),
    );
    expect(revokeB.status).toBe(404);

    const revoked = check(
      "revokeLocalMember",
      await productA.members(
        anaToken,
        "POST",
        `/members/${carlaMembership}/revoke`,
        { reason: "saiu", version: 2 },
        key(),
      ),
    );
    expect(revoked.status).toBe(200);
    expect(await productA.validate(carlaToken, env.clock.now())).toBeNull();
    expect(await productB.validate(brunoToken, env.clock.now())).not.toBeNull();
  });

  it("revogar convite: de A funciona; de B → 404", async () => {
    await productB.members(
      brunoToken,
      "POST",
      "/invitations",
      { email: "eli@example.test", role: "colaborador" },
      key(),
    );
    const { rows } = await sql<{ id: Buffer; instance_id: Buffer }>`
      SELECT id, instance_id FROM invitation WHERE status = 'pendente'`.execute(env.ctx.identity);
    const ofA = rows.find((r) => r.instance_id.equals(uuidToBin(a.id)));
    const ofB = rows.find((r) => r.instance_id.equals(uuidToBin(b.id)));
    const hex = (id: Buffer) => {
      const h = id.toString("hex");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    };
    const otherInstance = check(
      "revokeLocalInvitation",
      await productA.members(
        anaToken,
        "POST",
        `/invitations/${hex(ofB?.id ?? Buffer.alloc(16))}/revoke`,
        {
          reason: "tentativa",
        },
      ),
    );
    expect(otherInstance.status).toBe(404);
    const own = check(
      "revokeLocalInvitation",
      await productA.members(
        anaToken,
        "POST",
        `/invitations/${hex(ofA?.id ?? Buffer.alloc(16))}/revoke`,
        {
          reason: "desistiu",
        },
      ),
    );
    expect(own.status).toBe(204);
  });

  it("consultar vínculos não dá papel em A ao administrador da plataforma (COM-010)", async () => {
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM membership m
       JOIN platform_role p ON p.account_id = m.account_id
      WHERE m.instance_id = ${uuidToBin(a.id)}`.execute(env.ctx.identity);
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
