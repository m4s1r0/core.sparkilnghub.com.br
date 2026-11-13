import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { migrate, readHistory } from "../../../src/platform/migrations/migrator.js";
import { tuteliProductDir } from "../../../src/platform/paths.js";
import { MysqlTestContext } from "../../support/mysql.js";

let ctx: MysqlTestContext;

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});

afterAll(async () => {
  await ctx?.cleanup();
});

describe("artefato de créditos de pacote Tuteli", () => {
  it("aplica o manifesto completo do zero e a v14 em uma instância v13", async () => {
    const manifest = await loadManifest(tuteliProductDir);
    expect(manifest.migrations.at(-1)?.version).toBe(14);

    const freshDatabase = await ctx.createDatabase("tuteli_packages_fresh");
    const fresh = await ctx.connect("test", freshDatabase);
    const freshResult = await migrate(fresh, manifest, { appliedBy: "teste" });
    expect(freshResult.applied).toEqual(Array.from({ length: 14 }, (_, index) => index + 1));

    const upgradeDatabase = await ctx.createDatabase("tuteli_packages_upgrade");
    const upgrade = await ctx.connect("test", upgradeDatabase);
    await migrate(upgrade, manifest, { appliedBy: "teste", targetVersion: 13 });
    const upgradeResult = await migrate(upgrade, manifest, { appliedBy: "teste" });
    expect(upgradeResult.applied).toEqual([14]);

    const history = await readHistory(upgrade);
    expect(history).toHaveLength(14);
    expect(history.at(-1)).toMatchObject({ version: 14, status: "aplicada" });

    const [tables] = await upgrade.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN
         ('pacote_reserva','pacote_credito_lancamento','pacote_vendido','comanda_item')
       ORDER BY TABLE_NAME`,
      [upgradeDatabase],
    );
    expect(tables).toEqual([
      { TABLE_NAME: "comanda_item" },
      { TABLE_NAME: "pacote_credito_lancamento" },
      { TABLE_NAME: "pacote_reserva" },
      { TABLE_NAME: "pacote_vendido" },
    ]);

    const [indexes] = await upgrade.query(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND INDEX_NAME IN
         ('pacote_reserva_ativa_item','pacote_vendido_comanda_item','pacote_credito_origem')
       ORDER BY TABLE_NAME, INDEX_NAME`,
      [upgradeDatabase],
    );
    expect(indexes).toEqual([
      { TABLE_NAME: "pacote_credito_lancamento", INDEX_NAME: "pacote_credito_origem" },
      { TABLE_NAME: "pacote_reserva", INDEX_NAME: "pacote_reserva_ativa_item" },
      { TABLE_NAME: "pacote_vendido", INDEX_NAME: "pacote_vendido_comanda_item" },
    ]);

    const [creditQuantity] = await upgrade.query(
      `SELECT DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'pacote_credito_lancamento' AND COLUMN_NAME = 'quantidade'`,
      [upgradeDatabase],
    );
    expect(creditQuantity).toEqual([{ DATA_TYPE: "int", COLUMN_TYPE: "int" }]);
  });
});
