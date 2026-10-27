import type { FastifyInstance } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { withIdentity } from "../../platform/http/identity-errors.js";
import { requireRecentMfa } from "../../platform/http/reauth.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { isUuid } from "../../platform/ids.js";
import { identityErrors } from "./errors.js";
import { createPlatformInvitation } from "./invitations.js";
import {
  deactivatePlatformAdmin,
  listPlatformAdmins,
  reactivatePlatformAdmin,
  revokeInvitation,
} from "./platform-admins.js";
import { requestInfo } from "./routes.js";

const Reason = Type.Object(
  { reason: Type.String({ minLength: 3, maxLength: 500 }) },
  { additionalProperties: false },
);
const AccountParams = Type.Object({ accountId: Type.String({ format: "uuid" }) });

/** Equipe de administração da plataforma (US2, FR-008, FR-009). */
export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  app.get("/api/v1/platform-admins", { preHandler: session }, async () => ({
    items: await withIdentity(() => listPlatformAdmins(ctx)),
  }));

  app.post(
    "/api/v1/platform-admins/invitations",
    {
      preHandler: session,
      schema: {
        body: Type.Object(
          { email: Type.String({ format: "email", maxLength: 254 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { email } = request.body as { email: string };
      const actor = authOf(request).account.id;
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor, operation: "convidar_admin_plataforma" },
        async () => {
          const created = await createPlatformInvitation(ctx, {
            email,
            createdBy: actor,
            correlationId: request.id,
            ip: request.ip,
          });
          return {
            status: 201,
            body: { link: created.link, expiresAt: created.expiresAt.toISOString() },
          };
        },
      );
    },
  );

  for (const [action, run] of [
    ["deactivate", deactivatePlatformAdmin],
    ["reactivate", reactivatePlatformAdmin],
  ] as const) {
    app.post(
      `/api/v1/platform-admins/:accountId/${action}`,
      { preHandler: session, schema: { params: AccountParams, body: Reason } },
      async (request, reply) => {
        requireRecentMfa(ctx, request);
        const { accountId } = request.params as { accountId: string };
        const { reason } = request.body as { reason: string };
        await withIdentity(() =>
          run(ctx, authOf(request).account.id, accountId, reason.trim(), requestInfo(request)),
        );
        return reply.status(204).send();
      },
    );
  }

  // Mesmo nome de parâmetro de /invitations/:token/accept: o roteador não aceita nomes
  // diferentes na mesma posição. Aqui o valor é o id do convite (UUID).
  app.post(
    "/api/v1/invitations/:token/revoke",
    {
      preHandler: session,
      schema: { params: Type.Object({ token: Type.String({ maxLength: 64 }) }), body: Reason },
    },
    async (request, reply) => {
      const { token: invitationId } = request.params as { token: string };
      if (!isUuid(invitationId)) throw identityErrors.invitationInvalid();
      const { reason } = request.body as { reason: string };
      await withIdentity(() =>
        revokeInvitation(
          ctx,
          authOf(request).account.id,
          invitationId,
          reason.trim(),
          requestInfo(request),
        ),
      );
      return reply.status(204).send();
    },
  );
}
