import { sql, type Kysely } from "kysely";
import { newId, uuidToBin } from "../../platform/ids.js";

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
