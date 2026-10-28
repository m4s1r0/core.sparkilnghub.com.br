import { MigrationError } from "../../platform/migrations/manifest.js";

/** Códigos estáveis de falha de provisionamento (contracts/openapi.yaml `ProvisioningTask`). */
export type ProvisioningErrorCode =
  | "PROVISIONING_RESOURCE_CONFLICT"
  | "PROVISIONING_MIGRATION_FAILED"
  | "PROVISIONING_MIGRATION_INTERRUPTED"
  | "PROVISIONING_PRIVILEGE_MISSING"
  | "PROVISIONING_ARTIFACT_INVALID"
  | "PROVISIONING_ARTIFACT_CHANGED"
  | "PROVISIONING_DEPENDENCY_UNAVAILABLE"
  | "PROVISIONING_VERIFICATION_FAILED"
  | "PROVISIONING_NOT_IN_MAINTENANCE"
  | "PROVISIONING_NO_PRIOR_BACKUP";

const MESSAGES: Record<ProvisioningErrorCode, string> = {
  PROVISIONING_RESOURCE_CONFLICT:
    "Já existe um recurso com o nome reservado para esta instância e ele não pertence a ela. Nada foi alterado; siga o procedimento operacional.",
  PROVISIONING_MIGRATION_FAILED:
    "Uma versão do artefato de migração do produto falhou. Corrija o artefato e siga o procedimento operacional.",
  PROVISIONING_MIGRATION_INTERRUPTED:
    "Uma versão de migração foi interrompida no meio e não pode ser repetida automaticamente. Siga o procedimento operacional.",
  PROVISIONING_PRIVILEGE_MISSING:
    "A credencial de provisionamento não tem o privilégio necessário. Ajuste os privilégios e repita.",
  PROVISIONING_ARTIFACT_INVALID: "O artefato de migração implantado não passou na verificação.",
  PROVISIONING_ARTIFACT_CHANGED:
    "O artefato implantado mudou depois da solicitação. Solicite uma nova instância.",
  PROVISIONING_DEPENDENCY_UNAVAILABLE:
    "O banco de dados ficou indisponível durante o provisionamento. Repita depois que ele voltar.",
  PROVISIONING_VERIFICATION_FAILED:
    "A verificação final da instância falhou. Siga o procedimento operacional.",
  PROVISIONING_NOT_IN_MAINTENANCE:
    "A instância deixou de estar em manutenção durante a execução. Coloque-a em manutenção de novo e repita.",
  PROVISIONING_NO_PRIOR_BACKUP:
    "Não há backup bem-sucedido registrado desde a entrada em manutenção. Registre um backup e repita.",
};

/** Repetir pela interface pode resolver sem procedimento operacional (research.md R-07, R-08). */
const RETRYABLE: ReadonlySet<ProvisioningErrorCode> = new Set([
  "PROVISIONING_PRIVILEGE_MISSING",
  "PROVISIONING_DEPENDENCY_UNAVAILABLE",
  "PROVISIONING_NOT_IN_MAINTENANCE",
  "PROVISIONING_NO_PRIOR_BACKUP",
]);

/** Repetir pela interface pode resolver? (`retryable` exibido no painel) */
export const isRetryableCode = (code: string) => RETRYABLE.has(code as ProvisioningErrorCode);

/** Falha esperada de uma etapa, com código estável e mensagem segura. */
export class ProvisioningFailure extends Error {
  constructor(
    readonly code: ProvisioningErrorCode,
    /** Detalhe técnico só para o log (nunca SQL nem senha). */
    readonly detail?: string,
  ) {
    super(MESSAGES[code]);
    this.name = "ProvisioningFailure";
  }
}

const TRANSIENT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "PROTOCOL_CONNECTION_LOST",
  "ETIMEDOUT",
  "EPIPE",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_OPTION_PREVENTS_STATEMENT",
  "ER_SERVER_SHUTDOWN",
]);

const PRIVILEGE_CODES = new Set([
  "ER_DBACCESS_DENIED_ERROR",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  "ER_ACCESS_DENIED_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_CANT_CREATE_USER_WITH_GRANT",
]);

export interface Classified {
  transient: boolean;
  code: ProvisioningErrorCode;
  message: string;
  retryable: boolean;
}

/** Transitória → nova tentativa automática; senão, falha visível (research.md R-08). */
export function classify(error: unknown): Classified {
  const result = (code: ProvisioningErrorCode, transient: boolean): Classified => ({
    transient,
    code,
    message: MESSAGES[code],
    retryable: RETRYABLE.has(code) || transient,
  });
  if (error instanceof ProvisioningFailure) return result(error.code, false);
  if (error instanceof MigrationError) {
    if (error.code === "SCHEMA_FAILED") return result("PROVISIONING_MIGRATION_INTERRUPTED", false);
    if (error.code === "MIGRATION_FAILED") {
      const cause = (error as { cause?: unknown }).cause;
      const causeCode = (cause as { code?: string } | undefined)?.code ?? "";
      // Conexão perdida antes da versão começar fica marcada como falha no histórico: R-07.
      return TRANSIENT_CODES.has(causeCode)
        ? result("PROVISIONING_MIGRATION_INTERRUPTED", false)
        : result("PROVISIONING_MIGRATION_FAILED", false);
    }
    return result("PROVISIONING_ARTIFACT_INVALID", false);
  }
  const code = (error as { code?: string }).code ?? "";
  if (TRANSIENT_CODES.has(code)) return result("PROVISIONING_DEPENDENCY_UNAVAILABLE", true);
  if (PRIVILEGE_CODES.has(code)) return result("PROVISIONING_PRIVILEGE_MISSING", false);
  return result("PROVISIONING_VERIFICATION_FAILED", false);
}

/** Espera progressiva: 5 s × 3^(n−1), limitada a 5 min (research.md R-08). */
export function backoffMs(attempt: number): number {
  return Math.min(5_000 * 3 ** Math.max(0, attempt - 1), 5 * 60_000);
}

/** Interrupção simulada pelos testes (gancho `afterEffect`): o executor não registra nada. */
export class SimulatedCrash extends Error {
  constructor(step: string) {
    super(`Queda simulada após o efeito da etapa ${step}`);
    this.name = "SimulatedCrash";
  }
}
