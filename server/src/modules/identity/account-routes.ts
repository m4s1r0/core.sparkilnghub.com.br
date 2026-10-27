import type { FastifyInstance } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { withIdentity } from "../../platform/http/identity-errors.js";
import { requireRecentMfa } from "../../platform/http/reauth.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { findAccounts, getAccountDetail, listPendingAccessSync } from "./account-lookup.js";
import { blockAccount, blockPreview, unblockAccount } from "./blocking.js";
import {
  completePasswordReset,
  issuePasswordReset,
  listRecoveryRequests,
  requestRecovery,
} from "./recovery.js";
import { requestInfo } from "./routes.js";

const Email = Type.String({ format: "email", maxLength: 254 });
const AccountParams = Type.Object({ accountId: Type.String({ format: "uuid" }) });
const Reason = Type.Object(
  { reason: Type.String({ minLength: 3, maxLength: 500 }) },
  { additionalProperties: false },
);

/** Contas, recuperação e bloqueio (US5). Só administradores da plataforma; nada em /internal. */
export function registerAccountRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  app.post(
    "/api/v1/recovery-requests",
    { schema: { body: Type.Object({ email: Email }, { additionalProperties: false }) } },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      await withIdentity(() => requestRecovery(ctx, email, requestInfo(request)));
      return reply.status(202).send({
        message: "Se houver conta com este e-mail, a equipe de administração foi avisada.",
      });
    },
  );

  app.get("/api/v1/recovery-requests", { preHandler: session }, async () => ({
    items: await withIdentity(() => listRecoveryRequests(ctx)),
  }));

  app.post(
    "/api/v1/password-resets/:token",
    {
      schema: {
        params: Type.Object({ token: Type.String({ maxLength: 128 }) }),
        body: Type.Object(
          { password: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request) => {
      const { token } = request.params as { token: string };
      const { password } = request.body as { password: string };
      return withIdentity(() => completePasswordReset(ctx, token, password, requestInfo(request)));
    },
  );

  app.get(
    "/api/v1/accounts",
    {
      preHandler: session,
      schema: { querystring: Type.Object({ email: Email }, { additionalProperties: false }) },
    },
    async (request) => {
      const { email } = request.query as { email: string };
      return withIdentity(() => findAccounts(ctx, email));
    },
  );

  app.get(
    "/api/v1/accounts/:accountId",
    { preHandler: session, schema: { params: AccountParams } },
    async (request) => {
      const { accountId } = request.params as { accountId: string };
      return withIdentity(() => getAccountDetail(ctx, accountId));
    },
  );

  app.get(
    "/api/v1/accounts/:accountId/block-preview",
    { preHandler: session, schema: { params: AccountParams } },
    async (request) => {
      const { accountId } = request.params as { accountId: string };
      return withIdentity(() => blockPreview(ctx, accountId));
    },
  );

  app.post(
    "/api/v1/accounts/:accountId/password-reset",
    { preHandler: session, schema: { params: AccountParams } },
    async (request, reply) => {
      requireRecentMfa(ctx, request);
      const { accountId } = request.params as { accountId: string };
      const link = await withIdentity(() =>
        issuePasswordReset(ctx, authOf(request).account.id, accountId, requestInfo(request)),
      );
      return reply.status(201).send(link);
    },
  );

  for (const [action, run] of [
    ["block", blockAccount],
    ["unblock", unblockAccount],
  ] as const) {
    app.post(
      `/api/v1/accounts/:accountId/${action}`,
      { preHandler: session, schema: { params: AccountParams, body: Reason } },
      async (request, reply) => {
        requireRecentMfa(ctx, request);
        const { accountId } = request.params as { accountId: string };
        const { reason } = request.body as { reason: string };
        const actor = authOf(request).account.id;
        return withIdempotency(
          ctx,
          request,
          reply,
          { actor, operation: action === "block" ? "bloquear_conta" : "desbloquear_conta" },
          async () => ({
            status: 200,
            body: await run(ctx, actor, accountId, reason.trim(), requestInfo(request)),
          }),
        );
      },
    );
  }

  app.get("/api/v1/access-sync/pending", { preHandler: session }, () =>
    withIdentity(() => listPendingAccessSync(ctx)),
  );
}
