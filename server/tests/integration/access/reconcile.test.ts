import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileInstance } from "../../../src/modules/access-projection/reconcile.js";
import { readMemberState } from "../../../src/modules/access-projection/source.js";
import { enqueueSyncJob } from "../../../src/modules/access-projection/sync.js";
import {
  createProductSession,
  upsertMember,
} from "../../../src/modules/access-projection/writer.js";
import { validateInstanceSession } from "../../../src/modules/access-projection/validate.js";
import { newId, uuidToBin } from "../../../src/platform/ids.js";
import { processDueJobs } from "../../../src/worker/jobs/access-sync.js";
import { F01TestEnv, type TestInstance } from "../../support/f01.js";

let env: F01TestEnv;
let a: TestInstance;

beforeAll(async () => {
  env = await F01TestEnv.create();
  a = await env.createInstance("ref-a");
});
afterAll(async () => {
  await env?.cleanup();
});

describe("reconciliação da projeção (FR-033)", () => {
  it("corrige réplica adulterada a favor da fonte, conta divergências e registra", async () => {
    const revokedAccount = await env.insertAccount();
    const revokedId = await env.insertMembership(revokedAccount.id, a.id, "colaborador");
    const staleAccount = await env.insertAccount();
    const staleId = await env.insertMembership(staleAccount.id, a.id, "colaborador");
    for (const id of [revokedId, staleId]) {
      const state = await readMemberState(env.ctx, id);
      if (state) await upsertMember(env.ctx, a, state);
    }
    // Vínculo revogado na fonte, com sessão aberta na réplica.
    const revokedState = await readMemberState(env.ctx, revokedId);
    if (!revokedState) throw new Error("vínculo ausente");
    const session = await createProductSession(env.ctx, a, revokedState);
    await sql`UPDATE membership SET status = 'revogado', version = 2
               WHERE id = ${uuidToBin(revokedId)}`.execute(env.ctx.identity);
    // Senha trocada na fonte, réplica com revisão antiga.
    await sql`UPDATE account SET auth_revision = 5 WHERE id = ${uuidToBin(staleAccount.id)}`.execute(
      env.ctx.identity,
    );
    // Réplica adulterada por fora do Core: versão inflada e membro inexistente na fonte.
    const tamper = await env.mysql.connect("provisioner", a.accessDatabaseName);
    await tamper.query(
      "UPDATE access_member SET version = 99, role = 'administrador' WHERE membership_id = ?",
      [uuidToBin(staleId)],
    );
    const orphan = newId();
    await tamper.query(
      `INSERT INTO access_member (membership_id, account_id, display_name, role, status,
         account_status, account_auth_revision, version, updated_at)
       VALUES (?, ?, 'Intruso', 'administrador', 'ativo', 'ativa', 1, 1, UTC_TIMESTAMP(6))`,
      [uuidToBin(orphan), uuidToBin(newId())],
    );

    const db = env.ctx.access(a.accessDatabaseName);
    expect(await validateInstanceSession(db, session.token, env.clock.now())).not.toBeNull();

    const result = await reconcileInstance(env.ctx, a);
    expect(result.divergences).toBe(3);
    expect(await validateInstanceSession(db, session.token, env.clock.now())).toBeNull();

    const { rows } = await sql<{
      membership_id: Buffer;
      status: string;
      role: string;
      account_auth_revision: number;
      version: number;
    }>`
      SELECT membership_id, status, role, account_auth_revision, version FROM access_member`.execute(
      db,
    );
    const byId = new Map(rows.map((r) => [r.membership_id.toString("hex"), r]));
    expect(byId.get(uuidToBin(revokedId).toString("hex"))?.status).toBe("revogado");
    expect(byId.get(uuidToBin(staleId).toString("hex"))).toMatchObject({
      role: "colaborador",
      account_auth_revision: 5,
      version: 1,
    });
    expect(byId.get(uuidToBin(orphan).toString("hex"))?.status).toBe("revogado");

    expect((await reconcileInstance(env.ctx, a)).divergences).toBe(0);

    const events = await sql<{ type: string; detail: unknown }>`
      SELECT type, detail FROM security_event WHERE type = 'projecao_reconciliada'`.execute(
      env.ctx.identity,
    );
    expect(events.rows).toHaveLength(2);
  });

  it("também roda como tarefa do trabalhador", async () => {
    await enqueueSyncJob(env.ctx, a.id, "reconciliar", {});
    expect(await processDueJobs(env.ctx)).toBe(1);
    const { rows } = await sql<{ status: string }>`
      SELECT status FROM access_sync_job WHERE kind = 'reconciliar'`.execute(env.ctx.core);
    expect(rows.map((r) => r.status)).toEqual(["concluido"]);
  });
});
