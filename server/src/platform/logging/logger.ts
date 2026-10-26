import { pino, type LoggerOptions, type Logger } from "pino";

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|dsn/i;
const REDACTED = "[REDACTED]";

/** Substitui, em qualquer profundidade, valores de chaves sensíveis (FR-016, R-10). */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object" || depth > 8) return value;
  // Erros seguem para o serializer (serializeError), que já remove dados sensíveis.
  if (value instanceof Error) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : scrub(inner, depth + 1, seen);
  }
  return out;
}

interface MysqlLikeError extends Error {
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
}

function isMysqlError(err: unknown): err is MysqlLikeError {
  return err instanceof Error && ("sqlState" in err || "sqlMessage" in err || "sql" in err);
}

/**
 * Erros do mysql2 trazem `sql`, `sqlMessage` e `message` com valores já interpolados; no log fica
 * só o código (FR-016). Demais erros mantêm mensagem e pilha.
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { message: String(err) };
  if (isMysqlError(err)) {
    return {
      type: "MysqlError",
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      stack: err.stack?.split("\n").slice(1).join("\n"),
    };
  }
  const out: Record<string, unknown> = { type: err.name, message: err.message, stack: err.stack };
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (err.cause !== undefined) out.cause = serializeError(err.cause);
  return out;
}

export const loggerOptions: LoggerOptions = {
  base: { product: "sparkcore" },
  messageKey: "msg",
  serializers: { err: serializeError, error: serializeError },
  formatters: {
    log: (object) => scrub(object) as Record<string, unknown>,
  },
};

export function createLogger(options: { name?: string; level?: string } = {}): Logger {
  return pino({
    ...loggerOptions,
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    ...(options.name ? { name: options.name } : {}),
  });
}
