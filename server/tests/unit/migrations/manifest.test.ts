import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadManifest,
  MigrationError,
  normalizeSql,
  sha256,
} from "../../../src/platform/migrations/manifest.js";

let dir: string;

function write(files: Record<string, string>, manifest: unknown) {
  mkdirSync(join(dir, "migrations"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, "migrations", name), content);
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

const entry = (version: number, name: string, content: string) => ({
  version,
  name,
  file: `migrations/${name}.sql`,
  sha256: sha256(normalizeSql(Buffer.from(content))),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "manifest-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function expectCode(code: string) {
  await expect(loadManifest(dir)).rejects.toSatisfy(
    (error) => error instanceof MigrationError && error.code === code,
  );
}

describe("loadManifest", () => {
  it("carrega manifesto válido com versões contíguas", async () => {
    write(
      { "0001_a.sql": "SELECT 1;", "0002_b.sql": "SELECT 2;" },
      {
        formatVersion: 1,
        artifact: "teste",
        migrations: [entry(1, "0001_a", "SELECT 1;"), entry(2, "0002_b", "SELECT 2;")],
      },
    );
    const loaded = await loadManifest(dir);
    expect(loaded.migrations.map((m) => m.version)).toEqual([1, 2]);
    expect(loaded.artifact).toBe("teste");
  });

  it("recusa versões não contíguas", async () => {
    write(
      { "0001_a.sql": "SELECT 1;", "0003_c.sql": "SELECT 3;" },
      {
        formatVersion: 1,
        artifact: "teste",
        migrations: [entry(1, "0001_a", "SELECT 1;"), entry(3, "0003_c", "SELECT 3;")],
      },
    );
    await expectCode("MANIFEST_VERSION_SEQUENCE");
  });

  it("recusa sha256 divergente do arquivo normalizado", async () => {
    write(
      { "0001_a.sql": "SELECT 1;" },
      {
        formatVersion: 1,
        artifact: "teste",
        migrations: [{ ...entry(1, "0001_a", "SELECT 1;"), sha256: "0".repeat(64) }],
      },
    );
    await expectCode("MANIFEST_CHECKSUM_MISMATCH");
  });

  it("recusa arquivo ausente", async () => {
    write(
      {},
      {
        formatVersion: 1,
        artifact: "teste",
        migrations: [entry(1, "0001_a", "SELECT 1;")],
      },
    );
    await expectCode("MANIFEST_FILE_MISSING");
  });

  it("recusa formatVersion diferente de 1", async () => {
    write(
      { "0001_a.sql": "SELECT 1;" },
      {
        formatVersion: 2,
        artifact: "teste",
        migrations: [entry(1, "0001_a", "SELECT 1;")],
      },
    );
    await expectCode("MANIFEST_FORMAT_UNSUPPORTED");
  });

  it("normaliza CRLF e BOM antes do checksum", async () => {
    const lf = "SELECT 1;\nSELECT 2;\n";
    write(
      { "0001_a.sql": "﻿SELECT 1;\r\nSELECT 2;\r\n" },
      {
        formatVersion: 1,
        artifact: "teste",
        migrations: [entry(1, "0001_a", lf)],
      },
    );
    await expect(loadManifest(dir)).resolves.toBeDefined();
  });
});
