import { CORRELATION_HEADER, type ErrorEnvelope } from "@sparkcore/contracts";

/** Falha de chamada à API com mensagem segura para exibição. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly correlationId: string | null,
    readonly status: number | null,
    readonly code: string,
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
  if (isErrorEnvelope(body)) {
    throw new ApiError(
      body.error.message,
      body.error.correlationId,
      response.status,
      body.error.code,
    );
  }
  throw new ApiError(NETWORK_MESSAGE, correlationId, response.status, "UNEXPECTED_STATUS");
}
