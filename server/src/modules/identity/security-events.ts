import { sql, type Kysely } from "kysely";
import { newId, uuidToBin } from "../../platform/ids.js";
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
