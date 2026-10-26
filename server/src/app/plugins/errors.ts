import type { ErrorEnvelope } from "@sparkcore/contracts";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors.js";

type Body = ErrorEnvelope["error"];

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  body: Omit<Body, "correlationId">,
) {
  const envelope: ErrorEnvelope = { error: { ...body, correlationId: request.id } };
  return reply.status(status).type("application/json; charset=utf-8").send(envelope);
}

const toPointer = (instancePath: string | undefined, missing?: string) => {
  const base = instancePath && instancePath.length > 0 ? instancePath : "";
  return missing ? `${base}/${missing}` : base || null;
};

/**
 * Converte qualquer erro no envelope de conventions.md §4. Mensagens são seguras para exibição:
 * nunca SQL, pilha, caminho de arquivo ou credencial (FR-016). O detalhe técnico vai só para o
 * log, com a mesma correlação e sem valores sensíveis (serializer do logger).
 */
export function registerErrorHandling(
  app: FastifyInstance,
  options: {
    /** Fallback de SPA: rotas GET fora de /api e /health recebem o index.html da interface. */
    spaFallback?: (request: FastifyRequest, reply: FastifyReply) => FastifyReply;
  } = {},
): void {
  app.addHook("onSend", async (request, reply) => {
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("referrer-policy", "no-referrer");
    if (request.url.startsWith("/api/") || request.url.startsWith("/health")) {
      void reply.header("cache-control", "no-store");
    }
  });

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith("/api/") || request.url.startsWith("/health");
    if (options.spaFallback && request.method === "GET" && !isApi) {
      return options.spaFallback(request, reply);
    }
    return send(reply, request, 404, {
      code: "NOT_FOUND",
      message: "Recurso não encontrado.",
      field: null,
      retryable: false,
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      if (error.options.retryAfterSeconds) {
        void reply.header("retry-after", String(error.options.retryAfterSeconds));
      }
      if (error.statusCode >= 500) request.log.error({ err: error }, error.code);
      return send(reply, request, error.statusCode, {
        code: error.code,
        message: error.message,
        field: error.options.field ?? null,
        retryable: error.options.retryable ?? false,
      });
    }

    if (error.validation) {
      const details = error.validation.map((issue) => {
        const missing = (issue.params as { missingProperty?: string } | undefined)?.missingProperty;
        const extra = (issue.params as { additionalProperty?: string } | undefined)
          ?.additionalProperty;
        return {
          field: toPointer(issue.instancePath, missing ?? extra) ?? "/",
          code: extra ? "VALIDATION_UNKNOWN_FIELD" : "VALIDATION_INVALID",
          message: extra ? "Campo não permitido." : "Valor inválido.",
        };
      });
      return send(reply, request, 422, {
        code: "VALIDATION_FAILED",
        message: "A requisição contém campos inválidos.",
        field: details[0]?.field ?? null,
        retryable: false,
        details,
      });
    }

    if (error.statusCode === 400 || error.code?.startsWith("FST_ERR_CTP_")) {
      return send(reply, request, 400, {
        code: "REQUEST_MALFORMED",
        message: "Corpo da requisição malformado.",
        field: null,
        retryable: false,
      });
    }

    if (error.statusCode === 415) {
      return send(reply, request, 415, {
        code: "REQUEST_UNSUPPORTED_MEDIA_TYPE",
        message: "Tipo de conteúdo não suportado.",
        field: null,
        retryable: false,
      });
    }

    request.log.error({ err: error }, "Falha inesperada");
    return send(reply, request, 500, {
      code: "INTERNAL_ERROR",
      message: "Ocorreu uma falha inesperada. Informe o identificador de correlação ao suporte.",
      field: null,
      retryable: false,
    });
  });
}
