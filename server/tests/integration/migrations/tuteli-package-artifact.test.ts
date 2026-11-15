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
  it("aplica o manifesto completo do zero e a v15 em uma instância v14", async () => {
    const manifest = await loadManifest(tuteliProductDir);
    expect(manifest.migrations.at(-1)?.version).toBe(15);

    const freshDatabase = await ctx.createDatabase("tuteli_packages_fresh");
    const fresh = await ctx.connect("test", freshDatabase);
    const freshResult = await migrate(fresh, manifest, { appliedBy: "teste" });
    expect(freshResult.applied).toEqual(Array.from({ length: 15 }, (_, index) => index + 1));

    const upgradeDatabase = await ctx.createDatabase("tuteli_packages_upgrade");
    const upgrade = await ctx.connect("test", upgradeDatabase);
    await migrate(upgrade, manifest, { appliedBy: "teste", targetVersion: 14 });
    const upgradeResult = await migrate(upgrade, manifest, { appliedBy: "teste" });
    expect(upgradeResult.applied).toEqual([15]);

    const history = await readHistory(upgrade);
    expect(history).toHaveLength(15);
    expect(history.at(-1)).toMatchObject({ version: 15, status: "aplicada" });

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

    const [archivalColumn] = await upgrade.query(
      `SELECT DATA_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agendamento_item' AND COLUMN_NAME = 'arquivado_em'`,
      [upgradeDatabase],
    );
    expect(archivalColumn).toEqual([{ DATA_TYPE: "datetime", IS_NULLABLE: "YES" }]);

    const [archivalIndex] = await upgrade.query(
      `SELECT SEQ_IN_INDEX, COLUMN_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agendamento_item'
         AND INDEX_NAME = 'agendamento_item_ativos'
       ORDER BY SEQ_IN_INDEX`,
      [upgradeDatabase],
    );
    expect(archivalIndex).toEqual([
      { SEQ_IN_INDEX: 1, COLUMN_NAME: "agendamento_id" },
      { SEQ_IN_INDEX: 2, COLUMN_NAME: "arquivado_em" },
    ]);
  });
});
