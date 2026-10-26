import { describe, expect, it } from "vitest";
import { ALLOWED_DROP_FILE, checkImmutable, checkNoDropDatabase } from "../lib/check-migrations.js";

const files = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("checkImmutable (FR-019)", () => {
  const base = files({
    "server/migrations/spark_core/migrations/0001_a.sql": "CREATE TABLE a (id INT);\n",
    "server/reference-product/migrations/0001_b.sql": "CREATE TABLE b (id INT);\n",
  });

  it("falha quando migração publicada em origin/main é alterada, indicando o arquivo", () => {
    const current = files({
      "server/migrations/spark_core/migrations/0001_a.sql": "CREATE TABLE a (id BIGINT);\n",
      "server/reference-product/migrations/0001_b.sql": "CREATE TABLE b (id INT);\n",
    });
    expect(checkImmutable(current, base)).toEqual([
      expect.objectContaining({
        code: "MIGRATION_CHANGED",
        file: "server/migrations/spark_core/migrations/0001_a.sql",
      }),
    ]);
  });

  it("falha quando migração publicada é removida", () => {
    const current = files({
      "server/migrations/spark_core/migrations/0001_a.sql": "CREATE TABLE a (id INT);\n",
    });
    expect(checkImmutable(current, base).map((p) => p.code)).toEqual(["MIGRATION_REMOVED"]);
  });

  it("passa quando só se acrescenta nova versão", () => {
    const current = new Map([
      ...base,
      ["server/migrations/spark_core/migrations/0002_c.sql", "SELECT 1;"],
    ]);
    expect(checkImmutable(current, base)).toEqual([]);
  });

  it("renormalização de final de linha não altera o checksum", () => {
    const current = files({
      "server/migrations/spark_core/migrations/0001_a.sql": "CREATE TABLE a (id INT);\r\n",
      "server/reference-product/migrations/0001_b.sql": "﻿CREATE TABLE b (id INT);\n",
    });
    expect(checkImmutable(current, base)).toEqual([]);
  });
});

describe("checkNoDropDatabase (constituição IV, v1.1.1)", () => {
  it("falha com DROP DATABASE em server/src, indicando arquivo e linha", () => {
    const problems = checkNoDropDatabase([
      { path: "server/src/modules/x.ts", content: "const a = 1;\nawait q('drop  database x');\n" },
    ]);
    expect(problems).toEqual([
      expect.objectContaining({
        code: "DROP_DATABASE_IN_APP",
        file: "server/src/modules/x.ts",
        line: 2,
      }),
    ]);
  });

  it("passa com o mesmo texto em scripts/ ou server/tests/", () => {
    expect(
      checkNoDropDatabase([
        { path: "scripts/dev-reset.ts", content: "DROP DATABASE x" },
        { path: "server/tests/support/mysql.ts", content: "DROP DATABASE x" },
      ]),
    ).toEqual([]);
  });

  it("libera apenas o validador de artefatos, onde o texto é a lista do que é recusado", () => {
    expect(ALLOWED_DROP_FILE).toBe("server/src/platform/migrations/artifact-validator.ts");
    expect(
      checkNoDropDatabase([{ path: ALLOWED_DROP_FILE, content: "/\\bDROP DATABASE\\b/" }]),
    ).toEqual([]);
    expect(
      checkNoDropDatabase([
        { path: "server/src/platform/migrations/outro.ts", content: "DROP DATABASE" },
      ]),
    ).toHaveLength(1);
  });
});
