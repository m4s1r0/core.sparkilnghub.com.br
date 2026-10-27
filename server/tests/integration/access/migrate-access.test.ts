import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateAccessProjections } from "../../../src/modules/access-projection/upgrade.js";
import { ACCESS_HISTORY_TABLE } from "../../../src/platform/migrations/apply-artifact.js";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { migrate, readHistory } from "../../../src/platform/migrations/migrator.js";
import { accessProjectionDir } from "../../../src/platform/paths.js";
import { F01TestEnv } from "../../support/f01.js";

let env: F01TestEnv;

beforeAll(async () => {
  env = await F01TestEnv.create();
});
afterAll(async () => {
  await env?.cleanup();
});

/** Projeção só na v1, como nas instâncias criadas em F01. */
function projectionV1(): string {
  const dir = mkdtempSync(join(tmpdir(), "projecao-v1-"));
  cpSync(accessProjectionDir, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    migrations: unknown[];
  };
  manifest.migrations = manifest.migrations.slice(0, 1);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

describe("instances:migrate-access (projeção v2 nas instâncias existentes)", () => {
  it("atualiza a v1, mantém as atuais, ignora as ainda sem banco e lista as inacessíveis", async () => {
    const current = await env.createInstance("projecao-atual");

    const old = await env.insertInstanceRow({ state: "ATIVA" });
    const oldDb = `sparkref_${old.replaceAll("-", "")}_acc`;
    const provisioner = await env.mysql.connect("provisioner");
    await provisioner.query(`CREATE DATABASE \`${oldDb}\``);
    env.mysql.trackInstanceDatabase(oldDb);
    const oldConn = await env.mysql.connect("provisioner", oldDb);
    await migrate(oldConn, await loadManifest(projectionV1()), {
      appliedBy: "teste",
      historyTable: ACCESS_HISTORY_TABLE,
    });

    await env.insertInstanceRow({ state: "CADASTRADA", slug: "ainda-sem-banco" });
    await env.insertInstanceRow({ state: "PRONTA", slug: "banco-sumiu" });

    const report = await migrateAccessProjections(env.ctx, env.mysql.config);
    expect(report.current).toContain(current.slug);
    expect(report.updated).toEqual([{ slug: expect.any(String) as string, applied: [2] }]);
    expect(report.skipped).toEqual(["ainda-sem-banco"]);
    expect(report.unreachable).toEqual([{ slug: "banco-sumiu", code: "ER_BAD_DB_ERROR" }]);

    const history = await readHistory(oldConn, ACCESS_HISTORY_TABLE);
    expect(history.map((h) => [h.version, h.status])).toEqual([
      [1, "aplicada"],
      [2, "aplicada"],
    ]);
  });
});
