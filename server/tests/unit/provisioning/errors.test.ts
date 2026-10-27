import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classify,
  ProvisioningFailure,
} from "../../../src/modules/provisioning/errors.js";
import { MigrationError } from "../../../src/platform/migrations/manifest.js";

const mysqlError = (code: string, message = "Detalhe técnico com SQL: SELECT * FROM x") =>
  Object.assign(new Error(message), { code });

describe("classificação de falhas do provisionamento (FR-025, research.md R-08)", () => {
  it("conexão perdida, recusada, deadlock e espera de trava são transitórias", () => {
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "PROTOCOL_CONNECTION_LOST",
      "ETIMEDOUT",
      "ER_LOCK_DEADLOCK",
      "ER_LOCK_WAIT_TIMEOUT",
      "ER_CON_COUNT_ERROR",
    ]) {
      expect(classify(mysqlError(code))).toMatchObject({
        transient: true,
        code: "PROVISIONING_DEPENDENCY_UNAVAILABLE",
        retryable: true,
      });
    }
  });

  it("privilégio negado não é transitório, mas pode ser repetido depois de corrigido", () => {
    expect(classify(mysqlError("ER_DBACCESS_DENIED_ERROR"))).toMatchObject({
      transient: false,
      code: "PROVISIONING_PRIVILEGE_MISSING",
      retryable: true,
    });
  });

  it("falha de versão do artefato e versão interrompida exigem procedimento", () => {
    const failed = new MigrationError("MIGRATION_FAILED", "x", 2, {
      cause: mysqlError("ER_PARSE_ERROR"),
    });
    expect(classify(failed)).toMatchObject({
      transient: false,
      code: "PROVISIONING_MIGRATION_FAILED",
      retryable: false,
    });
    expect(classify(new MigrationError("SCHEMA_FAILED", "x", 2))).toMatchObject({
      code: "PROVISIONING_MIGRATION_INTERRUPTED",
      retryable: false,
    });
    expect(classify(new MigrationError("SCHEMA_CHECKSUM_MISMATCH", "x"))).toMatchObject({
      code: "PROVISIONING_ARTIFACT_INVALID",
      retryable: false,
    });
  });

  it("recurso em conflito e artefato alterado não são repetíveis pela interface", () => {
    for (const code of [
      "PROVISIONING_RESOURCE_CONFLICT",
      "PROVISIONING_ARTIFACT_CHANGED",
    ] as const) {
      expect(classify(new ProvisioningFailure(code, "detalhe"))).toMatchObject({
        transient: false,
        code,
        retryable: false,
      });
    }
  });

  it("mensagem segura: sem SQL, nome de usuário MySQL, caminho ou detalhe técnico", () => {
    const samples = [
      mysqlError("ER_PARSE_ERROR", "You have an error in your SQL syntax near 'DROP'"),
      mysqlError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3307"),
      new ProvisioningFailure("PROVISIONING_RESOURCE_CONFLICT", "usuário inst_abc existe"),
      new MigrationError("MIGRATION_FAILED", "Falha em C:/repos/x/0002.sql", 2),
    ];
    for (const sample of samples) {
      const { message } = classify(sample);
      expect(message).not.toMatch(/SELECT|DROP|SQL syntax|inst_|127\.0\.0\.1|[A-Z]:\/|\.sql/);
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it("espera progressiva 5 s × 3^(n−1), limitada a 5 min", () => {
    expect([1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([
      5_000, 15_000, 45_000, 135_000, 300_000, 300_000,
    ]);
  });
});
