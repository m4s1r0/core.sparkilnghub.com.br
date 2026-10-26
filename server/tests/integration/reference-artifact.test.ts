import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { binToUuid, newId } from "../../src/platform/ids.js";
import { applyArtifact } from "../../src/platform/migrations/apply-artifact.js";
import { loadManifest, MigrationError } from "../../src/platform/migrations/manifest.js";
import { referenceProductDir } from "../../src/platform/paths.js";
import { MysqlTestContext, tableStructure } from "../support/mysql.js";

let ctx: MysqlTestContext;

async function apply(targetVersion?: number) {
  const uuid = newId();
  const loaded = await loadManifest(referenceProductDir);
  const result = await applyArtifact(ctx.config, loaded, {
    instanceUuid: uuid,
    synthetic: true,
    ...(targetVersion ? { targetVersion } : {}),
  });
  ctx.trackInstanceDatabase(result.database);
  ctx.trackUser(result.user);
  return { uuid, result, loaded };
}

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});
afterAll(async () => {
  await ctx?.cleanup();
});

describe("artefato do produto de referência (US6)", () => {
  it("v1 e depois v2 é estruturalmente igual a v1+v2 do zero", async () => {
    const a = await apply(1);
    const loadedA = await loadManifest(referenceProductDir);
    const second = await applyArtifact(ctx.config, loadedA, {
      instanceUuid: a.uuid,
      synthetic: true,
    });
    expect(second.applied).toEqual([2]);
    expect(second.created).toBe(false);

    const b = await apply();
    expect(b.result.applied).toEqual([1, 2]);

    const conn = await ctx.connect("provisioner");
    const structureA = await tableStructure(conn, a.result.database);
    const structureB = await tableStructure(conn, b.result.database);
    expect(JSON.stringify(structureA).replaceAll(a.result.database, "X")).toBe(
      JSON.stringify(structureB).replaceAll(b.result.database, "X"),
    );
  });

  it("grava o marcador da instância após a v1", async () => {
    const { uuid, result } = await apply();
    const conn = await ctx.connect("provisioner", result.database);
    const [rows] = await conn.query(
      "SELECT instance_uuid, product_code, owner_task_uuid, synthetic FROM _spark_instance",
    );
    const row = (
      rows as {
        instance_uuid: Buffer;
        product_code: string;
        owner_task_uuid: Buffer | null;
        synthetic: number;
      }[]
    )[0];
    expect(row && binToUuid(row.instance_uuid)).toBe(uuid);
    expect(result.database).toBe(`sparkref_${uuid.replaceAll("-", "")}`);
    expect(row?.product_code).toBe("sparkref");
    expect(row?.owner_task_uuid).toBeNull();
    expect(row?.synthetic).toBe(1);
  });

  it("recusa artefato com checksum alterado e versão fora de sequência", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sparkref-"));
    cpSync(referenceProductDir, dir, { recursive: true });
    writeFileSync(join(dir, "migrations", "0002_ref_item.sql"), "CREATE TABLE ref_item (id INT);");
    await expect(loadManifest(dir)).rejects.toSatisfy(
      (e) => e instanceof MigrationError && e.code === "MANIFEST_CHECKSUM_MISMATCH",
    );

    const manifest = JSON.parse(
      readFileSync(join(referenceProductDir, "manifest.json"), "utf8"),
    ) as {
      migrations: { version: number }[];
    };
    manifest.migrations[1]!.version = 3;
    cpSync(referenceProductDir, dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    await expect(loadManifest(dir)).rejects.toSatisfy(
      (e) => e instanceof MigrationError && e.code === "MANIFEST_VERSION_SEQUENCE",
    );
  });
});
