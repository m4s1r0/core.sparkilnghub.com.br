import { sql, type Kysely } from "kysely";

export interface DashboardStats {
  instances_by_state: Record<string, number>;
  pending_provisionings: number;
  failed_provisionings: number;
  instances_without_recent_usage: { last7d: number; last30d: number };
  instances_without_any_data: number;
  instances_with_telemetry_delay: number;
  instances_with_schema_issue: number;
  cleanup_last_run: string | null;
  cleanup_last_count: number | null;
  calculated_at: string;
}

/**
 * Agrega métricas operacionais do Core para o painel administrativo (F08-Core US2, SC-038/039).
 * Lê exclusivamente metadados do spark_core — nunca bancos operacionais das instâncias (SC-036).
 */
export async function getDashboardStats(core: Kysely<unknown>): Promise<DashboardStats> {
  const stateResult = await sql<{ state: string; cnt: number }>`
    SELECT state, COUNT(*) AS cnt FROM instance GROUP BY state
  `.execute(core);

  const provResult = await sql<{ pending: number | null; failed: number | null }>`
    SELECT
      SUM(status IN ('pendente','em_execucao')) AS pending,
      SUM(status = 'falhou')                    AS failed
    FROM admin_task
  `.execute(core);

  const usageResult = await sql<{ last7d: number; last30d: number; no_data: number }>`
    SELECT
      SUM(ev7.instance_id   IS NULL) AS last7d,
      SUM(ev30.instance_id  IS NULL) AS last30d,
      SUM(evAll.instance_id IS NULL) AS no_data
    FROM instance i
    LEFT JOIN (
      SELECT DISTINCT instance_id FROM instance_usage_event
       WHERE occurred_at >= NOW() - INTERVAL 7 DAY
    ) ev7   ON ev7.instance_id   = i.id
    LEFT JOIN (
      SELECT DISTINCT instance_id FROM instance_usage_event
       WHERE occurred_at >= NOW() - INTERVAL 30 DAY
    ) ev30  ON ev30.instance_id  = i.id
    LEFT JOIN (
      SELECT DISTINCT instance_id FROM instance_usage_event
    ) evAll ON evAll.instance_id = i.id
    WHERE i.state IN ('ATIVA','PRONTA')
  `.execute(core);

  const delayResult = await sql<{ cnt: number }>`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT instance_id,
             MAX(received_at)  AS last_recv,
             MAX(occurred_at)  AS last_occur
        FROM instance_usage_event
       GROUP BY instance_id
      HAVING TIMESTAMPDIFF(SECOND, last_occur, last_recv) > 86400
    ) sub
  `.execute(core);

  const cleanupResult = await sql<{
    cleanup_last_run: Date | null;
    cleanup_last_count: number | null;
  }>`
    SELECT cleanup_last_run, cleanup_last_count
      FROM worker_heartbeat
     ORDER BY last_seen_at DESC
     LIMIT 1
  `.execute(core);

  const instancesByState: Record<string, number> = {};
  for (const row of stateResult.rows) {
    instancesByState[row.state] = Number(row.cnt);
  }

  const provRow = provResult.rows[0];
  const usageRow = usageResult.rows[0];
  const cleanRow = cleanupResult.rows[0];

  return {
    instances_by_state: instancesByState,
    pending_provisionings: Number(provRow?.pending ?? 0),
    failed_provisionings: Number(provRow?.failed ?? 0),
    instances_without_recent_usage: {
      last7d: Number(usageRow?.last7d ?? 0),
      last30d: Number(usageRow?.last30d ?? 0),
    },
    instances_without_any_data: Number(usageRow?.no_data ?? 0),
    instances_with_telemetry_delay: Number(delayResult.rows[0]?.cnt ?? 0),
    instances_with_schema_issue: 0,
    cleanup_last_run: cleanRow?.cleanup_last_run
      ? new Date(cleanRow.cleanup_last_run).toISOString()
      : null,
    cleanup_last_count:
      cleanRow?.cleanup_last_count != null ? Number(cleanRow.cleanup_last_count) : null,
    calculated_at: new Date().toISOString(),
  };
}
