import type { FastifyInstance } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { pageOf, PageQueryFields } from "../../platform/http/pagination.js";
import { requireSession } from "../../platform/http/session-guard.js";
import { toCsv } from "../../lib/csv.js";
import { listAuditEvents, type AuditEventFilter } from "./audit.js";

const CSV_LIMIT = 10_000;

const AuditEventsQuery = Type.Object(
  {
    ...PageQueryFields,
    object_type: Type.Optional(Type.String({ maxLength: 64 })),
    object_id: Type.Optional(Type.String({ maxLength: 36 })),
    actor_id: Type.Optional(Type.String({ format: "uuid" })),
    action: Type.Optional(Type.String({ maxLength: 64 })),
    from: Type.Optional(Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" })),
    to: Type.Optional(Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" })),
  },
  { additionalProperties: false },
);

/**
 * Rotas de auditoria administrativa com filtros, paginação e exportação CSV (F08-Core US4).
 * SC-035: apenas GET — nenhuma rota PUT/DELETE exposta neste módulo.
 * CA-SC-010: atores inativados ainda identificados pelo valor gravado no evento.
 */
export function registerAuditEventRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  app.get(
    "/api/v1/audit-events",
    { preHandler: session, schema: { querystring: AuditEventsQuery } },
    async (request, reply) => {
      const q = request.query as {
        page?: string;
        pageSize?: string;
        object_type?: string;
        object_id?: string;
        actor_id?: string;
        action?: string;
        from?: string;
        to?: string;
      };
      const filters: AuditEventFilter = {};
      if (q.object_type) filters.object_type = q.object_type;
      if (q.object_id) filters.object_id = q.object_id;
      if (q.actor_id) filters.actor_id = q.actor_id;
      if (q.action) filters.action = q.action;
      if (q.from) filters.from = new Date(q.from + "T00:00:00Z");
      if (q.to) filters.to = new Date(q.to + "T23:59:59Z");

      const isCsv = (request.headers.accept ?? "").includes("text/csv");
      if (isCsv) {
        const data = await listAuditEvents(ctx.core, filters, 1, CSV_LIMIT + 1);
        const truncated = data.items.length > CSV_LIMIT;
        const rows = truncated ? data.items.slice(0, CSV_LIMIT) : data.items;
        const csv = toCsv(
          rows as unknown as Record<string, unknown>[],
          [
            { key: "created_at", label: "Data/Hora" },
            { key: "action", label: "Ação" },
            { key: "object_type", label: "Entidade" },
            { key: "object_id", label: "ID Entidade" },
            { key: "actor_id", label: "ID Ator" },
            { key: "actor_kind", label: "Tipo Ator" },
            { key: "reason", label: "Motivo" },
          ],
          {
            generated_at: new Date().toISOString(),
            filters: buildFilterLabel(q),
          },
        );
        void reply.header("Content-Type", "text/csv; charset=utf-8");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="auditoria-${todayStr()}.csv"`,
        );
        if (truncated) void reply.header("X-Truncated", "true");
        return reply.send(csv);
      }

      const { page, pageSize } = pageOf(q, 50);
      return listAuditEvents(ctx.core, filters, page, pageSize);
    },
  );
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildFilterLabel(q: Record<string, string | undefined>): string {
  const parts: string[] = [];
  if (q.object_type) parts.push(`entidade=${q.object_type}`);
  if (q.object_id) parts.push(`id=${q.object_id}`);
  if (q.actor_id) parts.push(`ator=${q.actor_id}`);
  if (q.action) parts.push(`ação=${q.action}`);
  if (q.from) parts.push(`de=${q.from}`);
  if (q.to) parts.push(`até=${q.to}`);
  return parts.join("; ") || "nenhum";
}
