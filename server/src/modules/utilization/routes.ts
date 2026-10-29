import type { FastifyInstance } from "fastify";
import Type from "typebox";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { credentialOf, requireAppCredential } from "../../platform/http/app-credential.js";
import { requireSession } from "../../platform/http/session-guard.js";
import { isUuid } from "../../platform/ids.js";
import { toCsv } from "../../lib/csv.js";
import { getConsolidatedUsage, getInstanceUsage, receiveUsageBatch } from "./utilization.js";

const InstanceIdParam = Type.Object({ instanceId: Type.String({ format: "uuid" }) });

const UsageBatchEventSchema = Type.Object(
  {
    event_id: Type.String({ minLength: 1, maxLength: 36 }),
    occurred_at: Type.String({ format: "date-time" }),
    kind: Type.String({ minLength: 1, maxLength: 48 }),
    count: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const UsageBatchRequestSchema = Type.Object(
  {
    batch_id: Type.String({ format: "uuid" }),
    events: Type.Array(UsageBatchEventSchema, { maxItems: 500 }),
  },
  { additionalProperties: false },
);

const UsageQuerySchema = Type.Object(
  {
    from: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
    to: Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" }),
    timezone: Type.Optional(Type.String({ maxLength: 64 })),
    instance_id: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);

/**
 * Rotas de utilização: recepção interna (produto → Core) e consultas administrativas.
 * Contratos em specs/005-f08-core-auditoria-utilizacao/contracts/openapi-f08.yaml.
 */
export function registerUtilizationRoutes(app: FastifyInstance, ctx: AppContext): void {
  // ── Recepção de lotes de utilização (interno, produto → Core) ──────────────
  app.post(
    "/internal/v1/instances/:instanceId/usage-batches",
    {
      preHandler: requireAppCredential(ctx, "utilizacao"),
      schema: {
        params: InstanceIdParam,
        body: UsageBatchRequestSchema,
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params as { instanceId: string };
      const credential = credentialOf(request);
      const body = request.body as {
        batch_id: string;
        events: { event_id: string; occurred_at: string; kind: string; count: number }[];
      };

      const { result, status } = await receiveUsageBatch(
        ctx.core,
        instanceId,
        credential.instanceId,
        {
          batch_id: body.batch_id,
          events: body.events.map((e) => ({
            event_id: e.event_id,
            occurred_at: new Date(e.occurred_at),
            kind: e.kind,
            count: e.count,
          })),
        },
        ctx.clock(),
        ctx.logger,
      );

      return reply.status(status).send(result);
    },
  );

  // ── Utilização por instância (painel administrativo) ─────────────────────
  app.get(
    "/api/v1/instances/:instanceId/usage",
    {
      preHandler: requireSession(ctx),
      schema: {
        params: InstanceIdParam,
        querystring: UsageQuerySchema,
      },
    },
    async (request, reply) => {
      const { instanceId } = request.params as { instanceId: string };
      const query = request.query as {
        from: string;
        to: string;
        timezone?: string;
        instance_id?: string;
      };
      if (!isUuid(instanceId))
        throw new AppError(422, "INVALID_UUID", "UUID de instância inválido.");
      const result = await getInstanceUsage(
        ctx.core,
        instanceId,
        new Date(query.from + "T00:00:00Z"),
        new Date(query.to + "T23:59:59Z"),
        query.timezone ?? "America/Sao_Paulo",
      );
      if ((request.headers.accept ?? "").includes("text/csv")) {
        const rows = result.events.map((e) => ({
          instance_id: result.instance_id,
          period_start: result.period_start,
          period_end: result.period_end,
          kind: e.kind,
          count: String(e.count),
          data_status: result.data_status,
        }));
        const csv = toCsv(
          rows,
          [
            { key: "period_start", label: "Período Início" },
            { key: "period_end", label: "Período Fim" },
            { key: "kind", label: "Tipo" },
            { key: "count", label: "Contagem" },
            { key: "data_status", label: "Status" },
          ],
          { generated_at: new Date().toISOString(), filters: `instância=${instanceId}` },
        );
        void reply.header("Content-Type", "text/csv; charset=utf-8");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="utilizacao-${query.from}.csv"`,
        );
        return reply.send(csv);
      }
      return result;
    },
  );

  // ── Utilização consolidada (painel administrativo) ────────────────────────
  app.get(
    "/api/v1/usage",
    {
      preHandler: requireSession(ctx),
      schema: { querystring: UsageQuerySchema },
    },
    async (request, reply) => {
      const query = request.query as {
        from: string;
        to: string;
        timezone?: string;
        instance_id?: string;
      };
      const result = await getConsolidatedUsage(
        ctx.core,
        new Date(query.from + "T00:00:00Z"),
        new Date(query.to + "T23:59:59Z"),
        query.timezone ?? "America/Sao_Paulo",
        query.instance_id,
      );
      if ((request.headers.accept ?? "").includes("text/csv")) {
        const rows: Record<string, unknown>[] = [];
        for (const inst of result.instances) {
          for (const e of inst.events) {
            rows.push({
              instance_id: inst.instance_id,
              period_start: inst.period_start,
              period_end: inst.period_end,
              kind: e.kind,
              count: String(e.count),
              data_status: inst.data_status,
            });
          }
          if (inst.events.length === 0) {
            rows.push({
              instance_id: inst.instance_id,
              period_start: inst.period_start,
              period_end: inst.period_end,
              kind: "",
              count: "0",
              data_status: inst.data_status,
            });
          }
        }
        const csv = toCsv(
          rows,
          [
            { key: "instance_id", label: "Instância" },
            { key: "period_start", label: "Período Início" },
            { key: "period_end", label: "Período Fim" },
            { key: "kind", label: "Tipo" },
            { key: "count", label: "Contagem" },
            { key: "data_status", label: "Status" },
          ],
          { generated_at: new Date().toISOString() },
        );
        void reply.header("Content-Type", "text/csv; charset=utf-8");
        void reply.header(
          "Content-Disposition",
          `attachment; filename="utilizacao-${query.from}.csv"`,
        );
        return reply.send(csv);
      }
      return result;
    },
  );
}
