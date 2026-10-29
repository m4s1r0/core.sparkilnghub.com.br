import type { FastifyInstance } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { pageOf, PageQueryFields } from "../../platform/http/pagination.js";
import { requireSession } from "../../platform/http/session-guard.js";
import { toCsv } from "../../lib/csv.js";
import { listSecurityEvents, type SecurityEventFilter } from "./security-events.js";

const CSV_LIMIT = 10_000;

const SecurityEventsQuery = Type.Object(
  {
    ...PageQueryFields,
    instance_id: Type.Optional(Type.String({ format: "uuid" })),
    actor_account_id: Type.Optional(Type.String({ format: "uuid" })),
    type: Type.Optional(Type.String({ maxLength: 64 })),
    result: Type.Optional(
      Type.Union([Type.Literal("sucesso"), Type.Literal("falha"), Type.Literal("negado")]),
    ),
    from: Type.Optional(Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" })),
    to: Type.Optional(Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" })),
  },
  { additionalProperties: false },
);

/**
 * Rotas de auditoria: eventos de segurança e administrativos com filtros, paginação e exportação
 * CSV neutralizada (F08-Core US3/US4, SC-033, SC-035, SC-041).
 */
export function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  // ── Eventos de segurança ─────────────────────────────────────────────────
  app.get(
    "/api/v1/security-events",
    { preHandler: session, schema: { querystring: SecurityEventsQuery } },
    async (request, reply) => {
      const q = request.query as {
        page?: string;
        pageSize?: string;
        instance_id?: string;
        actor_account_id?: string;
        type?: string;
        result?: string;
        from?: string;
        to?: string;
      };
      const filters: SecurityEventFilter = {};
      if (q.instance_id) filters.instance_id = q.instance_id;
      if (q.actor_account_id) filters.actor_account_id = q.actor_account_id;
      if (q.type) filters.type = q.type;
      if (q.result) filters.result = q.result;
      if (q.from) filters.from = new Date(q.from + "T00:00:00Z");
      if (q.to) filters.to = new Date(q.to + "T23:59:59Z");

      const isCsv = (request.headers.accept ?? "").includes("text/csv");
      if (isCsv) {
        const data = await listSecurityEvents(ctx.identity, filters, 1, CSV_LIMIT + 1);
        const truncated = data.items.length > CSV_LIMIT;
        const rows = truncated ? data.items.slice(0, CSV_LIMIT) : data.items;
        const csv = toCsv(
          rows as unknown as Record<string, unknown>[],
          [
            { key: "created_at", label: "Data/Hora" },
            { key: "type", label: "Tipo" },
            { key: "actor_kind", label: "Tipo Ator" },
            { key: "actor_account_id", label: "ID Ator" },
            { key: "instance_id", label: "Instância" },
            { key: "result", label: "Resultado" },
            { key: "ip", label: "IP" },
            { key: "user_agent", label: "Agente" },
          ],
          {
            generated_at: new Date().toISOString(),
            filters: buildFilterLabel(q),
          },
        );
        void reply.header("Content-Type", "text/csv; charset=utf-8");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="acessos-${todayStr()}.csv"`,
        );
        if (truncated) void reply.header("X-Truncated", "true");
        return reply.send(csv);
      }

      const { page, pageSize } = pageOf(q, 50);
      return listSecurityEvents(ctx.identity, filters, page, pageSize);
    },
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFilterLabel(q: Record<string, string | undefined>): string {
  const parts: string[] = [];
  if (q.instance_id) parts.push(`instância=${q.instance_id}`);
  if (q.actor_account_id) parts.push(`ator=${q.actor_account_id}`);
  if (q.type) parts.push(`tipo=${q.type}`);
  if (q.result) parts.push(`resultado=${q.result}`);
  if (q.from) parts.push(`de=${q.from}`);
  if (q.to) parts.push(`até=${q.to}`);
  return parts.join("; ") || "nenhum";
}
