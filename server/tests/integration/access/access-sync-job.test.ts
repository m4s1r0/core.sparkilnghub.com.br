import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueSyncJob } from "../../../src/modules/access-projection/sync.js";
import { binToUuid, uuidToBin } from "../../../src/platform/ids.js";
import { processDueJobs } from "../../../src/worker/jobs/access-sync.js";
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
beforeEach(async () => {
  await sql`DELETE FROM access_sync_job`.execute(env.ctx.core);
});

interface JobRow {
  status: string;
  attempts: number;
  next_attempt_at: Date;
  last_error: string | null;
  instance_id: Buffer;
}
const jobs = () =>
  sql<JobRow>`SELECT status, attempts, next_attempt_at, last_error, instance_id
                FROM access_sync_job ORDER BY created_at`
    .execute(env.ctx.core)
    .then((r) => r.rows);

const snapshot = async (instance: TestInstance) => {
  const db = env.ctx.access(instance.accessDatabaseName);
  const [m, s] = await Promise.all([
    sql`SELECT * FROM access_member ORDER BY membership_id`.execute(db),
    sql`SELECT * FROM access_session ORDER BY id_hash`.execute(db),
  ]);
  return JSON.stringify([m.rows, s.rows]);
};

const replicated = async (instance: TestInstance, membershipId: string) => {
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM access_member
     WHERE membership_id = ${uuidToBin(membershipId)}`.execute(
    env.ctx.access(instance.accessDatabaseName),
  );
  return Number(rows[0]?.n);
};

describe("tarefa de sincronização da projeção (R-10, FR-027)", () => {
  it("instância sem acesso → pendente com repetição; acesso restaurado → concluída sem duplicar", async () => {
    const account = await env.insertAccount();
    const membershipId = await env.insertMembership(account.id, b.id, "colaborador");
    await enqueueSyncJob(env.ctx, b.id, "replicar_vinculo", { membershipId });

    await env.setWriterAccess(b, false);
    try {
      expect(await processDueJobs(env.freshContext())).toBe(1);
    } finally {
      await env.setWriterAccess(b, true);
    }
    let [job] = await jobs();
    expect(job).toMatchObject({ status: "pendente", attempts: 1 });
    expect(job?.last_error).toMatch(/^ER_/);
    expect(job?.next_attempt_at.getTime()).toBeGreaterThan(env.clock.now().getTime());
    // Antes do próximo horário, nada é processado.
    expect(await processDueJobs(env.freshContext())).toBe(0);

    env.clock.advance(60 * 60_000);
    expect(await processDueJobs(env.freshContext())).toBe(1);
    [job] = await jobs();
    expect(job).toMatchObject({ status: "concluido", attempts: 2 });
    expect(await replicated(b, membershipId)).toBe(1);
    expect(await processDueJobs(env.freshContext())).toBe(0);
    expect(await replicated(b, membershipId)).toBe(1);
  });

  it("tarefa de outra instância (T-04): processar A deixa B idêntico", async () => {
    const account = await env.insertAccount();
    const membershipId = await env.insertMembership(account.id, a.id, "colaborador");
    const before = await snapshot(b);
    await enqueueSyncJob(env.ctx, a.id, "replicar_vinculo", { membershipId });
    await processDueJobs(env.ctx);
    expect(await snapshot(b)).toBe(before);
    expect(await replicated(a, membershipId)).toBe(1);
  });

  it("payload que cita outra instância é recusado (falhou) sem efeito", async () => {
    const account = await env.insertAccount();
    const membershipOfB = await env.insertMembership(account.id, b.id, "colaborador");
    const beforeA = await snapshot(a);
    const beforeB = await snapshot(b);
    await enqueueSyncJob(env.ctx, a.id, "replicar_vinculo", {
      membershipId: membershipOfB,
      instanceId: b.id,
    });
    await enqueueSyncJob(env.ctx, a.id, "replicar_vinculo", { membershipId: membershipOfB });
    await processDueJobs(env.ctx);
    const rows = await jobs();
    expect(rows.map((r) => [binToUuid(r.instance_id), r.status])).toEqual([
      [a.id, "falhou"],
      [a.id, "falhou"],
    ]);
    expect(await snapshot(a)).toBe(beforeA);
    expect(await snapshot(b)).toBe(beforeB);
  });

  it("lease vencido é retomado", async () => {
    const account = await env.insertAccount();
    const membershipId = await env.insertMembership(account.id, a.id, "colaborador");
    await enqueueSyncJob(env.ctx, a.id, "replicar_vinculo", { membershipId });
    await sql`UPDATE access_sync_job SET status = 'em_execucao', attempts = 1,
                lease_until = ${new Date(env.clock.now().getTime() - 1000)}`.execute(env.ctx.core);
    expect(await processDueJobs(env.ctx)).toBe(1);
    expect((await jobs())[0]).toMatchObject({ status: "concluido", attempts: 2 });
  });
});
