import { ErrorEnvelope, Liveness, SystemStatus } from "@sparkcore/contracts";
import type { FastifyInstance } from "fastify";
import type { SystemStatusService } from "./probe.js";

export const RETRY_AFTER_SECONDS = 10;

/**
 * `GET /health/live` (público, sem dependências) e `GET /api/v1/system/status`
 * (contracts/openapi.yaml). Em F01 a situação detalhada passa a exigir sessão de administrador.
 */
export function registerSystemRoutes(app: FastifyInstance, service: SystemStatusService): void {
  app.get("/health/live", { schema: { response: { 200: Liveness } } }, () => ({
    status: "ok" as const,
  }));

  app.get(
    "/api/v1/system/status",
    { schema: { response: { 200: SystemStatus, 503: SystemStatus, 500: ErrorEnvelope } } },
    async (_request, reply) => {
      const status = await service.check();
      // T086: campo obrigatório removido da resposta, deliberadamente.
      const body: Partial<typeof status> = { ...status };
      delete body.version;
      if (status.status === "INDISPONIVEL") {
        void reply.header("retry-after", String(RETRY_AFTER_SECONDS));
        return reply.status(503).send(body);
      }
      return reply.status(200).send(body);
    },
  );
}
