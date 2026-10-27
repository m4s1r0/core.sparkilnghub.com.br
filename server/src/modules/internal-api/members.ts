import type { FastifyInstance, FastifyRequest } from "fastify";
import Type from "typebox";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { credentialOf, requireAppCredential } from "../../platform/http/app-credential.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { isConnectionError, withIdentity } from "../../platform/http/identity-errors.js";
import { isUuid } from "../../platform/ids.js";
import { validateForInstance } from "../access-projection/writer.js";
import { identityErrors } from "../identity/errors.js";
import { revokeInvitation } from "../identity/platform-admins.js";
import { requestInfo } from "../identity/routes.js";
import type { InstanceRef } from "../instances/instance-ref.js";
import {
  changeMemberRole,
  inviteMember,
  listInstanceMembers,
  type ProductRole,
  revokeMembership,
} from "../memberships/memberships.js";
import { RevokeBody, RoleBody } from "../memberships/routes.js";
import { instanceForCredential, sessionToken, Slug } from "./sessions.js";

const sessionInvalid = () =>
  new AppError(401, "AUTH_SESSION_INVALID", "Sessão inválida ou encerrada.");

/**
 * Contexto do administrador local (SP-005, COM-012): instância pelo produto da credencial e pelo
 * slug da rota; sessão `X-Instance-Session` validada na projeção dessa instância; papel
 * `administrador` exigido. Nada do corpo ou de outros cabeçalhos escolhe a instância.
 */
async function localAdmin(
  ctx: AppContext,
  request: FastifyRequest,
): Promise<{ instance: InstanceRef; accountId: string }> {
  const { slug } = request.params as { slug: string };
  const instance = await withIdentity(() =>
    instanceForCredential(ctx, credentialOf(request), slug),
  );
  if (!instance) throw sessionInvalid();
  let session;
  try {
    session = await validateForInstance(ctx, instance, sessionToken(request));
  } catch (error) {
    if (isConnectionError(error)) {
      throw new AppError(503, "SYSTEM_INSTANCE_UNAVAILABLE", "Instância indisponível.", {
        retryable: true,
        retryAfterSeconds: 10,
      });
    }
    throw error;
  }
  if (!session) throw sessionInvalid();
  if (session.role !== "administrador") throw identityErrors.forbidden();
  return { instance, accountId: session.accountId };
}

const MemberParams = Type.Object({
  slug: Slug.properties.slug,
  membershipId: Type.String({ maxLength: 64 }),
});

/** Contrato de vínculos locais (/internal/v1, US4). */
export function registerInternalMemberRoutes(app: FastifyInstance, ctx: AppContext): void {
  const credential = requireAppCredential(ctx, "members");

  app.get(
    "/internal/v1/instances/:slug/members",
    { preHandler: credential, schema: { params: Slug } },
    async (request) => {
      const { instance } = await localAdmin(ctx, request);
      return { items: await listInstanceMembers(ctx, instance.id, "convites") };
    },
  );

  app.post(
    "/internal/v1/instances/:slug/invitations",
    {
      preHandler: credential,
      schema: {
        params: Slug,
        body: Type.Object(
          {
            email: Type.String({ format: "email", maxLength: 254 }),
            role: Type.Union([Type.Literal("administrador"), Type.Literal("colaborador")]),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const { instance, accountId } = await localAdmin(ctx, request);
      const body = request.body as { email: string; role: ProductRole };
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: accountId, operation: "convidar_membro", instanceId: instance.id },
        async () => ({
          status: 201,
          body: await inviteMember(ctx, accountId, instance, body, requestInfo(request)),
        }),
      );
    },
  );

  app.post(
    "/internal/v1/instances/:slug/invitations/:membershipId/revoke",
    {
      preHandler: credential,
      schema: {
        params: MemberParams,
        body: Type.Object(
          { reason: Type.String({ minLength: 3, maxLength: 500 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const { instance, accountId } = await localAdmin(ctx, request);
      const { membershipId: invitationId } = request.params as { membershipId: string };
      if (!isUuid(invitationId)) throw identityErrors.notFound();
      const { reason } = request.body as { reason: string };
      try {
        await revokeInvitation(ctx, accountId, invitationId, reason.trim(), requestInfo(request), {
          instanceId: instance.id,
        });
      } catch (error) {
        // Convite de outra instância, aceito ou expirado: inexistente para a instância.
        if ((error as { code?: string }).code === "INVITATION_INVALID") {
          throw identityErrors.notFound();
        }
        throw error;
      }
      return reply.status(204).send();
    },
  );

  for (const [action, operation] of [
    ["role", "mudar_papel"],
    ["revoke", "revogar_vinculo"],
  ] as const) {
    app.post(
      `/internal/v1/instances/:slug/members/:membershipId/${action}`,
      {
        preHandler: credential,
        schema: { params: MemberParams, body: action === "role" ? RoleBody : RevokeBody },
      },
      async (request, reply) => {
        const { instance, accountId } = await localAdmin(ctx, request);
        const { membershipId } = request.params as { membershipId: string };
        if (!isUuid(membershipId)) throw identityErrors.notFound();
        const body = request.body as { role?: ProductRole; reason: string; version: number };
        return withIdempotency(
          ctx,
          request,
          reply,
          { actor: accountId, operation, instanceId: instance.id },
          async () => ({
            status: 200,
            body:
              action === "role"
                ? await changeMemberRole(
                    ctx,
                    accountId,
                    instance,
                    membershipId,
                    {
                      role: body.role ?? "colaborador",
                      reason: body.reason.trim(),
                      version: body.version,
                    },
                    requestInfo(request),
                  )
                : await revokeMembership(
                    ctx,
                    accountId,
                    instance,
                    membershipId,
                    { reason: body.reason.trim(), version: body.version },
                    requestInfo(request),
                  ),
          }),
        );
      },
    );
  }
}
