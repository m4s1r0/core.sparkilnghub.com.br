import type { HealthState, StatusReason } from "@sparkcore/contracts";
import type { HistoryCheck } from "../../platform/migrations/migrator.js";

export interface Derived {
  status: HealthState;
  reason: StatusReason | null;
}

const WORKER_HEALTHY_SECONDS = 30;
const WORKER_STALE_SECONDS = 120;

/** Regras do trabalhador (data-model.md, `worker_heartbeat`). */
export function deriveWorker(probe: { reachable: boolean; lastSeen: Date[] }, now: Date): Derived {
  if (!probe.reachable) return { status: "DESCONHECIDA", reason: null };
  if (probe.lastSeen.length === 0) return { status: "INDISPONIVEL", reason: "WORKER_ABSENT" };
  const newest = Math.max(...probe.lastSeen.map((date) => date.getTime()));
  const age = (now.getTime() - newest) / 1000;
  if (age <= WORKER_HEALTHY_SECONDS) return { status: "SAUDAVEL", reason: null };
  if (age <= WORKER_STALE_SECONDS) return { status: "DEGRADADA", reason: "WORKER_STALE" };
  return { status: "INDISPONIVEL", reason: "WORKER_STALE" };
}

export interface DatabaseProbe {
  reachable: boolean;
  appliedVersion: number;
  expectedVersion: number;
  problem: HistoryCheck["problem"];
}

/** Regras dos bancos (data-model.md, "Derivação dos bancos"). */
export function deriveDatabase(probe: DatabaseProbe): Derived {
  if (!probe.reachable) return { status: "INDISPONIVEL", reason: "DB_UNREACHABLE" };
  switch (probe.problem) {
    case "SCHEMA_FAILED":
    case "SCHEMA_CHECKSUM_MISMATCH":
    case "SCHEMA_UNKNOWN_VERSION":
      return { status: "INDISPONIVEL", reason: probe.problem };
    case "SCHEMA_SEQUENCE":
      return { status: "INDISPONIVEL", reason: "SCHEMA_FAILED" };
    case null:
      break;
  }
  if (probe.appliedVersion < probe.expectedVersion) {
    return { status: "DEGRADADA", reason: "SCHEMA_BEHIND" };
  }
  return { status: "SAUDAVEL", reason: null };
}

/**
 * Estado geral: essenciais são servidor, `spark_core` e `spark_identity`. O trabalhador só degrada,
 * já que F00 não processa tarefas; F02 reavalia esse peso (data-model.md, "Estado geral").
 */
export function deriveOverall(states: {
  server: HealthState;
  spark_core: HealthState;
  spark_identity: HealthState;
  worker: HealthState;
}): HealthState {
  const essentials = [states.server, states.spark_core, states.spark_identity];
  if (essentials.some((s) => s === "INDISPONIVEL" || s === "DESCONHECIDA")) return "INDISPONIVEL";
  if (essentials.some((s) => s === "DEGRADADA") || states.worker !== "SAUDAVEL") return "DEGRADADA";
  return "SAUDAVEL";
}
