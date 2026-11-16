import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateArtifact } from "../../../src/platform/migrations/artifact-validator.js";
import { loadManifest, MigrationError } from "../../../src/platform/migrations/manifest.js";
import { migrate, readHistory } from "../../../src/platform/migrations/migrator.js";
import { cortivoProductDir } from "../../../src/platform/paths.js";
import { MysqlTestContext, tableStructure } from "../../support/mysql.js";

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
const uuid = () => Buffer.from(crypto.randomUUID().replaceAll("-", ""), "hex");

function truncated(dir: string, versions: number): string {
  const target = mkdtempSync(join(tmpdir(), "cortivo-base-"));
  cpSync(dir, target, { recursive: true });
  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    migrations: unknown[];
  };
  manifest.migrations = manifest.migrations.slice(0, versions);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return target;
}

async function completeStructure(connection: Connection, schema: string) {
  const [constraints] = await connection.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
       FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
    [schema],
  );
  const [foreignKeys] = await connection.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME,
            REFERENCED_COLUMN_NAME, POSITION_IN_UNIQUE_CONSTRAINT
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [schema],
  );
  const [checks] = await connection.query(
    `SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.CHECK_CONSTRAINTS cc
         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA = ? AND tc.CONSTRAINT_TYPE = 'CHECK'
      ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME`,
    [schema],
  );
  return {
    tables: await tableStructure(connection, schema),
    constraints,
    foreignKeys,
    checks,
  };
}

describe("artefato do Cortivo, versão 2 (spec 010, FR-001 a FR-007)", () => {
  it("manifesto v1+v2 do produto cortivo, com auditoria declarada só-inserção", async () => {
    const loaded = await loadManifest(cortivoProductDir);
    expect(loaded.manifest).toMatchObject({
      formatVersion: 1,
      productCode: "cortivo",
      databasePrefix: "cortivo_",
      appendOnlyTables: ["auditoria"],
    });
    expect(loaded.migrations.map((m) => m.version)).toEqual([1, 2]);
    expect(() => validateArtifact(loaded)).not.toThrow();
  });

  it("aplica as versões 1 e 2 do zero e registra o histórico sem pendência", async () => {
    const history = await readHistory(db);
    expect(history).toHaveLength(2);
    expect(history.map(({ version, status }) => ({ version, status }))).toEqual([
      { version: 1, status: "aplicada" },
      { version: 2, status: "aplicada" },
    ]);
  });

  it("cria somente a base e o cadastro mínimo de profissional (FR-006)", async () => {
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
        "profissional",
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
  const insert = async (perfis: string, id = membership()) => {
    const professionalId = perfis.includes("barbeiro") ? uuid() : null;
    if (professionalId) {
      await db.query(
        `INSERT INTO profissional (profissional_id, nome, criado_em, atualizado_em)
         VALUES (?, 'Profissional de teste', ${now}, ${now})`,
        [professionalId],
      );
    }
    return db.query(
      `INSERT INTO perfil_colaborador
         (membership_id, profissional_id, perfis, definido_por, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ${now}, ${now})`,
      [id, professionalId, perfis, membership()],
    );
  };

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

  it("a referência ao profissional continua anulável e agora tem chave estrangeira", async () => {
    const [cols] = await db.query(
      `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'perfil_colaborador' AND COLUMN_NAME = 'profissional_id'`,
      [database],
    );
    expect(cols).toEqual([{ nullable: "YES" }]);
    const [fks] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'perfil_colaborador'
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [database],
    );
    expect(Number((fks as { n: number }[])[0]?.n)).toBe(1);
    const [indexes] = await db.query(
      `SELECT NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'perfil_colaborador'
          AND COLUMN_NAME = 'profissional_id'`,
      [database],
    );
    expect(indexes).toContainEqual({ nonUnique: 0 });
  });

  it("profissional tem os campos requeridos e situação ativa por padrão", async () => {
    const id = uuid();
    await db.query(
      `INSERT INTO profissional (profissional_id, nome, criado_em, atualizado_em)
       VALUES (?, ?, ${now}, ${now})`,
      [id, "Profissional sintético"],
    );
    const [rows] = await db.query(
      `SELECT situacao, version, apelido, telefone FROM profissional WHERE profissional_id = ?`,
      [id],
    );
    expect(rows).toEqual([{ situacao: "ativo", version: 1, apelido: null, telefone: null }]);
    const [columns] = await db.query(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_DEFAULT AS defaultValue
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'profissional'`,
      [database],
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        { name: "profissional_id", type: "binary(16)", nullable: "NO", defaultValue: null },
        { name: "nome", type: "varchar(120)", nullable: "NO", defaultValue: null },
        { name: "apelido", type: "varchar(40)", nullable: "YES", defaultValue: null },
        { name: "telefone", type: "varchar(16)", nullable: "YES", defaultValue: null },
        {
          name: "situacao",
          type: "enum('ativo','inativo')",
          nullable: "NO",
          defaultValue: "ativo",
        },
        { name: "version", type: "int unsigned", nullable: "NO", defaultValue: "1" },
      ]),
    );
  });

  it("recusa incoerência entre barbeiro e profissional", async () => {
    const membership = uuid();
    const actor = uuid();
    await expect(
      db.query(
        `INSERT INTO perfil_colaborador
           (membership_id, perfis, definido_por, criado_em, atualizado_em)
         VALUES (?, 'barbeiro', ?, ${now}, ${now})`,
        [membership, actor],
      ),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });

    await expect(
      db.query(
        `INSERT INTO perfil_colaborador
           (membership_id, perfis, profissional_id, definido_por, criado_em, atualizado_em)
         VALUES (?, 'recepcao', ?, ?, ${now}, ${now})`,
        [uuid(), uuid(), actor],
      ),
    ).rejects.toMatchObject({ code: "ER_CHECK_CONSTRAINT_VIOLATED" });
  });

  it("recusa profissional inexistente ou já associado a outro barbeiro", async () => {
    const actor = uuid();
    await expect(
      db.query(
        `INSERT INTO perfil_colaborador
           (membership_id, perfis, profissional_id, definido_por, criado_em, atualizado_em)
         VALUES (?, 'barbeiro', ?, ?, ${now}, ${now})`,
        [uuid(), uuid(), actor],
      ),
    ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });

    const professionalId = uuid();
    await db.query(
      `INSERT INTO profissional (profissional_id, nome, criado_em, atualizado_em)
       VALUES (?, 'Barbeiro sintético', ${now}, ${now})`,
      [professionalId],
    );
    await db.query(
      `INSERT INTO perfil_colaborador
         (membership_id, perfis, profissional_id, definido_por, criado_em, atualizado_em)
       VALUES (?, 'barbeiro', ?, ?, ${now}, ${now})`,
      [uuid(), professionalId, actor],
    );
    await expect(
      db.query(
        `INSERT INTO perfil_colaborador
           (membership_id, perfis, profissional_id, definido_por, criado_em, atualizado_em)
         VALUES (?, 'recepcao,barbeiro', ?, ?, ${now}, ${now})`,
        [uuid(), professionalId, actor],
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("migra v1 para v2 preservando dados e equivale à aplicação limpa", async () => {
    const baseManifest = await loadManifest(truncated(cortivoProductDir, 1));
    const fullManifest = await loadManifest(cortivoProductDir);
    const migratedDb = await ctx.createDatabase("cortivo_upgrade");
    const freshDb = await ctx.createDatabase("cortivo_fresh");
    const migrated = await ctx.connect("test", migratedDb);
    const fresh = await ctx.connect("test", freshDb);
    await migrate(migrated, baseManifest, { appliedBy: "teste" });
    await migrated.query(
      `INSERT INTO perfil_colaborador
         (membership_id, perfis, definido_por, criado_em, atualizado_em)
       VALUES (?, 'recepcao', ?, ${now}, ${now})`,
      [uuid(), uuid()],
    );
    await migrated.query(
      `INSERT INTO unidade (nome_atendimento, criado_em, atualizado_em)
       VALUES ('[SINTÉTICO] Unidade existente', ${now}, ${now})`,
    );
    await migrate(migrated, fullManifest, { appliedBy: "teste" });
    await migrate(fresh, fullManifest, { appliedBy: "teste" });

    const [profiles] = await migrated.query("SELECT perfis FROM perfil_colaborador");
    const [units] = await migrated.query("SELECT nome_atendimento FROM unidade");
    expect(profiles).toEqual([{ perfis: "recepcao" }]);
    expect(units).toEqual([{ nome_atendimento: "[SINTÉTICO] Unidade existente" }]);
    expect(await completeStructure(migrated, migratedDb)).toEqual(
      await completeStructure(fresh, freshDb),
    );
    expect((await readHistory(migrated)).map((row) => row.version)).toEqual([1, 2]);
  });

  it("falha com segurança em barbeiro v1 sem profissional e preserva dados e recursos", async () => {
    const baseManifest = await loadManifest(truncated(cortivoProductDir, 1));
    const fullManifest = await loadManifest(cortivoProductDir);
    const legacyDb = await ctx.createDatabase("cortivo_legacy_invalid");
    const legacy = await ctx.connect("test", legacyDb);
    await migrate(legacy, baseManifest, { appliedBy: "teste" });
    const membership = uuid();
    await legacy.query(
      `INSERT INTO perfil_colaborador
         (membership_id, perfis, definido_por, criado_em, atualizado_em)
       VALUES (?, 'barbeiro', ?, ${now}, ${now})`,
      [membership, uuid()],
    );
    await expect(migrate(legacy, fullManifest, { appliedBy: "teste" })).rejects.toMatchObject({
      code: "MIGRATION_FAILED",
      version: 2,
    } satisfies Partial<MigrationError>);
    const history = await readHistory(legacy);
    expect(history.map(({ version, status }) => ({ version, status }))).toEqual([
      { version: 1, status: "aplicada" },
      { version: 2, status: "falha" },
    ]);
    const [rows] = await legacy.query(
      "SELECT perfis, profissional_id FROM perfil_colaborador WHERE membership_id = ?",
      [membership],
    );
    expect(rows).toEqual([{ perfis: "barbeiro", profissional_id: null }]);
    const [tables] = await legacy.query(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?",
      [legacyDb],
    );
    expect((tables as { name: string }[]).map((row) => row.name)).toContain("profissional");
    await expect(migrate(legacy, fullManifest, { appliedBy: "teste" })).rejects.toMatchObject({
      code: "SCHEMA_FAILED",
    });
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
