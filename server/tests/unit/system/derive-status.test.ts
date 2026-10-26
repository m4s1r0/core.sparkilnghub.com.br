import { describe, expect, it } from "vitest";
import {
  deriveDatabase,
  deriveOverall,
  deriveWorker,
  type DatabaseProbe,
} from "../../../src/modules/system/derive-status.js";

const now = new Date("2026-10-26T12:00:00.000Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("deriveWorker", () => {
  it("SAUDAVEL se algum last_seen_at ≤ 30 s", () => {
    expect(deriveWorker({ reachable: true, lastSeen: [ago(200), ago(30)] }, now)).toEqual({
      status: "SAUDAVEL",
      reason: null,
    });
  });

  it("DEGRADADA entre 30 s e 120 s (WORKER_STALE)", () => {
    expect(deriveWorker({ reachable: true, lastSeen: [ago(31)] }, now)).toEqual({
      status: "DEGRADADA",
      reason: "WORKER_STALE",
    });
    expect(deriveWorker({ reachable: true, lastSeen: [ago(120)] }, now).status).toBe("DEGRADADA");
  });

  it("INDISPONIVEL acima de 120 s (WORKER_STALE) ou sem linhas (WORKER_ABSENT)", () => {
    expect(deriveWorker({ reachable: true, lastSeen: [ago(121)] }, now)).toEqual({
      status: "INDISPONIVEL",
      reason: "WORKER_STALE",
    });
    expect(deriveWorker({ reachable: true, lastSeen: [] }, now)).toEqual({
      status: "INDISPONIVEL",
      reason: "WORKER_ABSENT",
    });
  });

  it("DESCONHECIDA se o banco não responder", () => {
    expect(deriveWorker({ reachable: false, lastSeen: [] }, now)).toEqual({
      status: "DESCONHECIDA",
      reason: null,
    });
  });
});

describe("deriveDatabase", () => {
  const probe = (p: Partial<DatabaseProbe>): DatabaseProbe => ({
    reachable: true,
    appliedVersion: 2,
    expectedVersion: 2,
    problem: null,
    ...p,
  });

  it("SAUDAVEL com versão aplicada igual à esperada", () => {
    expect(deriveDatabase(probe({}))).toMatchObject({ status: "SAUDAVEL", reason: null });
  });

  it("INDISPONIVEL com DB_UNREACHABLE", () => {
    expect(deriveDatabase(probe({ reachable: false }))).toMatchObject({
      status: "INDISPONIVEL",
      reason: "DB_UNREACHABLE",
    });
  });

  it.each(["SCHEMA_FAILED", "SCHEMA_CHECKSUM_MISMATCH", "SCHEMA_UNKNOWN_VERSION"] as const)(
    "INDISPONIVEL com %s",
    (problem) => {
      expect(deriveDatabase(probe({ problem }))).toMatchObject({
        status: "INDISPONIVEL",
        reason: problem,
      });
    },
  );

  it("DEGRADADA com SCHEMA_BEHIND quando aplicada < esperada", () => {
    expect(deriveDatabase(probe({ appliedVersion: 1 }))).toMatchObject({
      status: "DEGRADADA",
      reason: "SCHEMA_BEHIND",
    });
  });
});

describe("deriveOverall", () => {
  const ok = "SAUDAVEL" as const;
  it("SAUDAVEL quando tudo está saudável", () => {
    expect(deriveOverall({ server: ok, spark_core: ok, spark_identity: ok, worker: ok })).toBe(ok);
  });

  it.each(["INDISPONIVEL", "DESCONHECIDA"] as const)(
    "INDISPONIVEL quando um essencial está %s",
    (state) => {
      expect(deriveOverall({ server: ok, spark_core: state, spark_identity: ok, worker: ok })).toBe(
        "INDISPONIVEL",
      );
    },
  );

  it("DEGRADADA quando um essencial está DEGRADADA", () => {
    expect(
      deriveOverall({ server: ok, spark_core: ok, spark_identity: "DEGRADADA", worker: ok }),
    ).toBe("DEGRADADA");
  });

  it.each(["DEGRADADA", "INDISPONIVEL", "DESCONHECIDA"] as const)(
    "DEGRADADA quando o trabalhador está %s (F00 não processa tarefas)",
    (state) => {
      expect(deriveOverall({ server: ok, spark_core: ok, spark_identity: ok, worker: state })).toBe(
        "DEGRADADA",
      );
    },
  );
});
