import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { migrationsDir } from "../../../src/platform/paths.js";
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
  it("spark_core: base v1 + atual é igual à atual do zero", async () => {
    const current = await loadManifest(migrationsDir("spark_core"));
    const base = await loadManifest(truncated(migrationsDir("spark_core"), 1));
    const result = await checkUpgradePath(ctx, "core", base, current);
    expect(result.baseVersions).toBe(1);
    expect(result.differences).toEqual([]);
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
