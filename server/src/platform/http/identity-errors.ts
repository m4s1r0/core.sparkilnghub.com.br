import { AppError } from "../../app/errors.js";

const UNAVAILABLE = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
]);

/** Falha de conexão com o banco (não erro de consulta). */
export function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && UNAVAILABLE.has(code);
}

/**
 * Identidade indisponível: login, convites, recuperação e MFA respondem erro temporário
 * explícito (constituição II, T-15), sem criar sessão parcial.
 */
export function identityUnavailable(): AppError {
  return new AppError(
    503,
    "SYSTEM_IDENTITY_UNAVAILABLE",
    "O serviço de identidade está temporariamente indisponível. Tente novamente em instantes.",
    { retryable: true, retryAfterSeconds: 10 },
  );
}

/** Executa uma operação de identidade convertendo falha de conexão em 503. */
export async function withIdentity<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isConnectionError(error)) throw identityUnavailable();
    throw error;
  }
}
