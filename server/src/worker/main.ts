import { hostname } from "node:os";
import { sql } from "kysely";
import "../modules/access-projection/reconcile.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { newId, uuidToBin } from "../platform/ids.js";
import { createLogger } from "../platform/logging/logger.js";
import { processDueJobs } from "./jobs/access-sync.js";
import { processDueProvisioning } from "./jobs/provisioning.js";

const HEARTBEAT_MS = 10_000;
const SYNC_POLL_MS = 5_000;
const PROVISIONING_POLL_MS = 2_000;
const RETENTION_HOURS = 24;

const logger = createLogger({ name: "worker" });

/**
 * Trabalhador de tarefas: mesmo código e artefato do servidor, processo separado (FR-009).
 * Publica o sinal de vida, processa a sincronização da projeção de acesso (F01 R-10) e, desde
 * F02, as tarefas de provisionamento — única peça que carrega a credencial `provisioner`.
 */
async function main() {
  const config = loadConfig({
    credentials: ["worker", "access", "provisioner"],
    secrets: ["INSTANCE_SECRET_KEY"],
  });
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

  const ctx = createAppContext(config, pools, { role: "worker", logger });
  let syncing = false;
  const sync = async () => {
    if (syncing) return;
    syncing = true;
    try {
      const processed = await processDueJobs(ctx);
      if (processed > 0) logger.info({ processed }, "Sincronização da projeção de acesso");
    } catch (error) {
      logger.warn({ err: error }, "Falha ao processar sincronização da projeção");
    } finally {
      syncing = false;
    }
  };
  const syncTimer = setInterval(() => void sync(), SYNC_POLL_MS);

  let provisioning = false;
  const provision = async () => {
    if (provisioning) return;
    provisioning = true;
    try {
      await processDueProvisioning({ ctx, config, workerId });
    } catch (error) {
      logger.warn({ err: error }, "Falha ao processar tarefas de provisionamento");
    } finally {
      provisioning = false;
    }
  };
  const provisioningTimer = setInterval(() => void provision(), PROVISIONING_POLL_MS);

  const shutdown = async (signal: string) => {
    clearInterval(timer);
    clearInterval(syncTimer);
    clearInterval(provisioningTimer);
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
