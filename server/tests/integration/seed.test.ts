import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { binToUuid } from "../../src/platform/ids.js";
import { repoRoot } from "../../src/platform/paths.js";
import { SEED_REFERENCE_INSTANCE, seedF00, SYNTHETIC_PREFIX } from "../../seeds/f00.js";
import { MysqlTestContext } from "../support/mysql.js";

let ctx: MysqlTestContext;

function runCommand(script: string, env: Record<string, string>) {
  const windows = process.platform === "win32";
  return spawnSync(windows ? `npm run -s ${script}` : "npm", windows ? [] : ["run", "-s", script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: windows,
  });
}

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});
afterAll(async () => {
  await ctx?.cleanup();
});

describe("dados sintéticos (US7, NFR-016)", () => {
  it("duas execuções produzem a mesma contagem", async () => {
    const first = await seedF00(ctx.config);
    const second = await seedF00(ctx.config);
    expect(second.inserted).toBe(0);
    expect(second.database).toBe(first.database);

    const conn = await ctx.connect("provisioner", second.database);
    const [items] = await conn.query("SELECT COUNT(*) AS total FROM ref_item");
    expect(Number((items as { total: number }[])[0]?.total)).toBe(1);
  });

  it("instância com UUID fixo de semente, marcada sintética, e textos com [SINTÉTICO]", async () => {
    const { database } = await seedF00(ctx.config);
    const conn = await ctx.connect("provisioner", database);
    const [instances] = await conn.query("SELECT instance_uuid, synthetic FROM _spark_instance");
    const row = (instances as { instance_uuid: Buffer; synthetic: number }[])[0];
    expect(row && binToUuid(row.instance_uuid)).toBe(SEED_REFERENCE_INSTANCE);
    expect(row?.synthetic).toBe(1);
    const [labels] = await conn.query("SELECT label FROM ref_item");
    for (const { label } of labels as { label: string }[]) {
      expect(label.startsWith(SYNTHETIC_PREFIX)).toBe(true);
    }
    // F00 ainda não tem e-mails; quando houver, só em example.test (server/seeds/README.md).
    const [emails] = await conn.query(
      "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND COLUMN_NAME LIKE '%email%'",
      [database],
    );
    expect(Number((emails as { total: number }[])[0]?.total)).toBe(0);
  });

  it("SPARK_ENV=production: db:seed sai com 2 e registra env_guard_refused", () => {
    const result = runCommand("db:seed", { SPARK_ENV: "production" });
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/env_guard_refused/);
  });

  it("dev:reset com SPARK_ENV=homologation é recusado", () => {
    const result = runCommand("dev:reset", { SPARK_ENV: "homologation" });
    expect(result.status).toBe(2);
    expect(result.stdout + result.stderr).toMatch(/recusado/);
  });
});
