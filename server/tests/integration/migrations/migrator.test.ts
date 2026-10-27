import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EnvGuardError } from "../../../src/platform/config/env-guard.js";
import {
  loadManifest,
  MigrationError,
  normalizeSql,
  sha256,
} from "../../../src/platform/migrations/manifest.js";
import { migrate, readHistory } from "../../../src/platform/migrations/migrator.js";
import { MysqlTestContext } from "../../support/mysql.js";

let ctx: MysqlTestContext;
let artifactDir: string;

function writeArtifact(files: [name: string, sql: string][]) {
  rmSync(artifactDir, { recursive: true, force: true });
  mkdirSync(join(artifactDir, "migrations"), { recursive: true });
  const migrations = files.map(([name, sql], index) => {
    writeFileSync(join(artifactDir, "migrations", `${name}.sql`), sql);
    return {
      version: index + 1,
      name,
      file: `migrations/${name}.sql`,
      sha256: sha256(normalizeSql(Buffer.from(sql))),
    };
  });
  writeFileSync(
    join(artifactDir, "manifest.json"),
    JSON.stringify({ formatVersion: 1, artifact: "teste", migrations }),
  );
}

async function freshDatabase(suffix: string): Promise<Connection> {
  const name = await ctx.createDatabase(suffix);
  return ctx.connect("test", name);
}

const V1 = "CREATE TABLE a (id INT PRIMARY KEY);";
const V2 = "CREATE TABLE b (id INT PRIMARY KEY);\nINSERT INTO b VALUES (1);";

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});
afterAll(async () => {
  await ctx?.cleanup();
});
beforeEach(() => {
  artifactDir = mkdtempSync(join(tmpdir(), "artifact-"));
});

describe("migrate", () => {
  it("aplica do zero e registra histórico", async () => {
    writeArtifact([
      ["0001_a", V1],
      ["0002_b", V2],
    ]);
    const conn = await freshDatabase("zero");
    const result = await migrate(conn, await loadManifest(artifactDir), { appliedBy: "teste" });
    expect(result.applied).toEqual([1, 2]);
    const history = await readHistory(conn);
    expect(history.map((h) => [h.version, h.status])).toEqual([
      [1, "aplicada"],
      [2, "aplicada"],
    ]);
  });

  it("histórico com outro nome convive com o padrão no mesmo banco", async () => {
    writeArtifact([["0001_a", V1]]);
    const conn = await freshDatabase("outro_historico");
    const loaded = await loadManifest(artifactDir);
    const result = await migrate(conn, loaded, {
      appliedBy: "teste",
      historyTable: "_spark_access_history",
    });
    expect(result.applied).toEqual([1]);
    expect((await readHistory(conn, "_spark_access_history")).map((h) => h.version)).toEqual([1]);
    expect(await readHistory(conn)).toEqual([]);
    const again = await migrate(conn, loaded, {
      appliedBy: "teste",
      historyTable: "_spark_access_history",
    });
    expect(again.applied).toEqual([]);
  });

  it("recusa nome de tabela de histórico fora do padrão", async () => {
    writeArtifact([["0001_a", V1]]);
    const conn = await freshDatabase("historico_invalido");
    await expect(
      migrate(conn, await loadManifest(artifactDir), {
        appliedBy: "teste",
        historyTable: "x; DROP TABLE a",
      }),
    ).rejects.toThrow(/tabela de histórico/);
  });

  it("reaplicação não faz nada", async () => {
    writeArtifact([["0001_a", V1]]);
    const conn = await freshDatabase("reapply");
    const loaded = await loadManifest(artifactDir);
    await migrate(conn, loaded, { appliedBy: "teste" });
    const again = await migrate(conn, loaded, { appliedBy: "teste" });
    expect(again.applied).toEqual([]);
  });

  it("recusa histórico com versão ausente do manifesto", async () => {
    writeArtifact([
      ["0001_a", V1],
      ["0002_b", V2],
    ]);
    const conn = await freshDatabase("unknown");
    await migrate(conn, await loadManifest(artifactDir), { appliedBy: "teste" });
    writeArtifact([["0001_a", V1]]);
    await expect(
      migrate(conn, await loadManifest(artifactDir), { appliedBy: "teste" }),
    ).rejects.toSatisfy((e) => e instanceof MigrationError && e.code === "SCHEMA_UNKNOWN_VERSION");
  });

  it("recusa checksum registrado divergente", async () => {
    writeArtifact([["0001_a", V1]]);
    const conn = await freshDatabase("checksum");
    await migrate(conn, await loadManifest(artifactDir), { appliedBy: "teste" });
    writeArtifact([["0001_a", "CREATE TABLE a (id BIGINT PRIMARY KEY);"]]);
    await expect(
      migrate(conn, await loadManifest(artifactDir), { appliedBy: "teste" }),
    ).rejects.toSatisfy(
      (e) => e instanceof MigrationError && e.code === "SCHEMA_CHECKSUM_MISMATCH",
    );
  });

  it("falha no meio de um arquivo grava falha e bloqueia novas versões", async () => {
    writeArtifact([
      ["0001_a", V1],
      ["0002_quebrada", "CREATE TABLE c (id INT PRIMARY KEY);\nCREATE TABLE c (id INT);"],
      ["0003_d", "CREATE TABLE d (id INT PRIMARY KEY);"],
    ]);
    const conn = await freshDatabase("broken");
    const loaded = await loadManifest(artifactDir);
    await expect(migrate(conn, loaded, { appliedBy: "teste" })).rejects.toSatisfy(
      (e) => e instanceof MigrationError && e.code === "MIGRATION_FAILED" && e.version === 2,
    );
    const history = await readHistory(conn);
    expect(history.map((h) => [h.version, h.status])).toEqual([
      [1, "aplicada"],
      [2, "falha"],
    ]);
    await expect(migrate(conn, loaded, { appliedBy: "teste" })).rejects.toSatisfy(
      (e) => e instanceof MigrationError && e.code === "SCHEMA_FAILED",
    );
  });
});

describe("guarda de ambiente do apoio dos testes", () => {
  it("recusa com SPARK_ENV=production antes de qualquer CREATE/DROP", async () => {
    const previous = process.env.SPARK_ENV;
    process.env.SPARK_ENV = "production";
    try {
      await expect(MysqlTestContext.create()).rejects.toSatisfy(
        (e) => e instanceof EnvGuardError && e.exitCode === 2,
      );
    } finally {
      process.env.SPARK_ENV = previous;
    }
  });
});
