import { hostname } from "node:os";
import { sql } from "kysely";
import { loadConfig } from "../platform/config/load.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { newId, uuidToBin } from "../platform/ids.js";
import { createLogger } from "../platform/logging/logger.js";

const HEARTBEAT_MS = 10_000;
const RETENTION_HOURS = 24;

const logger = createLogger({ name: "worker" });

/**
 * Trabalhador de tarefas: mesmo código e artefato do servidor, processo separado (FR-009).
 * Em F00 só publica o sinal de vida; tarefas persistentes chegam em F02.
 */
async function main() {
  const config = loadConfig({ credentials: ["worker"] });
  const pools = new PoolRegistry(config);
  const db = pools.get("worker", "spark_core");
  const workerId = newId();
  const id = uuidToBin(workerId);

  await sql`INSERT INTO worker_heartbeat (worker_id, hostname, app_version, started_at, last_seen_at)
            VALUES (${id}, ${hostname().slice(0, 255)}, ${config.APP_VERSION}, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`.execute(
    db,
  );
  logger.info({ workerId, version: config.APP_VERSION }, "Trabalhador iniciado");

  const beat = async () => {
    try {
      await sql`UPDATE worker_heartbeat SET last_seen_at = UTC_TIMESTAMP(6) WHERE worker_id = ${id}`.execute(
        db,
      );
      await sql`DELETE FROM worker_heartbeat
                WHERE last_seen_at < UTC_TIMESTAMP(6) - INTERVAL ${sql.lit(RETENTION_HOURS)} HOUR`.execute(
        db,
      );
    } catch (error) {
      logger.warn({ err: error }, "Falha ao registrar sinal de vida");
    }
  };
  const timer = setInterval(() => void beat(), HEARTBEAT_MS);

  const shutdown = async (signal: string) => {
    clearInterval(timer);
    logger.info({ signal, workerId }, "Encerrando trabalhador");
    await pools.closeAll();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Falha ao iniciar o trabalhador");
  process.exit(1);
});
