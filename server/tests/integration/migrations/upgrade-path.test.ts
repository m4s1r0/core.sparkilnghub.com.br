import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { migrate } from "../../../src/platform/migrations/migrator.js";
import { accessProjectionDir, migrationsDir, tuteliProductDir } from "../../../src/platform/paths.js";
import { checkUpgradePath, compareStructures } from "../../../../scripts/lib/upgrade.js";
import { MysqlTestContext } from "../../support/mysql.js";

let ctx: MysqlTestContext;

/** Cópia do artefato real truncada nas primeiras `versions` versões (revisão base simulada). */
function truncated(dir: string, versions: number): string {
  const target = mkdtempSync(join(tmpdir(), "base-"));
  cpSync(dir, target, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")) as {
    migrations: unknown[];
  };
  manifest.migrations = manifest.migrations.slice(0, versions);
  writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest));
  return target;
}

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});
afterAll(async () => {
  await ctx?.cleanup();
});

describe("migração a partir da versão anterior (FR-017, CS-005)", () => {
  it("Tuteli v11 → v12 preserva autorizações e equivale à instalação nova", async () => {
    const base = await loadManifest(truncated(tuteliProductDir, 11));
    const current = await loadManifest(tuteliProductDir);
    const result = await checkUpgradePath(ctx, "tuteli", base, current);
    expect(result.baseVersions).toBe(11);
    expect(result.currentVersions).toBe(12);
    expect(result.differences).toEqual([]);

    const db = await ctx.createDatabase("tuteli_v12_data");
    const conn = await ctx.connect("test", db);
    await migrate(conn, base, { appliedBy: "teste" });
    await conn.query(`INSERT INTO tutor
      (id, nome, telefone_normalizado, created_at, updated_at)
      VALUES (UNHEX('00000000000040008000000000000001'), 'Tutor', '123', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`);
    await conn.query(`INSERT INTO autorizado_retirada
      (id, tutor_id, nome, evidencia_autorizacao, created_by, created_at)
      VALUES (UNHEX('00000000000040008000000000000002'), UNHEX('00000000000040008000000000000001'),
              'Contato', 'Telefone', UNHEX('00000000000040008000000000000003'), UTC_TIMESTAMP(6))`);
    await migrate(conn, current, { appliedBy: "teste" });
    const [rows] = await conn.query("SELECT nome, version FROM autorizado_retirada");
    expect(rows).toEqual([{ nome: "Contato", version: 1 }]);
    await expect(conn.query("UPDATE autorizado_retirada SET version = 0")).rejects.toThrow();
  });

  it("spark_core: base v1 + atual é igual à atual do zero", async () => {
    const current = await loadManifest(migrationsDir("spark_core"));
    const base = await loadManifest(truncated(migrationsDir("spark_core"), 1));
    const result = await checkUpgradePath(ctx, "core", base, current);
    expect(result.baseVersions).toBe(1);
    expect(result.differences).toEqual([]);
  });

  it("projeção de acesso: base v1 + v2 é igual à atual do zero (F02)", async () => {
    const current = await loadManifest(accessProjectionDir);
    const base = await loadManifest(truncated(accessProjectionDir, 1));
    const result = await checkUpgradePath(ctx, "access", base, current);
    expect(result.currentVersions).toBeGreaterThanOrEqual(2);
    expect(result.differences).toEqual([]);
  });

  it("spark_core v3 → v4 incorpora as instâncias sintéticas de F01 (R-18, FR-044)", async () => {
    const v3 = await loadManifest(truncated(migrationsDir("spark_core"), 3));
    const current = await loadManifest(migrationsDir("spark_core"));
    const withSynthetic = await ctx.createDatabase("upgrade_f01_data");
    const conn = await ctx.connect("test", withSynthetic);
    await migrate(conn, v3, { appliedBy: "teste" });
    await conn.query(
      `INSERT INTO instance_ref (id, product_code, slug, display_name, database_name,
                                 access_database_name, authorization_revision, synthetic, created_at)
       VALUES (UNHEX('0192f60000007000800000000000000a'), 'sparkref', 'ref-a', 'A',
               'sparkref_x', 'sparkref_x_acc', 3, TRUE, UTC_TIMESTAMP(6))`,
    );
    await migrate(conn, current, { appliedBy: "teste" });
    const [instances] = await conn.query(
      "SELECT state, authorization_revision, HEX(contractor_id) AS contractor FROM instance",
    );
    expect(instances).toEqual([
      { state: "ATIVA", authorization_revision: 3, contractor: "0192F6000000700080000000000000C1" },
    ]);
    const [products] = await conn.query("SELECT code FROM product ORDER BY code");
    expect(products).toEqual([{ code: "sparkpet" }, { code: "sparkref" }]);
    const [transitions] = await conn.query(
      "SELECT from_state, to_state, actor_kind, reason FROM instance_transition",
    );
    expect(transitions).toEqual([
      { from_state: null, to_state: "ATIVA", actor_kind: "sistema", reason: "migracao_f01" },
    ]);

    // Sem instâncias sintéticas (produção): só o Tuteli no catálogo, nenhum contratante.
    const empty = await ctx.createDatabase("upgrade_f01_empty");
    const emptyConn = await ctx.connect("test", empty);
    await migrate(emptyConn, v3, { appliedBy: "teste" });
    await migrate(emptyConn, current, { appliedBy: "teste" });
    const [onlyPet] = await emptyConn.query("SELECT code FROM product");
    expect(onlyPet).toEqual([{ code: "sparkpet" }]);
    const [contractors] = await emptyConn.query("SELECT COUNT(*) AS n FROM contractor");
    expect(Number((contractors as { n: number }[])[0]?.n)).toBe(0);
  });

  it("sem migrações na base (primeira versão) passa trivialmente", async () => {
    const current = await loadManifest(migrationsDir("spark_identity"));
    const result = await checkUpgradePath(ctx, "identity", null, current);
    expect(result.differences).toEqual([]);
    expect(result.baseVersions).toBe(0);
  });

  it("estrutura diferente falha indicando a tabela", async () => {
    const a = await ctx.createDatabase("diff_a");
    const b = await ctx.createDatabase("diff_b");
    const connA = await ctx.connect("test", a);
    const connB = await ctx.connect("test", b);
    await connA.query("CREATE TABLE item (id INT PRIMARY KEY, nome VARCHAR(10))");
    await connB.query("CREATE TABLE item (id INT PRIMARY KEY, nome VARCHAR(20))");
    await connA.query("CREATE TABLE igual (id INT PRIMARY KEY)");
    await connB.query("CREATE TABLE igual (id INT PRIMARY KEY)");
    expect(
      await compareStructures(
        { connection: connA, database: a },
        { connection: connB, database: b },
      ),
    ).toEqual(["item"]);
  });
});
