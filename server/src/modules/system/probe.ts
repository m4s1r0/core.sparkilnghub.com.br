import type { ComponentStatus, SystemStatus } from "@sparkcore/contracts";
import { sql } from "kysely";
import type { Config } from "../../platform/config/load.js";
import type { PoolRegistry } from "../../platform/db/pools.js";
import { CORE_DATABASES, type CoreDatabase } from "../../platform/migrations/core-migrations.js";
import { type LoadedManifest, loadManifest } from "../../platform/migrations/manifest.js";
import {
  checkHistory,
  HISTORY_TABLE,
  type HistoryRow,
} from "../../platform/migrations/migrator.js";
import { migrationsDir } from "../../platform/paths.js";
import { deriveDatabase, deriveOverall, deriveWorker } from "./derive-status.js";

const PROBE_TIMEOUT_MS = 2_000;

class ProbeTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout("timeout")), PROBE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const isMissingTable = (error: unknown) => (error as { code?: string }).code === "ER_NO_SUCH_TABLE";

/**
 * Situação operacional do Core (FR-012). Consulta só metadados técnicos — histórico de schema e
 * sinal de vida do trabalhador —, nunca dados de negócio, com a credencial web (sem DDL).
 */
export class SystemStatusService {
  #manifests: Promise<Record<CoreDatabase, LoadedManifest>> | undefined;

  constructor(
    private readonly config: Config,
    private readonly pools: PoolRegistry,
    private readonly databases: Readonly<Record<CoreDatabase, string>> = {
      spark_core: "spark_core",
      spark_identity: "spark_identity",
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  #loadManifests() {
    this.#manifests ??= (async () => {
      const entries = await Promise.all(
        CORE_DATABASES.map(async (db) => [db, await loadManifest(migrationsDir(db))] as const),
      );
      return Object.fromEntries(entries) as Record<CoreDatabase, LoadedManifest>;
    })();
    return this.#manifests;
  }

  async #probeDatabase(database: CoreDatabase, loaded: LoadedManifest): Promise<ComponentStatus> {
    const checkedAt = this.now().toISOString();
    const expected = loaded.migrations.length;
    try {
      const db = this.pools.get<Record<string, HistoryRow>>("web", this.databases[database]);
      let rows: HistoryRow[];
      try {
        const result = await withTimeout(
          sql<HistoryRow>`SELECT version, name, checksum, artifact, status FROM ${sql.table(HISTORY_TABLE)} ORDER BY version`.execute(
            db,
          ),
        );
        rows = result.rows;
      } catch (error) {
        if (!isMissingTable(error)) throw error;
        rows = [];
      }
      const check = checkHistory(rows, loaded);
      const derived = deriveDatabase({
        reachable: true,
        appliedVersion: check.appliedVersion,
        expectedVersion: expected,
        problem: check.problem,
      });
      return {
        name: database,
        status: derived.status,
        schemaVersion: check.appliedVersion,
        expectedSchemaVersion: expected,
        reason: derived.reason,
        checkedAt,
      };
    } catch {
      const derived = deriveDatabase({
        reachable: false,
        appliedVersion: 0,
        expectedVersion: expected,
        problem: null,
      });
      return {
        name: database,
        status: derived.status,
        schemaVersion: null,
        expectedSchemaVersion: expected,
        reason: derived.reason,
        checkedAt,
      };
    }
  }

  async #probeWorker(): Promise<ComponentStatus> {
    const now = this.now();
    let probe: { reachable: boolean; lastSeen: Date[] };
    try {
      const db = this.pools.get<Record<string, { last_seen_at: Date }>>(
        "web",
        this.databases.spark_core,
      );
      const result = await withTimeout(
        sql<{
          last_seen_at: Date;
        }>`SELECT last_seen_at FROM worker_heartbeat ORDER BY last_seen_at DESC LIMIT 5`.execute(
          db,
        ),
      );
      probe = { reachable: true, lastSeen: result.rows.map((row) => new Date(row.last_seen_at)) };
    } catch (error) {
      probe = isMissingTable(error)
        ? { reachable: true, lastSeen: [] }
        : { reachable: false, lastSeen: [] };
    }
    const derived = deriveWorker(probe, now);
    return {
      name: "worker",
      status: derived.status,
      reason: derived.reason,
      checkedAt: now.toISOString(),
    };
  }

  /** Tarefas de provisionamento pendentes, aguardando repetição e com falha (F02, R-20). */
  async #provisioningCounts(): Promise<SystemStatus["provisioning"]> {
    try {
      const db = this.pools.get<Record<string, never>>("web", this.databases.spark_core);
      const { rows } = await withTimeout(
        sql<{ pending: number | null; waiting: number | null; failed: number | null }>`
          SELECT SUM(status IN ('pendente', 'em_execucao')) AS pending,
                 SUM(status = 'aguardando_repeticao') AS waiting,
                 SUM(status = 'falhou') AS failed
            FROM admin_task`.execute(db),
      );
      const row = rows[0];
      return {
        pending: Number(row?.pending ?? 0),
        waitingRetry: Number(row?.waiting ?? 0),
        failed: Number(row?.failed ?? 0),
      };
    } catch {
      return undefined;
    }
  }

  async check(): Promise<SystemStatus> {
    const manifests = await this.#loadManifests();
    const [core, identity, worker, provisioning] = await Promise.all([
      this.#probeDatabase("spark_core", manifests.spark_core),
      this.#probeDatabase("spark_identity", manifests.spark_identity),
      this.#probeWorker(),
      this.#provisioningCounts(),
    ]);
    const checkedAt = this.now().toISOString();
    const server: ComponentStatus = { name: "server", status: "SAUDAVEL", reason: null, checkedAt };
    return {
      service: "sparkcore",
      version: this.config.APP_VERSION,
      environment: this.config.SPARK_ENV,
      status: deriveOverall({
        server: server.status,
        spark_core: core.status,
        spark_identity: identity.status,
        worker: worker.status,
      }),
      checkedAt,
      components: [server, worker, core, identity],
      ...(provisioning ? { provisioning } : {}),
    };
  }
}
