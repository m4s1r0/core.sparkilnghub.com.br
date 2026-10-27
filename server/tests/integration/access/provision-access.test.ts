import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../../src/platform/ids.js";
import { applyArtifact } from "../../../src/platform/migrations/apply-artifact.js";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { readHistory } from "../../../src/platform/migrations/migrator.js";
import { referenceProductDir } from "../../../src/platform/paths.js";
import { MysqlTestContext } from "../../support/mysql.js";

let ctx: MysqlTestContext;

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy((error) =>
    /ACCESS_DENIED|ER_DBACCESS_DENIED|ER_TABLEACCESS_DENIED|ER_COLUMNACCESS_DENIED/.test(
      String((error as { code?: string }).code),
    ),
  );

async function provision() {
  const uuid = newId();
  const applied = await applyArtifact(ctx.config, await loadManifest(referenceProductDir), {
    instanceUuid: uuid,
    synthetic: true,
  });
  ctx.trackInstanceDatabase(applied.database);
  ctx.trackInstanceDatabase(applied.accessDatabase);
  ctx.trackUser(applied.user);
  if (!applied.password) throw new Error("usuário da instância deveria ser novo");
  return { uuid, ...applied, password: applied.password };
}

let a: Awaited<ReturnType<typeof provision>>;
let b: Awaited<ReturnType<typeof provision>>;

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
  a = await provision();
  b = await provision();
});
afterAll(async () => {
  await ctx?.cleanup();
});

describe("banco de acesso da instância (R-07, FR-034)", () => {
  it("cria <banco>_acc com o artefato access_projection e histórico próprio", async () => {
    expect(a.accessDatabase).toBe(`${a.database}_acc`);
    const conn = await ctx.connect("provisioner", a.accessDatabase);
    const history = await readHistory(conn, "_spark_access_history");
    expect(history.map((h) => [h.version, h.artifact, h.status])).toEqual([
      [1, "access_projection", "aplicada"],
    ]);
    const [rows] = await conn.query("SELECT state, authorization_revision FROM access_instance");
    expect(rows).toEqual([{ state: "ativa", authorization_revision: 1 }]);
  });

  it("reaplicar é idempotente e mantém a linha da instância", async () => {
    const again = await applyArtifact(ctx.config, await loadManifest(referenceProductDir), {
      instanceUuid: a.uuid,
      synthetic: true,
    });
    expect(again.accessDatabase).toBe(a.accessDatabase);
    expect(again.password).toBeNull();
    const conn = await ctx.connect("provisioner", a.accessDatabase);
    const [rows] = await conn.query("SELECT COUNT(*) AS n FROM access_instance");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("spark_access_writer: DML no banco de acesso e nada no banco operacional", async () => {
    const writer = await ctx.connect("access", a.accessDatabase);
    await writer.query("SELECT COUNT(*) FROM access_session");
    await writer.query(
      "INSERT INTO access_session_logout (id_hash, ended_at) VALUES (REPEAT('a', 64), UTC_TIMESTAMP(6))",
    );
    await writer.query("DELETE FROM access_session_logout");
    await denied(writer.query(`SELECT * FROM \`${a.database}\`.ref_item`));
    await denied(writer.query("CREATE TABLE intrusa (id INT)"));
  });

  it("usuário da instância: lê a projeção e só insere logout", async () => {
    const inst = await ctx.connectAs(a.user, a.password, a.accessDatabase);
    await inst.query("SELECT * FROM access_session");
    await inst.query("SELECT * FROM access_member");
    await inst.query("SELECT * FROM access_instance");
    await inst.query(
      "INSERT INTO access_session_logout (id_hash, ended_at) VALUES (REPEAT('b', 64), UTC_TIMESTAMP(6))",
    );
    await denied(
      inst.query(
        `INSERT INTO access_session (id_hash, account_id, membership_id, created_at, last_seen_at,
           expires_at, idle_timeout_seconds, auth_revision)
         VALUES (REPEAT('c', 64), UNHEX(REPEAT('0', 32)), UNHEX(REPEAT('0', 32)), NOW(6), NOW(6),
           NOW(6), 7200, 1)`,
      ),
    );
    await denied(inst.query("UPDATE access_session SET ended_at = NULL"));
    await denied(inst.query("UPDATE access_session SET expires_at = NOW(6)"));
    await denied(inst.query("DELETE FROM access_session_logout"));
    await denied(inst.query("UPDATE access_session_logout SET ended_at = NOW(6)"));
    await denied(inst.query("UPDATE access_member SET status = 'ativo'"));
    await denied(inst.query("UPDATE access_instance SET state = 'ativa'"));
    await denied(inst.query("DELETE FROM access_member"));
  });

  it("instâncias não enxergam o banco de acesso uma da outra", async () => {
    const instA = await ctx.connectAs(a.user, a.password);
    await denied(instA.query(`SELECT * FROM \`${b.accessDatabase}\`.access_session`));
    await denied(instA.query(`SELECT * FROM \`${b.database}\`.ref_item`));
  });
});
