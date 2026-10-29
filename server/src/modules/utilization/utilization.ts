import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";

/** Tipos de evento do contrato mínimo do produto de referência (SP-098, contratos/openapi-f08.yaml). */
export const KNOWN_EVENT_KINDS = [
  "atendimentos_iniciados",
  "atendimentos_concluidos",
  "vendas_confirmadas",
  "usuarios_ativos",
] as const;

export type UsageEventKind = (typeof KNOWN_EVENT_KINDS)[number];

export interface UsageBatchEvent {
  event_id: string;
  occurred_at: Date;
  kind: string;
  count: number;
}

export interface UsageBatchRequest {
  batch_id: string;
  events: UsageBatchEvent[];
}

export interface UsageBatchResult {
  events_accepted: number;
  events_discarded: number;
}

export type DataStatus = "ok" | "dados_insuficientes" | "atraso_detectado";

export interface UsageByKind {
  kind: string;
  count: number;
  last_occurred_at: Date;
}

export interface UsageByPeriod {
  instance_id: string;
  period_start: string;
  period_end: string;
  timezone: string;
  events: UsageByKind[];
  data_status: DataStatus;
}

export interface ConsolidatedUsage {
  period_start: string;
  period_end: string;
  timezone: string;
  instances: UsageByPeriod[];
  generated_at: Date;
}

interface BatchRow {
  events_accepted: number;
  events_discarded: number;
}

interface InstanceRow {
  state: string;
}

/** 24 horas em milissegundos — limiar de atraso de telemetria. */
const TELEMETRY_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Recebe um lote de utilização de uma instância com deduplicação por (instance_id, event_id).
 * Idempotente por batch_id: reenvio retorna o resultado original (CA-SC-011).
 * Falha com 403 se a credencial não pertence à instância do path (constituição I, I-01).
 * Falha com 409 se a instância não está em estado que aceita utilização (SC-037).
 */
/**
 * @param credentialInstanceId — UUID da instância no app_credential (null = credencial por produto,
 *   que verifica apenas productCode). CA-SC-011: credencial de instância B recusada no path de A.
 */
export async function receiveUsageBatch(
  core: Kysely<unknown>,
  instanceId: string,
  credentialInstanceId: string | null,
  request: UsageBatchRequest,
  now: Date,
  logger: { warn(obj: object, msg: string): void },
): Promise<{ result: UsageBatchResult; status: 202 | 200 }> {
  // Credencial vinculada a uma instância: deve ser exatamente esta instância (CA-SC-011).
  if (credentialInstanceId !== null && credentialInstanceId !== instanceId) {
    throw new AppError(
      403,
      "CREDENTIAL_INSTANCE_MISMATCH",
      "Credencial não pertence a esta instância.",
    );
  }

  const instanceBin = uuidToBin(instanceId);

  // Verificar estado da instância
  const { rows: instRows } = await sql<InstanceRow>`
    SELECT state FROM instance WHERE id = ${instanceBin}
  `.execute(core);
  const inst = instRows[0];
  if (!inst) {
    throw new AppError(404, "INSTANCE_NOT_FOUND", "Instância não encontrada.");
  }
  if (inst.state !== "ATIVA" && inst.state !== "PRONTA") {
    throw new AppError(
      409,
      "CONFLICT_STATE",
      "Instância não está em estado que aceita utilização.",
      {
        retryable: false,
      },
    );
  }

  // Idempotência de lote: se batch_id já existe, retornar resultado original
  const { rows: existingBatch } = await sql<BatchRow>`
    SELECT events_accepted, events_discarded FROM instance_usage_batch
     WHERE instance_id = ${instanceBin} AND batch_id = ${request.batch_id}
  `.execute(core);
  if (existingBatch[0]) {
    return { result: existingBatch[0], status: 200 };
  }

  let accepted = 0;
  let discarded = 0;

  // Processar eventos via INSERT IGNORE (deduplicação por (instance_id, event_id))
  if (request.events.length > 0) {
    for (const event of request.events) {
      if (!(KNOWN_EVENT_KINDS as readonly string[]).includes(event.kind)) {
        logger.warn({ kind: event.kind }, "Tipo de evento de utilização desconhecido");
      }
      const { numAffectedRows } = await sql`
        INSERT IGNORE INTO instance_usage_event
          (id, instance_id, event_id, occurred_at, received_at, kind, count)
        VALUES (${uuidToBin(newId())}, ${instanceBin}, ${event.event_id},
                ${event.occurred_at}, ${now}, ${event.kind}, ${event.count})
      `.execute(core);
      if (Number(numAffectedRows) > 0) {
        accepted++;
      } else {
        discarded++;
      }
    }
  }

  // Registrar resumo do lote; em corrida de dois envios simultâneos o segundo pega dup-key.
  try {
    await sql`
      INSERT INTO instance_usage_batch
        (id, instance_id, batch_id, received_at, events_accepted, events_discarded)
      VALUES (${uuidToBin(newId())}, ${instanceBin}, ${request.batch_id},
              ${now}, ${accepted}, ${discarded})
    `.execute(core);
  } catch (err) {
    // ER_DUP_ENTRY (1062): corrida de dois envios do mesmo batch_id — retornar o que já existe.
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      const { rows: dup } = await sql<BatchRow>`
        SELECT events_accepted, events_discarded FROM instance_usage_batch
         WHERE instance_id = ${instanceBin} AND batch_id = ${request.batch_id}
      `.execute(core);
      if (dup[0]) return { result: dup[0], status: 200 };
    }
    throw err;
  }

  return { result: { events_accepted: accepted, events_discarded: discarded }, status: 202 };
}

/**
 * Retorna os dados de utilização de uma instância no período informado.
 * Eventos são agrupados por kind usando occurred_at (não received_at) — SC-040.
 * data_status: dados_insuficientes quando sem eventos (CA-SC-012).
 */
export async function getInstanceUsage(
  core: Kysely<unknown>,
  instanceId: string,
  from: Date,
  to: Date,
  timezone: string,
): Promise<UsageByPeriod> {
  const instanceBin = uuidToBin(instanceId);
  const { rows: eventRows } = await sql<{
    kind: string;
    total_count: number;
    last_occurred_at: Date;
  }>`
    SELECT kind,
           SUM(count) AS total_count,
           MAX(occurred_at) AS last_occurred_at
      FROM instance_usage_event
     WHERE instance_id = ${instanceBin}
       AND occurred_at >= ${from}
       AND occurred_at <= ${to}
     GROUP BY kind
     ORDER BY kind
  `.execute(core);

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  if (eventRows.length === 0) {
    return {
      instance_id: instanceId,
      period_start: fromStr,
      period_end: toStr,
      timezone,
      events: [],
      data_status: "dados_insuficientes",
    };
  }

  // Verificar atraso de telemetria: received_at - max(occurred_at) > 24h
  const { rows: delayRows } = await sql<{ received_at: Date; occurred_at: Date }>`
    SELECT received_at, occurred_at
      FROM instance_usage_event
     WHERE instance_id = ${instanceBin}
     ORDER BY received_at DESC
     LIMIT 1
  `.execute(core);

  let data_status: DataStatus = "ok";
  if (delayRows[0]) {
    const delay = delayRows[0].received_at.getTime() - delayRows[0].occurred_at.getTime();
    if (delay > TELEMETRY_DELAY_MS) data_status = "atraso_detectado";
  }

  return {
    instance_id: instanceId,
    period_start: fromStr,
    period_end: toStr,
    timezone,
    events: eventRows.map((r) => ({
      kind: r.kind,
      count: Number(r.total_count),
      last_occurred_at: r.last_occurred_at,
    })),
    data_status,
  };
}

/**
 * Retorna utilização consolidada de todas as instâncias (ou de uma instância específica)
 * no período. Nunca lê bancos operacionais das instâncias (SC-036).
 */
export async function getConsolidatedUsage(
  core: Kysely<unknown>,
  from: Date,
  to: Date,
  timezone: string,
  instanceIdFilter?: string,
): Promise<ConsolidatedUsage> {
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  // Buscar instâncias ativas ou com dados no período
  const { rows: instanceRows } = instanceIdFilter
    ? await sql<{ id: Buffer }>`
        SELECT id FROM instance WHERE id = ${uuidToBin(instanceIdFilter)}
      `.execute(core)
    : await sql<{ id: Buffer }>`
        SELECT id FROM instance WHERE state IN ('ATIVA','PRONTA','SUSPENSA','MANUTENCAO')
        ORDER BY id
      `.execute(core);

  const instances: UsageByPeriod[] = await Promise.all(
    instanceRows.map((row) => getInstanceUsage(core, binToUuid(row.id), from, to, timezone)),
  );

  return {
    period_start: fromStr,
    period_end: toStr,
    timezone,
    instances,
    generated_at: new Date(),
  };
}
