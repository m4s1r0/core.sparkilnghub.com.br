import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { maskDocument, safeChanges } from "../../../src/modules/audit/audit.js";
import { serverRoot } from "../../../src/platform/paths.js";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// UPDATE/DELETE em core_audit_event, com ou sem crase e qualificação de banco.
const FORBIDDEN =
  /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|REPLACE\s+INTO)\s+(?:`?\w+`?\.)?`?core_audit_event`?\b/i;

describe("core_audit_event é somente inserção (FR-039, research.md R-16)", () => {
  it("nenhum arquivo de server/src altera ou apaga a auditoria administrativa", () => {
    const offenders = walk(join(serverRoot, "src"))
      .filter((path) => /\.(ts|sql)$/.test(path))
      .filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")))
      .map((path) => relative(serverRoot, path));
    expect(offenders).toEqual([]);
  });

  it("o padrão reconhece as formas proibidas", () => {
    for (const statement of [
      "UPDATE core_audit_event SET action = 'x'",
      "delete from `core_audit_event` where id = ?",
      "DELETE FROM spark_core.core_audit_event",
      "TRUNCATE TABLE core_audit_event",
    ]) {
      expect(FORBIDDEN.test(statement)).toBe(true);
    }
    expect(FORBIDDEN.test("INSERT INTO core_audit_event (id) VALUES (?)")).toBe(false);
  });
});

describe("alterações seguras na auditoria", () => {
  it("recusa campos com segredo e mascara documentos", () => {
    expect(() => safeChanges({ password: ["a", "b"] })).toThrow(/segredo/);
    expect(() => safeChanges({ apiToken: [null, "x"] })).toThrow(/segredo/);
    expect(() => safeChanges({ secretEnc: [null, "x"] })).toThrow(/segredo/);
    expect(safeChanges({ document: ["12345678909", "11144477735"], name: ["A", "B"] })).toEqual({
      document: ["***.***.***-09", "***.***.***-35"],
      name: ["A", "B"],
    });
    expect(maskDocument("12ABC34501DE35")).toBe("**.***.***/****-35");
    expect(maskDocument(null)).toBeNull();
  });
});
