import { sql, type Kysely, type RawBuilder } from "kysely";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";

/** Ações auditadas pelo Core em F02 (data-model `core_audit_event`). Consulta em F08-Core. */
export type AuditAction =
  | "contratante.criado"
  | "contratante.editado"
  | "contratante.inativado"
  | "contratante.reativado"
  | "produto.editado"
  | "produto.inativado"
  | "produto.reativado"
  | "instancia.solicitada"
  | "instancia.editada"
  | "instancia.transicao"
  | "provisionamento.repetido"
  | "convite_inicial.emitido";

export type AuditObjectType = "contratante" | "produto" | "instancia";

/** `{campo: [anterior, novo]}`; nunca segredo. */
export type AuditChanges = Record<string, readonly [unknown, unknown]>;

export interface AuditEntry {
  actorKind: "usuario" | "sistema";
  actorId: string | null;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId: string;
  changes?: AuditChanges;
  reason?: string | null;
  correlationId?: string | null;
  at: Date;
}

const SECRET_KEY = /pass|senha|secret|segredo|token|hash/i;

/** CPF `***.***.***-12`, CNPJ `**.***.***\/****-12`: só os dígitos verificadores ficam visíveis. */
export function maskDocument(document: unknown): string | null {
  if (typeof document !== "string" || document.length === 0) return null;
  const tail = document.slice(-2);
  return document.length === 11 ? `***.***.***-${tail}` : `**.***.***/****-${tail}`;
}

/** Recusa campos com cara de segredo (erro de programação) e mascara documentos. */
export function safeChanges(changes: AuditChanges): AuditChanges {
  const result: Record<string, readonly [unknown, unknown]> = {};
  for (const [field, [before, after]] of Object.entries(changes)) {
    if (SECRET_KEY.test(field)) throw new Error(`Campo de segredo na auditoria: ${field}`);
    result[field] =
      field === "document" ? [maskDocument(before), maskDocument(after)] : [before, after];
  }
  return result;
}

export interface AuditEventFilter {
  object_type?: string;
  object_id?: string;
  actor_id?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export interface AuditEventItem {
  id: string;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  changes: Record<string, unknown> | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface AuditEventsPage {
  items: AuditEventItem[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Lista eventos de auditoria administrativa com filtros e paginação (F08-Core US4, CA-SC-010).
 * changes retornado como JSON parseado; nenhum campo sensível é exposto.
 * SC-035: sem PUT/DELETE nesta tabela — verificado por teste.
 */
export async function listAuditEvents(
  db: Kysely<unknown>,
  filters: AuditEventFilter,
  page: number,
  pageSize: number,
): Promise<AuditEventsPage> {
  const offset = (page - 1) * pageSize;

  const conditions: RawBuilder<unknown>[] = [];
  if (filters.object_type) conditions.push(sql`object_type = ${filters.object_type}`);
  if (filters.object_id) conditions.push(sql`object_id = ${filters.object_id}`);
  if (filters.actor_id) conditions.push(sql`actor_id = ${uuidToBin(filters.actor_id)}`);
  if (filters.action) conditions.push(sql`action = ${filters.action}`);
  if (filters.from) conditions.push(sql`created_at >= ${filters.from}`);
  if (filters.to) conditions.push(sql`created_at <= ${filters.to}`);

  const where: RawBuilder<unknown> = conditions.length
    ? sql.join(conditions, sql` AND `)
    : sql`1=1`;

  const [countResult, dataResult] = await Promise.all([
    sql<{ total: number }>`
      SELECT COUNT(*) AS total FROM core_audit_event WHERE ${where}
    `.execute(db),
    sql<{
      id: Buffer;
      actor_kind: string;
      actor_id: Buffer | null;
      action: string;
      object_type: string;
      object_id: string;
      changes: string | null;
      reason: string | null;
      correlation_id: Buffer | null;
      created_at: Date;
    }>`
      SELECT id, actor_kind, actor_id, action, object_type, object_id,
             changes, reason, correlation_id, created_at
        FROM core_audit_event
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${sql.lit(pageSize)} OFFSET ${sql.lit(offset)}
    `.execute(db),
  ]);

  const items: AuditEventItem[] = dataResult.rows.map((r) => ({
    id: binToUuid(r.id),
    actor_kind: r.actor_kind,
    actor_id: r.actor_id ? binToUuid(r.actor_id) : null,
    action: r.action,
    object_type: r.object_type,
    object_id: r.object_id,
    changes: r.changes ? (JSON.parse(r.changes) as Record<string, unknown>) : null,
    reason: r.reason,
    correlation_id: r.correlation_id ? binToUuid(r.correlation_id) : null,
    created_at: new Date(r.created_at).toISOString(),
  }));

  return { items, total: Number(countResult.rows[0]?.total ?? 0), page, page_size: pageSize };
}

/**
 * Grava um registro de auditoria administrativa. Somente inserção: nenhum caminho de código
 * altera ou apaga esta tabela (verificado por teste). Aceita conexão ou transação, para registrar
 * junto da operação.
 */
export async function recordAudit(db: Kysely<unknown>, entry: AuditEntry): Promise<void> {
  const changes = entry.changes ? JSON.stringify(safeChanges(entry.changes)) : null;
  await sql`INSERT INTO core_audit_event
      (id, actor_kind, actor_id, action, object_type, object_id, changes, reason, correlation_id,
       created_at)
    VALUES (${uuidToBin(newId())}, ${entry.actorKind},
            ${entry.actorId ? uuidToBin(entry.actorId) : null}, ${entry.action},
            ${entry.objectType}, ${entry.objectId}, ${changes}, ${entry.reason ?? null},
            ${entry.correlationId ?? null}, ${entry.at})`.execute(db);
}
