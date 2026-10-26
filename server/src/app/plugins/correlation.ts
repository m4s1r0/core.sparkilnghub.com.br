import { CORRELATION_HEADER } from "@sparkcore/contracts";
import {
  type FastifyInstance,
  type FastifyServerOptions,
  LogController,
  type RawRequestDefaultExpression,
} from "fastify";
import { isUuid, newId } from "../../platform/ids.js";

/**
 * Reutiliza `X-Correlation-Id` quando for UUID válido; caso contrário gera UUID v7. Qualquer outro
 * valor é descartado, para não permitir injeção nos logs (conventions.md §3, R-10).
 */
export function correlationId(request: RawRequestDefaultExpression): string {
  const header = request.headers[CORRELATION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return value !== undefined && isUuid(value) ? value.toLowerCase() : newId();
}

export const correlationServerOptions: Pick<
  FastifyServerOptions,
  "genReqId" | "requestIdHeader" | "logController"
> = {
  requestIdHeader: false,
  // Rótulo do identificador nos logs de requisição (substitui requestIdLogLabel, depreciado).
  logController: new LogController({ requestIdLogLabel: "correlationId" }),
  genReqId: correlationId,
};

/** Devolve o identificador em toda resposta, inclusive erros. */
export function registerCorrelation(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    void reply.header(CORRELATION_HEADER, request.id);
  });
}
