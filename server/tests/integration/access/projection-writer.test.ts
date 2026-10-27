import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMemberState } from "../../../src/modules/access-projection/source.js";
import { syncToInstances } from "../../../src/modules/access-projection/sync.js";
import {
  createProductSession,
  revokeMember,
  updateAccountState,
  upsertMember,
} from "../../../src/modules/access-projection/writer.js";
import { sha256Hex } from "../../../src/platform/crypto/index.js";
import { binToUuid, uuidToBin } from "../../../src/platform/ids.js";
import { serverRoot } from "../../../src/platform/paths.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";

let env: F01TestEnv;
let a: TestInstance;
let b: TestInstance;

beforeAll(async () => {
  env = await F01TestEnv.create();
  a = await env.createInstance("ref-a");
  b = await env.createInstance("ref-b");
});
afterAll(async () => {
  await env?.cleanup();
});

async function member(
  instance: TestInstance,
  role: "administrador" | "colaborador" = "colaborador",
) {
  const account = await env.insertAccount();
  const membershipId = await env.insertMembership(account.id, instance.id, role);
  const state = await readMemberState(env.ctx, membershipId);
  if (!state) throw new Error("vínculo ausente");
  return { account, membershipId, state };
}

const sessions = (instance: TestInstance) =>
  sql<{
    id_hash: string;
    membership_id: Buffer;
    ended_at: Date | null;
    end_reason: string | null;
    expires_at: Date;
    auth_revision: number;
  }>`SELECT id_hash, membership_id, ended_at, end_reason, expires_at, auth_revision
       FROM access_session`
    .execute(env.ctx.access(instance.accessDatabaseName))
    .then((r) => r.rows);

const members = (instance: TestInstance) =>
  sql<{
    membership_id: Buffer;
    status: string;
    role: string;
    version: number;
    account_status: string;
    account_auth_revision: number;
  }>`SELECT membership_id, status, role, version, account_status, account_auth_revision
       FROM access_member`
    .execute(env.ctx.access(instance.accessDatabaseName))
    .then((r) => r.rows);

describe("escrita da projeção de acesso (D-04, FR-026, FR-027)", () => {
  it("sessão gravada só no banco de acesso da instância; token devolvido é o que gera o id_hash", async () => {
    const { state } = await member(a);
    const created = await createProductSession(env.ctx, a, state);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const inA = await sessions(a);
    expect(inA.map((s) => s.id_hash)).toContain(sha256Hex(created.token));
    expect(JSON.stringify(inA)).not.toContain(created.token);
    expect((await sessions(b)).map((s) => s.id_hash)).not.toContain(sha256Hex(created.token));
    const session = inA.find((s) => s.id_hash === sha256Hex(created.token));
    expect(session?.expires_at.getTime()).toBe(env.clock.now().getTime() + 12 * 3600_000);
  });

  it("réplica de vínculo respeita a versão: versão antiga não sobrescreve a nova", async () => {
    const { state } = await member(a);
    await upsertMember(env.ctx, a, { ...state, role: "administrador", version: 3 });
    await upsertMember(env.ctx, a, { ...state, role: "colaborador", version: 2 });
    const row = (await members(a)).find((m) => binToUuid(m.membership_id) === state.membershipId);
    expect(row).toMatchObject({ role: "administrador", version: 3 });
  });

  it("não replica e-mail nem dados de outras instâncias (FR-026)", async () => {
    const { account, state } = await member(a);
    await upsertMember(env.ctx, a, state);
    const conn = await env.mysql.connect("provisioner", a.accessDatabaseName);
    const [rows] = await conn.query("SELECT * FROM access_member");
    expect(JSON.stringify(rows)).not.toContain(account.email);
  });

  it("revogar vínculo encerra só as sessões dele (vinculo_revogado)", async () => {
    const one = await member(a);
    const other = await member(a);
    const s1 = await createProductSession(env.ctx, a, one.state);
    const s2 = await createProductSession(env.ctx, a, other.state);
    await revokeMember(env.ctx, a, { ...one.state, status: "revogado", version: 2 });
    const all = await sessions(a);
    expect(all.find((s) => s.id_hash === sha256Hex(s1.token))).toMatchObject({
      end_reason: "vinculo_revogado",
    });
    expect(all.find((s) => s.id_hash === sha256Hex(s2.token))?.ended_at).toBeNull();
    const row = (await members(a)).find((m) => binToUuid(m.membership_id) === one.membershipId);
    expect(row?.status).toBe("revogado");
  });

  it("estado da conta atualiza todas as instâncias onde ela tem vínculo", async () => {
    const account = await env.insertAccount();
    const ma = await env.insertMembership(account.id, a.id, "colaborador");
    const mb = await env.insertMembership(account.id, b.id, "colaborador");
    for (const [instance, id] of [
      [a, ma],
      [b, mb],
    ] as const) {
      const state = await readMemberState(env.ctx, id);
      if (state) await createProductSession(env.ctx, instance, state);
    }
    const outcome = await syncToInstances(env.ctx, [a, b], {
      kind: "revogar_sessoes_conta",
      payload: { accountId: account.id, reason: "senha_trocada" },
      apply: (instance) =>
        updateAccountState(
          env.ctx,
          instance,
          { accountId: account.id, status: "ativa", authRevision: 2 },
          "senha_trocada",
        ),
    });
    expect(outcome.instances.map((i) => i.status)).toEqual(["aplicada", "aplicada"]);
    for (const [instance, id] of [
      [a, ma],
      [b, mb],
    ] as const) {
      const row = (await members(instance)).find((m) => binToUuid(m.membership_id) === id);
      expect(row?.account_auth_revision).toBe(2);
      const own = (await sessions(instance)).filter((s) => binToUuid(s.membership_id) === id);
      expect(own.every((s) => s.end_reason === "senha_trocada")).toBe(true);
    }
  });

  it("instância inacessível → pendência persistente e resultado `pendente`", async () => {
    const { state } = await member(b);
    await env.setWriterAccess(b, false);
    try {
      const fresh = env.freshContext();
      const outcome = await syncToInstances(fresh, [a, b], {
        kind: "replicar_vinculo",
        payload: { membershipId: state.membershipId },
        apply: (instance) => upsertMember(fresh, instance, state),
      });
      expect(outcome.instances).toEqual([
        { instanceId: a.id, status: "aplicada" },
        { instanceId: b.id, status: "pendente" },
      ]);
      const { rows } = await sql<{ status: string; kind: string; instance_id: Buffer }>`
        SELECT status, kind, instance_id FROM access_sync_job`.execute(env.ctx.core);
      expect(rows.map((r) => [binToUuid(r.instance_id), r.kind, r.status])).toContainEqual([
        b.id,
        "replicar_vinculo",
        "pendente",
      ]);
    } finally {
      await env.setWriterAccess(b, true);
    }
  });

  it("conexão reaproveitada (T-04): conexões de A e B nunca trocam de banco", async () => {
    const seen: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const instance = i % 2 === 0 ? a : b;
      const { rows } = await sql<{ db: string }>`SELECT DATABASE() AS db`.execute(
        env.ctx.access(instance.accessDatabaseName),
      );
      if (rows[0]?.db !== instance.accessDatabaseName) seen.push(`${i}:${rows[0]?.db}`);
    }
    expect(seen).toEqual([]);
    const source = readFileSync(
      join(serverRoot, "src", "modules", "access-projection", "writer.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/\bUSE\s+`?\w/i);
  });

  it("id do vínculo da réplica é o da fonte", async () => {
    const { membershipId, state } = await member(a, "administrador");
    await upsertMember(env.ctx, a, state);
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_member
       WHERE membership_id = ${uuidToBin(membershipId)} AND role = 'administrador'`.execute(
      env.ctx.access(a.accessDatabaseName),
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });
});
