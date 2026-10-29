import { ErrorEnvelope, Liveness, SystemStatus } from "@sparkcore/contracts";
import type { FastifyInstance, preHandlerAsyncHookHandler } from "fastify";
import type { AppContext } from "../../platform/context.js";
import { requireSession } from "../../platform/http/session-guard.js";
import { getDashboardStats } from "./dashboard-stats.js";
import type { SystemStatusService } from "./probe.js";

export const RETRY_AFTER_SECONDS = 10;

/**
 * `GET /health/live` (público, sem dependências) e `GET /api/v1/system/status`
 * (contracts/openapi.yaml). Em F01 a situação detalhada passa a exigir sessão de administrador.
 */
export function registerSystemRoutes(
  app: FastifyInstance,
  service: SystemStatusService,
  options: { preHandler?: preHandlerAsyncHookHandler } = {},
  ctx?: AppContext,
): void {
  app.get("/health/live", { schema: { response: { 200: Liveness } } }, () => ({
    status: "ok" as const,
  }));

  app.get(
    "/api/v1/system/status",
    {
      ...(options.preHandler ? { preHandler: options.preHandler } : {}),
      schema: { response: { 200: SystemStatus, 503: SystemStatus, 500: ErrorEnvelope } },
    },
    async (_request, reply) => {
      const status = await service.check();
      if (status.status === "INDISPONIVEL") {
        void reply.header("retry-after", String(RETRY_AFTER_SECONDS));
        return reply.status(503).send(status);
      }
      return reply.status(200).send(status);
    },
  );

  if (ctx) {
    app.get("/api/v1/dashboard/stats", { preHandler: requireSession(ctx) }, async () =>
      getDashboardStats(ctx.core),
    );
  }
}
