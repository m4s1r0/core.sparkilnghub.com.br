import type { FastifyInstance } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { withIdentity } from "../../platform/http/identity-errors.js";
import { requireRecentMfa } from "../../platform/http/reauth.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { identityErrors } from "../identity/errors.js";
import { requestInfo } from "../identity/routes.js";
import { getInstance, listInstances } from "../instances/instance-ref.js";
import {
  changeMemberRole,
  inviteMember,
  listInstanceMembers,
  type ProductRole,
  revokeMembership,
} from "./memberships.js";

const Role = Type.Union([Type.Literal("administrador"), Type.Literal("colaborador")]);
const Reason = Type.String({ minLength: 3, maxLength: 500 });
const InstanceParams = Type.Object({ instanceId: Type.String({ format: "uuid" }) });
const MemberParams = Type.Object({
  instanceId: Type.String({ format: "uuid" }),
  membershipId: Type.String({ format: "uuid" }),
});

export const RoleBody = Type.Object(
  { role: Role, reason: Reason, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export const RevokeBody = Type.Object(
  { reason: Reason, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);

/** Vínculos pelo painel da plataforma (US4). */
export function registerMembershipRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  const instanceOr404 = async (instanceId: string) => {
    const instance = await getInstance(ctx, instanceId);
    if (!instance) throw identityErrors.notFound();
    return instance;
  };

  app.get("/api/v1/instances", { preHandler: session }, async () => ({
    items: (await withIdentity(() => listInstances(ctx))).map((i) => ({
      id: i.id,
      productCode: i.productCode,
      slug: i.slug,
      displayName: i.displayName,
      synthetic: i.synthetic,
    })),
  }));

  app.get(
    "/api/v1/instances/:instanceId/members",
    { preHandler: session, schema: { params: InstanceParams } },
    async (request) => {
      const { instanceId } = request.params as { instanceId: string };
      return withIdentity(async () => {
        await instanceOr404(instanceId);
        return { items: await listInstanceMembers(ctx, instanceId, "todos") };
      });
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/invitations",
    {
      preHandler: session,
      schema: {
        params: InstanceParams,
        body: Type.Object(
          {
            email: Type.String({ format: "email", maxLength: 254 }),
            role: Role,
            initial: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId } = request.params as { instanceId: string };
      const body = request.body as { email: string; role: ProductRole; initial?: boolean };
      const actor = authOf(request).account.id;
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor, operation: "convidar_membro", instanceId },
        async () => {
          const instance = await instanceOr404(instanceId);
          return {
            status: 201,
            body: await inviteMember(ctx, actor, instance, body, requestInfo(request)),
          };
        },
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/members/:membershipId/role",
    { preHandler: session, schema: { params: MemberParams, body: RoleBody } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId, membershipId } = request.params as {
        instanceId: string;
        membershipId: string;
      };
      const body = request.body as { role: ProductRole; reason: string; version: number };
      const actor = authOf(request).account.id;
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor, operation: "mudar_papel", instanceId },
        async () => ({
          status: 200,
          body: await changeMemberRole(
            ctx,
            actor,
            await instanceOr404(instanceId),
            membershipId,
            { ...body, reason: body.reason.trim() },
            requestInfo(request),
          ),
        }),
      );
    },
  );

  app.post(
    "/api/v1/instances/:instanceId/members/:membershipId/revoke",
    { preHandler: session, schema: { params: MemberParams, body: RevokeBody } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { instanceId, membershipId } = request.params as {
        instanceId: string;
        membershipId: string;
      };
      const body = request.body as { reason: string; version: number };
      const actor = authOf(request).account.id;
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor, operation: "revogar_vinculo", instanceId },
        async () => ({
          status: 200,
          body: await revokeMembership(
            ctx,
            actor,
            await instanceOr404(instanceId),
            membershipId,
            { ...body, reason: body.reason.trim() },
            requestInfo(request),
          ),
        }),
      );
    },
  );
}
