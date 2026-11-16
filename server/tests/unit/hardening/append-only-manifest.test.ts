import { describe, expect, it } from "vitest";
import {
  undeclaredAppendOnlyTables,
  validateArtifact,
} from "../../../src/platform/migrations/artifact-validator.js";
import { loadManifest } from "../../../src/platform/migrations/manifest.js";
import { referenceProductDir, tuteliProductDir } from "../../../src/platform/paths.js";

/** SEC-12: `appendOnlyTables` só pode nomear tabelas que o próprio artefato cria. */
describe("SEC-12 — manifesto declara tabelas só-inserção", () => {
  it("tabela criada pelo artefato é aceita; inexistente ou interna é recusada", async () => {
    const loaded = await loadManifest(referenceProductDir);
    const withTables = (appendOnlyTables: string[]) => ({
      ...loaded,
      manifest: { ...loaded.manifest, appendOnlyTables },
    });
    expect(undeclaredAppendOnlyTables(withTables(["ref_item"]))).toEqual([]);
    expect(() => validateArtifact(withTables(["ref_item"]))).not.toThrow();
    expect(undeclaredAppendOnlyTables(withTables(["nao_existe"]))).toEqual(["nao_existe"]);
    expect(() => validateArtifact(withTables(["nao_existe"]))).toThrow(/appendOnlyTables/);
    expect(undeclaredAppendOnlyTables(withTables(["_spark_instance"]))).toEqual([
      "_spark_instance",
    ]);
  });

  it("o artefato do Tuteli declara a auditoria como só-inserção", async () => {
    const { manifest } = await loadManifest(tuteliProductDir);
    expect(manifest.appendOnlyTables).toContain("auditoria_evento");
  });
});
