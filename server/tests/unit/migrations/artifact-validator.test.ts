import { describe, expect, it } from "vitest";
import {
  findForbiddenConstructs,
  validateArtifactManifest,
} from "../../../src/platform/migrations/artifact-validator.js";

describe("findForbiddenConstructs (contracts/migration-artifact.md)", () => {
  it.each([
    ["USE outro_banco;", "USE"],
    ["SELECT * FROM spark_core.worker_heartbeat;", "QUALIFIED_DATABASE"],
    ["CREATE TABLE `sparkpet_x`.`t` (id INT);", "QUALIFIED_DATABASE"],
    ["CREATE DATABASE x;", "CREATE_DATABASE"],
    ["create schema x;", "CREATE_DATABASE"],
    ["CREATE USER 'a'@'%';", "CREATE_USER"],
    ["GRANT SELECT ON *.* TO 'a'@'%';", "GRANT"],
    ["DROP DATABASE x;", "DROP_DATABASE"],
    ["SET GLOBAL max_connections = 1;", "SET_GLOBAL"],
    ["LOAD DATA INFILE '/etc/passwd' INTO TABLE t;", "LOAD_DATA"],
    ["SELECT 1 INTO OUTFILE '/tmp/x';", "INTO_OUTFILE"],
  ])("recusa %s", (sql, code) => {
    expect(findForbiddenConstructs(sql).map((f) => f.code)).toContain(code);
  });

  it("aceita DDL/DML sobre o próprio banco", () => {
    const sql = `CREATE TABLE ref_item (id INT PRIMARY KEY, label VARCHAR(80) NOT NULL);
INSERT INTO ref_item (id, label) VALUES (1, 'x.y');
ALTER TABLE ref_item ADD INDEX ref_item_label (label);`;
    expect(findForbiddenConstructs(sql)).toEqual([]);
  });

  it("ignora comentários e textos entre aspas", () => {
    expect(
      findForbiddenConstructs("-- DROP DATABASE x\nINSERT INTO t VALUES ('USE x; GRANT');"),
    ).toEqual([]);
  });
});

describe("validateArtifactManifest", () => {
  const base = { productCode: "sparkref", databasePrefix: "sparkref_" };

  it("aceita productCode e prefixo coerentes", () => {
    expect(validateArtifactManifest(base)).toEqual([]);
  });

  it.each(["Spark", "ab", "1abc", "sparkref_longo_demais", "spark-ref"])(
    "recusa productCode %s fora de ^[a-z][a-z0-9]{2,15}$",
    (productCode) => {
      expect(
        validateArtifactManifest({ ...base, productCode, databasePrefix: `${productCode}_` }),
      ).toContain("ARTIFACT_PRODUCT_CODE_INVALID");
    },
  );

  it("recusa databasePrefix diferente de productCode + _", () => {
    expect(validateArtifactManifest({ ...base, databasePrefix: "outro_" })).toContain(
      "ARTIFACT_PREFIX_MISMATCH",
    );
  });

  it("exige productCode em artefato de produto", () => {
    expect(validateArtifactManifest({})).toContain("ARTIFACT_PRODUCT_CODE_INVALID");
  });
});
