import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { serverRoot } from "../../../src/platform/paths.js";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// UPDATE/DELETE em security_event, com ou sem crase e qualificação de banco.
const FORBIDDEN =
  /\b(?:UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|REPLACE\s+INTO)\s+(?:`?\w+`?\.)?`?security_event`?\b/i;

// SC-033/R-03: o worker de retenção de IP é o único arquivo autorizado a fazer UPDATE
// em security_event (apenas ip e user_agent → NULL após 180 dias).
const ALLOWED_EXCEPTIONS = ["src/workers/ip-retention.ts"];

describe("security_event é somente inserção (FR-030, data-model)", () => {
  it("nenhum arquivo de server/src altera ou apaga eventos de segurança", () => {
    const offenders = walk(join(serverRoot, "src"))
      .filter((path) => /\.(ts|sql)$/.test(path))
      .filter((path) => FORBIDDEN.test(readFileSync(path, "utf8")))
      .map((path) => relative(serverRoot, path).replace(/\\/g, "/"))
      .filter((path) => !ALLOWED_EXCEPTIONS.includes(path));
    expect(offenders).toEqual([]);
  });

  it("o padrão reconhece as formas proibidas", () => {
    for (const statement of [
      "UPDATE security_event SET result = 'sucesso'",
      "delete from `security_event` where id = ?",
      "DELETE FROM spark_identity.security_event",
      "TRUNCATE TABLE security_event",
    ]) {
      expect(FORBIDDEN.test(statement)).toBe(true);
    }
    expect(FORBIDDEN.test("INSERT INTO security_event (id) VALUES (?)")).toBe(false);
  });
});
