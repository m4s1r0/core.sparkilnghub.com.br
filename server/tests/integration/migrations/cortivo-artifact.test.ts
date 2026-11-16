import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateArtifact } from "../../../src/platform/migrations/artifact-validator.js";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { migrate, readHistory } from "../../../src/platform/migrations/migrator.js";
import { cortivoProductDir } from "../../../src/platform/paths.js";
import { MysqlTestContext } from "../../support/mysql.js";

let ctx: MysqlTestContext;
let db: Connection;
let database: string;

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
  const manifest = await loadManifest(cortivoProductDir);
  database = await ctx.createDatabase("cortivo_base");
  db = await ctx.connect("test", database);
  await migrate(db, manifest, { appliedBy: "teste" });
});

afterAll(async () => {
  await ctx?.cleanup();
});

const now = "UTC_TIMESTAMP(6)";

describe("artefato do Cortivo, versão 1 (spec 009, FR-004 a FR-010)", () => {
  it("manifesto v1 do produto cortivo, com auditoria declarada só-inserção", async () => {
    const loaded = await loadManifest(cortivoProductDir);
    expect(loaded.manifest).toMatchObject({
      formatVersion: 1,
      productCode: "cortivo",
      databasePrefix: "cortivo_",
      appendOnlyTables: ["auditoria"],
    });
    expect(loaded.migrations.map((m) => m.version)).toEqual([1]);
    expect(() => validateArtifact(loaded)).not.toThrow();
  });

  it("aplica a versão 1 do zero e registra o histórico sem pendência", async () => {
    const history = await readHistory(db);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 1, status: "aplicada" });
  });

  it("cria somente a base: nenhuma tabela de negócio (FR-005, FR-009)", async () => {
    const [rows] = await db.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [database],
    );
    const names = (rows as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(
      [
        "_spark_instance",
        "_spark_schema_history",
        "auditoria",
        "idempotencia",
        "outbox_evento",
        "perfil_colaborador",
        "unidade",
      ].sort(),
    );
  });

  it("o marcador segue o formato do contrato do Core (mesmo do Tuteli)", async () => {
    const [cols] = await db.query(
      `SELECT COLUMN_NAME AS name, IS_NULLABLE AS nullable FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = '_spark_instance' ORDER BY ORDINAL_POSITION`,
      [database],
    );
    expect(cols).toEqual([
      { name: "instance_uuid", nullable: "NO" },
      { name: "product_code", nullable: "NO" },
      { name: "owner_task_uuid", nullable: "YES" },
      { name: "synthetic", nullable: "NO" },
      { name: "created_at", nullable: "NO" },
    ]);
  });
});

describe("unidade: linha única imposta pelo banco (FR-007)", () => {
  it("aceita uma linha com os padrões da modelagem (fuso, 15 min, 15 min)", async () => {
    await db.query(
      `INSERT INTO unidade (nome_atendimento, criado_em, atualizado_em)
       VALUES ('[SINTÉTICO] Barbearia', ${now}, ${now})`,
    );
    const [rows] = await db.query(
      "SELECT id, fuso, tolerancia_falta_min AS tol, passo_agenda_min AS passo, version FROM unidade",
    );
    expect(rows).toEqual([{ id: 1, fuso: "America/Sao_Paulo", tol: 15, passo: 15, version: 1 }]);
  });

  it("recusa uma segunda linha, com o id padrão ou com outro id", async () => {
    await expect(
      db.query(
        `INSERT INTO unidade (nome_atendimento, criado_em, atualizado_em)
         VALUES ('Outra', ${now}, ${now})`,
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
    await expect(
      db.query(
        `INSERT INTO unidade (id, nome_atendimento, criado_em, atualizado_em)
         VALUES (2, 'Outra', ${now}, ${now})`,
      ),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });

  it("recusa passo de agenda fora de 5/10/15/20/30", async () => {
    await expect(
      db.query("UPDATE unidade SET passo_agenda_min = 7 WHERE id = 1"),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
    for (const passo of [5, 10, 15, 20, 30]) {
      await db.query("UPDATE unidade SET passo_agenda_min = ? WHERE id = 1", [passo]);
    }
  });
});

describe("perfil_colaborador: perfis locais acumuláveis (FR-008, D-COR-03)", () => {
  const membership = () => Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex");
  const insert = (perfis: string, id = membership()) =>
    db.query(
      `INSERT INTO perfil_colaborador (membership_id, perfis, definido_por, criado_em, atualizado_em)
       VALUES (?, ?, ?, ${now}, ${now})`,
      [id, perfis, membership()],
    );

  it("aceita recepcao, barbeiro e os dois juntos", async () => {
    await insert("recepcao");
    await insert("barbeiro");
    await insert("recepcao,barbeiro");
    const [rows] = await db.query("SELECT perfis FROM perfil_colaborador ORDER BY perfis");
    expect((rows as { perfis: string }[]).map((r) => r.perfis).sort()).toEqual(
      ["recepcao", "recepcao,barbeiro", "barbeiro"].sort(),
    );
  });

  it("recusa conjunto vazio e perfil desconhecido", async () => {
    await expect(insert("")).rejects.toThrow();
    await expect(insert("gerente")).rejects.toThrow();
    await expect(insert("recepcao,gerente")).rejects.toThrow();
  });

  it("não permite vincular o mesmo membership duas vezes", async () => {
    const id = membership();
    await insert("recepcao", id);
    await expect(insert("barbeiro", id)).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("a referência ao profissional nasce anulável e sem chave estrangeira", async () => {
    const [cols] = await db.query(
      `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'perfil_colaborador' AND COLUMN_NAME = 'profissional_id'`,
      [database],
    );
    expect(cols).toEqual([{ nullable: "YES" }]);
    const [fks] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [database],
    );
    expect(Number((fks as { n: number }[])[0]?.n)).toBe(0);
  });
});

describe("idempotência, auditoria e caixa de saída: estrutura da modelagem", () => {
  it("idempotencia tem chave composta ator + operação", async () => {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'idempotencia' AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION`,
      [database],
    );
    expect(rows).toEqual([{ name: "chave" }, { name: "ator_membership_id" }, { name: "operacao" }]);
  });

  it("auditoria aceita entidade_id nulo (convite recém-criado no Core)", async () => {
    const id = Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex");
    await db.query(
      `INSERT INTO auditoria (id, ocorrido_em, ator_membership_id, ator_nome, acao, resultado,
                              entidade, entidade_id, correlation_id)
       VALUES (?, ${now}, ?, 'Administrador', 'equipe.convidar', 'sucesso', 'convite', NULL, ?)`,
      [id, id, crypto.randomUUID()],
    );
    const [rows] = await db.query("SELECT entidade_id AS e FROM auditoria WHERE id = ?", [id]);
    expect(rows).toEqual([{ e: null }]);
  });

  it("outbox_evento existe vazia e com índice de pendentes", async () => {
    const [rows] = await db.query(
      `SELECT INDEX_NAME AS name FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'outbox_evento' AND INDEX_NAME = 'outbox_pendentes'
        GROUP BY INDEX_NAME`,
      [database],
    );
    expect(rows).toEqual([{ name: "outbox_pendentes" }]);
  });
});
