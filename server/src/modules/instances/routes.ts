import type { FastifyInstance, FastifyRequest } from "fastify";
import Type from "typebox";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { pageOf, PageQueryFields } from "../../platform/http/pagination.js";
import { requireRecentMfa } from "../../platform/http/reauth.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { isUuid } from "../../platform/ids.js";
import { checkInstanceHealthNow, instanceHealthStatus } from "./health-view.js";
import { type Instance, InstanceStates } from "./instances.js";
import { applyInstanceMigration, instanceMigrationView } from "./migration-view.js";
import { issueInitialInvitation } from "../provisioning/initial-invitation.js";
import { retryProvisioning } from "../provisioning/retry.js";
import { provisioningView } from "../provisioning/view.js";
import {
  type InstanceEdit,
  instanceDetail,
  type InstanceFilter,
  listInstanceSummaries,
  updateInstance,
} from "./query.js";
import { type InstanceRequestBody, previewInstance, requestInstance } from "./request.js";
import { DEFAULT_TIMEZONE, SUPPORTED_TIMEZONES } from "./timezones.js";
import {
  activateInstance,
  enterMaintenance,
  exitMaintenance,
  reactivateInstance,
  suspendInstance,
  terminateInstance,
  type TransitionActor,
} from "./transitions.js";

const NullableString = (max: number, format?: "date") =>
  Type.Union([Type.String({ maxLength: max, ...(format ? { format } : {}) }), Type.Null()]);

export const InstanceRequestSchema = Type.Object(
  {
    contractorId: Type.String({ format: "uuid" }),
    productCode: Type.String({ pattern: "^[a-z][a-z0-9]{2,15}$" }),
    displayName: Type.String({ minLength: 2, maxLength: 120 }),
    slug: Type.String({ minLength: 1, maxLength: 80 }),
    timezone: Type.Optional(Type.String({ maxLength: 64 })),
    initialAdminEmail: Type.String({ format: "email", maxLength: 254 }),
    notes: Type.Optional(NullableString(4000)),
    validFrom: Type.Optional(NullableString(10, "date")),
    validUntil: Type.Optional(NullableString(10, "date")),
  },
  { additionalProperties: false },
);
const Params = Type.Object({ instanceId: Type.String({ format: "uuid" }) });
const CivilDate = Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });
const ListQuery = Type.Object(
  {
    contractorId: Type.Optional(Type.String({ format: "uuid" })),
    productCode: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9]{2,15}$" })),
    state: Type.Optional(Type.Union(InstanceStates.map((state) => Type.Literal(state)))),
    createdFrom: Type.Optional(CivilDate),
    createdTo: Type.Optional(CivilDate),
    ...PageQueryFields,
  },
  { additionalProperties: false },
);
const EditBody = Type.Object(
  {
    displayName: Type.String({ minLength: 2, maxLength: 120 }),
    notes: Type.Union([Type.String({ maxLength: 4000 }), Type.Null()]),
    validFrom: Type.Union([CivilDate, Type.Null()]),
    validUntil: Type.Union([CivilDate, Type.Null()]),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

// F03: ciclo e operação da instância.
const ReasonBody = Type.Object(
  { reason: Type.String({ minLength: 3, maxLength: 500 }) },
  { additionalProperties: false },
);
const TerminateBody = Type.Object(
  {
    reason: Type.String({ minLength: 3, maxLength: 500 }),
    exportReference: Type.Optional(Type.Union([Type.String({ maxLength: 300 }), Type.Null()])),
    retentionPolicy: Type.String({ minLength: 3, maxLength: 300 }),
  },
  { additionalProperties: false },
);

const toTransitionResult = (instance: Instance) => ({
  id: instance.id,
  state: instance.state,
  version: instance.version,
});

const idempotencyKeyOf = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || !isUuid(key)) {
    throw new AppError(422, "VALIDATION_FAILED", "Informe o cabeçalho Idempotency-Key (UUID).", {
      field: "Idempotency-Key",
    });
  }
  return key;
};

/** Solicitação e acompanhamento de instâncias (US3, FR-017 a FR-020, FR-042). */
export function registerInstanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  // Substitui a lista mínima de F01: mesmos campos, mais estado, protocolo e paginação.
  app.get(
    "/api/v1/instances",
    { preHandler: session, schema: { querystring: ListQuery } },
    async (request) => {
      const query = request.query as InstanceFilter & { page?: string; pageSize?: string };
      const page = pageOf(query);
      const filter: InstanceFilter = {
        ...(query.contractorId ? { contractorId: query.contractorId } : {}),
        ...(query.productCode ? { productCode: query.productCode } : {}),
        ...(query.state ? { state: query.state } : {}),
        ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
        ...(query.createdTo ? { createdTo: query.createdTo } : {}),
      };
      const result = await listInstanceSummaries(ctx, filter, page);
      return { items: result.items, pageInfo: { ...page, total: result.total } };
    },
  );

  app.get(
    "/api/v1/instances/:instanceId",
    { preHandler: session, schema: { params: Params } },
    async (request) => instanceDetail(ctx, (request.params as { instanceId: string }).instanceId),
  );

  app.put(
    "/api/v1/instances/:instanceId",
    { preHandler: session, schema: { params: Params, body: EditBody } },
    async (request) =>
      updateInstance(
        ctx,
        (request.params as { instanceId: string }).instanceId,
        request.body as InstanceEdit,
        { accountId: authOf(request).account.id, correlationId: request.id },
      ),
  );

  app.get("/api/v1/instances/timezones", { preHandler: session }, (_request, reply) =>
    reply.send({ items: SUPPORTED_TIMEZONES, default: DEFAULT_TIMEZONE }),
  );

  app.post(
    "/api/v1/instances/preview",
    { preHandler: session, schema: { body: InstanceRequestSchema } },
    async (request) => previewInstance(ctx, request.body as InstanceRequestBody),
  );

  // Idempotência na própria tarefa (research.md R-04), não no registro genérico de F01.
  app.post(
    "/api/v1/instances",
    { preHandler: session, schema: { body: InstanceRequestSchema } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const key = idempotencyKeyOf(request);
      const created = await requestInstance(
        ctx,
        request.body as InstanceRequestBody,
        { accountId: authOf(request).account.id, correlationId: request.id },
        key,
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/api/v1/instances/:instanceId/provisioning",
    { preHandler: session, schema: { params: Params } },
    async (request) => provisioningView(ctx, (request.params as { instanceId: string }).instanceId),
  );

  app.post(
    "/api/v1/instances/:instanceId/provisioning/retry",
    {
      preHandler: session,
      schema: {
        params: Params,
        body: Type.Object(
          { reason: Type.String({ minLength: 3, maxLength: 500 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const actor = { accountId: authOf(request).account.id, correlationId: request.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.accountId, operation: "repetir_provisionamento", instanceId },
        async () => ({
          status: 202,
          body: await retryProvisioning(ctx, instanceId, request.body as { reason: string }, actor),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/initial-invitation/issue",
    { preHandler: session, schema: { params: Params } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const actor = {
        accountId: authOf(request).account.id,
        correlationId: request.id,
        ip: request.ip,
      };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.accountId, operation: "emitir_convite_inicial", instanceId },
        async () => ({ status: 201, body: await issueInitialInvitation(ctx, instanceId, actor) }),
      );
    },
  );

  // F03: ciclo e operação da instância (US1 a US7).
  app.post(
    "/api/v1/instances/:instanceId/activate",
    { preHandler: session, schema: { params: Params } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "ativar_instancia", instanceId },
        async () => ({
          status: 200,
          body: toTransitionResult(await activateInstance(ctx, instanceId, actor)),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/suspend",
    { preHandler: session, schema: { params: Params, body: ReasonBody } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const { reason } = request.body as { reason: string };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "suspender_instancia", instanceId },
        async () => ({
          status: 200,
          body: toTransitionResult(await suspendInstance(ctx, instanceId, actor, reason)),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/reactivate",
    { preHandler: session, schema: { params: Params } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "reativar_instancia", instanceId },
        async () => ({
          status: 200,
          body: toTransitionResult(await reactivateInstance(ctx, instanceId, actor)),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/maintenance/enter",
    { preHandler: session, schema: { params: Params, body: ReasonBody } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const { reason } = request.body as { reason: string };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "entrar_manutencao", instanceId },
        async () => ({
          status: 200,
          body: toTransitionResult(await enterMaintenance(ctx, instanceId, actor, reason)),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/maintenance/exit",
    { preHandler: session, schema: { params: Params } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "sair_manutencao", instanceId },
        async () => {
          const result = await exitMaintenance(ctx, instanceId, actor);
          if (!result.instance) {
            throw new AppError(
              409,
              "HEALTH_CHECK_FAILED",
              result.health.reason ?? "A checagem de saúde não foi aprovada.",
            );
          }
          return { status: 200, body: toTransitionResult(result.instance) };
        },
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/terminate",
    { preHandler: session, schema: { params: Params, body: TerminateBody } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const body = request.body as {
        reason: string;
        exportReference?: string | null;
        retentionPolicy: string;
      };
      const actor: TransitionActor = { kind: "usuario", id: authOf(request).account.id };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.id!, operation: "encerrar_instancia", instanceId },
        async () => ({
          status: 200,
          body: toTransitionResult(
            await terminateInstance(ctx, instanceId, actor, {
              reason: body.reason,
              exportReference: body.exportReference ?? null,
              retentionPolicy: body.retentionPolicy,
            }),
          ),
        }),
      );
    },
  );

  app.get(
    "/api/v1/instances/:instanceId/health",
    { preHandler: session, schema: { params: Params } },
    async (request) =>
      instanceHealthStatus(ctx, (request.params as { instanceId: string }).instanceId),
  );

  app.post(
    "/api/v1/instances/:instanceId/health",
    { preHandler: session, schema: { params: Params } },
    async (request) =>
      checkInstanceHealthNow(ctx, (request.params as { instanceId: string }).instanceId),
  );

  app.get(
    "/api/v1/instances/:instanceId/migration",
    { preHandler: session, schema: { params: Params } },
    async (request) =>
      instanceMigrationView(ctx, (request.params as { instanceId: string }).instanceId),
  );

  app.post(
    "/api/v1/instances/:instanceId/migration",
    { preHandler: session, schema: { params: Params } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const accountId = authOf(request).account.id;
      const key = idempotencyKeyOf(request);
      const created = await applyInstanceMigration(ctx, instanceId, accountId, key);
      return reply.status(202).send(created);
    },
  );
}
