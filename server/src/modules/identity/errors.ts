import { AppError } from "../../app/errors.js";
import { PASSWORD_PROBLEM_MESSAGE, type PasswordProblem } from "./password.js";

/** Erros de identidade com mensagens seguras (não revelam se a conta existe — FR-004). */
export const identityErrors = {
  invalidCredentials: () =>
    new AppError(401, "AUTH_INVALID_CREDENTIALS", "E-mail ou senha incorretos."),
  throttled: (retryAfterSeconds: number) =>
    new AppError(
      429,
      "AUTH_THROTTLED",
      "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      { retryable: true, retryAfterSeconds },
    ),
  mfaInvalid: () => new AppError(401, "AUTH_MFA_INVALID", "Código inválido ou expirado."),
  invitationInvalid: () =>
    new AppError(404, "INVITATION_INVALID", "Convite inválido, já usado ou expirado."),
  invitationMismatch: () =>
    new AppError(
      409,
      "CONFLICT_INVITATION_ACCOUNT_MISMATCH",
      "Este convite é para outra conta. Saia e entre com a conta convidada.",
    ),
  passwordPolicy: (problem: PasswordProblem, field = "/password") =>
    new AppError(422, "PASSWORD_POLICY_REJECTED", PASSWORD_PROBLEM_MESSAGE[problem], { field }),
  missingField: (field: string, message: string) =>
    new AppError(422, "VALIDATION_FAILED", message, { field }),
  mfaAlreadyEnrolled: () =>
    new AppError(
      409,
      "CONFLICT_MFA_ALREADY_ENROLLED",
      "O aplicativo autenticador já está cadastrado.",
    ),
  forbidden: () => new AppError(403, "AUTH_FORBIDDEN", "Você não tem permissão para esta ação."),
  notFound: () => new AppError(404, "NOT_FOUND", "Recurso não encontrado."),
  lastAdmin: () =>
    new AppError(
      409,
      "CONFLICT_LAST_ADMIN",
      "Não é possível remover o último administrador ativo.",
    ),
  versionConflict: () =>
    new AppError(
      409,
      "CONFLICT_VERSION",
      "O registro foi alterado por outra pessoa. Recarregue e tente de novo.",
    ),
};

/** Origem da requisição para eventos e limitação (FR-031: IP só em eventos de segurança). */
export interface RequestInfo {
  ip: string;
  userAgent: string | null;
  correlationId: string;
}
