import { CORRELATION_HEADER, type ErrorEnvelope } from "@sparkcore/contracts";

/** Falha de chamada à API com mensagem segura para exibição. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly correlationId: string | null,
    readonly status: number | null,
    readonly code: string,
    /** Campo (ponteiro JSON) do envelope de erro, quando houver. */
    readonly field: string | null = null,
    /** Segundos de `Retry-After` (limitação, indisponibilidade). */
    readonly retryAfter: number | null = null,
    /** Itens do envelope (ex.: instâncias que impedem uma inativação). */
    readonly details: { field: string; code: string; message: string }[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiResponse<T> {
  status: number;
  correlationId: string | null;
  body: T;
}

const NETWORK_MESSAGE =
  "Não foi possível consultar a situação. Verifique a conexão e tente novamente.";

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: { message?: unknown } }).error?.message === "string"
  );
}

/**
 * GET em JSON com identificador de correlação por requisição. `accept` lista os status em que o
 * corpo é o recurso (ex.: 200 e 503 para a situação do sistema); os demais viram `ApiError`.
 */
export async function getJson<T>(
  url: string,
  accept: readonly number[] = [200],
): Promise<ApiResponse<T>> {
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", [CORRELATION_HEADER]: requestId },
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, requestId, null, "NETWORK_ERROR");
  }
  const correlationId = response.headers.get(CORRELATION_HEADER) ?? requestId;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(NETWORK_MESSAGE, correlationId, response.status, "INVALID_RESPONSE");
  }
  if (accept.includes(response.status))
    return { status: response.status, correlationId, body: body as T };
  throw toApiError(response, body, correlationId);
}

function toApiError(response: Response, body: unknown, correlationId: string): ApiError {
  const retryAfter = Number(response.headers.get("retry-after")) || null;
  if (isErrorEnvelope(body)) {
    return new ApiError(
      body.error.message,
      body.error.correlationId,
      response.status,
      body.error.code,
      body.error.field,
      retryAfter,
      body.error.details ?? [],
    );
  }
  return new ApiError(
    ACTION_MESSAGE,
    correlationId,
    response.status,
    "UNEXPECTED_STATUS",
    null,
    retryAfter,
  );
}

const ACTION_MESSAGE =
  "Não foi possível concluir a operação. Verifique a conexão e tente novamente.";

/**
 * Requisição que altera estado (ou leitura autenticada). Envia JSON, correlação e, quando
 * informada, `Idempotency-Key`. Respostas 2xx devolvem o corpo (ou `undefined` em 204); as
 * demais viram `ApiError` com a mensagem segura do servidor.
 */
export async function requestJson<T>(
  method: "GET" | "POST" | "PUT",
  url: string,
  options: { body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        [CORRELATION_HEADER]: requestId,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError(ACTION_MESSAGE, requestId, null, "NETWORK_ERROR");
  }
  const correlationId = response.headers.get(CORRELATION_HEADER) ?? requestId;
  if (response.status === 204) return undefined as T;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(ACTION_MESSAGE, correlationId, response.status, "INVALID_RESPONSE");
  }
  if (response.ok) return body as T;
  throw toApiError(response, body, correlationId);
}
