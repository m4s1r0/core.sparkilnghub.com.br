import { sql, type Kysely, type RawBuilder } from "kysely";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { scrub } from "../../platform/logging/logger.js";

/** Tipos de evento de segurança (FR-030). A consulta desses eventos chega em F08-Core. */
export const SecurityEventTypes = [
  "bootstrap",
  "login",
  "login_mfa",
  "logout",
  "sessao_expirada",
  "sessoes_revogadas",
  "reautenticacao",
  "mfa_cadastrado",
  "codigo_recuperacao_usado",
  "convite_criado",
  "convite_aceito",
  "convite_reenviado",
  "convite_revogado",
  "admin_inativado",
  "admin_reativado",
  "papel_alterado",
  "vinculo_revogado",
  "bloqueio",
  "desbloqueio",
  "pedido_recuperacao",
  "link_recuperacao_gerado",
  "senha_trocada",
  "login_produto",
  "logout_produto",
  "credencial_aplicacao",
  "projecao_reconciliada",
  "conexao_entregue",
] as const;
export type SecurityEventType = (typeof SecurityEventTypes)[number];

export interface SecurityEvent {
  type: SecurityEventType;
  actorKind: "usuario" | "sistema" | "aplicacao";
  actorAccountId?: string | null;
  targetAccountId?: string | null;
  instanceId?: string | null;
  result: "sucesso" | "falha" | "negado";
  /** Contexto sem segredos; chaves sensíveis são mascaradas de qualquer forma. */
  detail?: Record<string, unknown>;
  correlationId?: string | null;
  /** IP e agente só existem aqui (FR-031); apagados após 180 dias (F08-Core). */
  ip?: string | null;
  userAgent?: string | null;
  at: Date;
}

const bin = (id: string | null | undefined) => (id ? uuidToBin(id) : null);

/**
 * Grava um evento de segurança. Somente inserção: nenhum caminho de código altera ou apaga esta
 * tabela (verificado por teste). Aceita conexão ou transação, para registrar junto da operação.
 */
export interface SecurityEventFilter {
  instance_id?: string;
  actor_account_id?: string;
  type?: string;
  result?: string;
  from?: Date;
  to?: Date;
}

export interface SecurityEventItem {
  id: string;
  type: string;
  actor_kind: string;
  actor_account_id: string | null;
  target_account_id: string | null;
  instance_id: string | null;
  result: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SecurityEventsPage {
  items: SecurityEventItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Lista eventos de segurança com filtros e paginação (F08-Core US3, SC-033).
 * Campos ip/user_agent retornam null após 180 dias (limpeza pelo worker).
 * Usa índice k_security_event_instance para filtro por instance_id.
 */
export async function listSecurityEvents(
  db: Kysely<unknown>,
  filters: SecurityEventFilter,
  page: number,
  pageSize: number,
): Promise<SecurityEventsPage> {
  const offset = (page - 1) * pageSize;

  const conditions: RawBuilder<unknown>[] = [];
  if (filters.instance_id) conditions.push(sql`instance_id = ${uuidToBin(filters.instance_id)}`);
  if (filters.actor_account_id)
    conditions.push(sql`actor_account_id = ${uuidToBin(filters.actor_account_id)}`);
  if (filters.type) conditions.push(sql`type = ${filters.type}`);
  if (filters.result) conditions.push(sql`result = ${filters.result}`);
  if (filters.from) conditions.push(sql`created_at >= ${filters.from}`);
  if (filters.to) conditions.push(sql`created_at <= ${filters.to}`);

  const where: RawBuilder<unknown> = conditions.length
    ? sql.join(conditions, sql` AND `)
    : sql`1=1`;

  const [countResult, dataResult] = await Promise.all([
    sql<{ total: number }>`
      SELECT COUNT(*) AS total FROM security_event WHERE ${where}
    `.execute(db),
    sql<{
      id: Buffer;
      type: string;
      actor_kind: string;
      actor_account_id: Buffer | null;
      target_account_id: Buffer | null;
      instance_id: Buffer | null;
      result: string;
      ip: string | null;
      user_agent: string | null;
      created_at: Date;
    }>`
      SELECT id, type, actor_kind, actor_account_id, target_account_id, instance_id, result,
             ip, user_agent, created_at
        FROM security_event
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${sql.lit(pageSize)} OFFSET ${sql.lit(offset)}
    `.execute(db),
  ]);

  const items: SecurityEventItem[] = dataResult.rows.map((r) => ({
    id: binToUuid(r.id),
    type: r.type,
    actor_kind: r.actor_kind,
    actor_account_id: r.actor_account_id ? binToUuid(r.actor_account_id) : null,
    target_account_id: r.target_account_id ? binToUuid(r.target_account_id) : null,
    instance_id: r.instance_id ? binToUuid(r.instance_id) : null,
    result: r.result,
    ip: r.ip,
    user_agent: r.user_agent,
    created_at: new Date(r.created_at).toISOString(),
  }));

  return { items, total: Number(countResult.rows[0]?.total ?? 0), page, page_size: pageSize };
}

export async function recordSecurityEvent(
  db: Kysely<unknown>,
  event: SecurityEvent,
): Promise<void> {
  const detail = event.detail ? JSON.stringify(scrub(event.detail)) : null;
  await sql`INSERT INTO security_event
      (id, type, actor_account_id, actor_kind, target_account_id, instance_id, result, detail,
       correlation_id, ip, user_agent, created_at)
    VALUES (${uuidToBin(newId())}, ${event.type}, ${bin(event.actorAccountId)}, ${event.actorKind},
            ${bin(event.targetAccountId)}, ${bin(event.instanceId)}, ${event.result}, ${detail},
            ${event.correlationId ?? null}, ${event.ip?.slice(0, 45) ?? null},
            ${event.userAgent?.slice(0, 300) ?? null}, ${event.at})`.execute(db);
}
