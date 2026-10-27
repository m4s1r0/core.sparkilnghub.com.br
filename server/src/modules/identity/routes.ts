import type { FastifyInstance, FastifyRequest } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from "../../platform/http/cookies.js";
import { withIdentity } from "../../platform/http/identity-errors.js";
import { reauthValidUntil } from "../../platform/http/reauth.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { getInstance } from "../instances/instances.js";
import { acceptInvitation } from "./accept-invitation.js";
import { findAccountByEmail } from "./accounts.js";
import { endCoreSession, resolveCoreSession } from "./core-sessions.js";
import { maskEmail } from "./email.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { findUsableInvitation } from "./invitations.js";
import { isActivePlatformAdmin, loginWithPassword } from "./login.js";
import {
  confirmEnrollment,
  hasConfirmedFactor,
  reauthenticate,
  startEnrollment,
  verifySecondFactor,
} from "./mfa.js";
import { recordSecurityEvent } from "./security-events.js";
import { registerFailure, throttleRules, throttleStatus } from "./throttle.js";

const Email = Type.String({ format: "email", maxLength: 254 });
const TotpCode = Type.String({ pattern: "^[0-9]{6}$" });
const RecoveryCode = Type.String({ pattern: "^[A-Za-z2-7]{10}$" });
const Token = Type.Object({ token: Type.String({ minLength: 1, maxLength: 128 }) });

export const requestInfo = (request: FastifyRequest): RequestInfo => ({
  ip: request.ip,
  userAgent: request.headers["user-agent"]?.slice(0, 300) ?? null,
  correlationId: request.id,
});

const ROLE_LABEL: Record<string, string> = {
  administrador: "Administrador",
  colaborador: "Colaborador",
};

/** Corpo de `GET /api/v1/session` (contrato `SessionInfo`). */
async function sessionInfo(ctx: AppContext, request: FastifyRequest) {
  const { session, account } = authOf(request);
  const until = reauthValidUntil(session.mfaConfirmedAt);
  return {
    account: { id: account.id, displayName: account.displayName, email: account.email },
    mfa: {
      enrolled: await hasConfirmedFactor(ctx.identity, account.id),
      confirmed: session.mfaConfirmedAt !== null,
      reauthValidUntil: until && until > ctx.clock() ? until.toISOString() : null,
    },
    platformRole: (await isActivePlatformAdmin(ctx, account.id)) ? "administrador" : null,
  };
}

/** Rotas de identidade do painel (contracts/openapi.yaml, F01 US1). */
export function registerIdentityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const anySession = requireSession(ctx, { mfa: false });
  const fullSession = requireSession(ctx);

  app.post(
    "/api/v1/auth/login",
    {
      schema: {
        body: Type.Object(
          { email: Email, password: Type.String({ minLength: 1, maxLength: 128 }) },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const body = request.body as { email: string; password: string };
      const { token, next } = await withIdentity(() =>
        loginWithPassword(ctx, body, requestInfo(request)),
      );
      setSessionCookie(reply, ctx.config, token);
      return { next };
    },
  );

  app.post(
    "/api/v1/auth/mfa",
    {
      preHandler: anySession,
      schema: {
        body: Type.Union([
          Type.Object({ code: TotpCode }, { additionalProperties: false }),
          Type.Object({ recoveryCode: RecoveryCode }, { additionalProperties: false }),
        ]),
      },
    },
    async (request) => {
      const body = request.body as { code: string } | { recoveryCode: string };
      const next = await withIdentity(() =>
        verifySecondFactor(ctx, authOf(request), body, requestInfo(request)),
      );
      return { next };
    },
  );

  app.post(
    "/api/v1/auth/reauth",
    {
      preHandler: fullSession,
      schema: { body: Type.Object({ code: TotpCode }, { additionalProperties: false }) },
    },
    async (request) => {
      const { code } = request.body as { code: string };
      const at = await withIdentity(() =>
        reauthenticate(ctx, authOf(request), code, requestInfo(request)),
      );
      const auth = authOf(request);
      auth.session = { ...auth.session, mfaConfirmedAt: at };
      return sessionInfo(ctx, request);
    },
  );

  app.post("/api/v1/auth/logout", { preHandler: anySession }, async (request, reply) => {
    const { session, account } = authOf(request);
    const now = ctx.clock();
    await endCoreSession(ctx.identity, now, session.idHash, "logout");
    await recordSecurityEvent(ctx.identity, {
      type: "logout",
      actorKind: "usuario",
      actorAccountId: account.id,
      targetAccountId: account.id,
      result: "sucesso",
      correlationId: request.id,
      ip: request.ip,
      userAgent: requestInfo(request).userAgent,
      at: now,
    });
    clearSessionCookie(reply, ctx.config);
    return reply.status(204).send();
  });

  app.get("/api/v1/session", { preHandler: anySession }, (request) => sessionInfo(ctx, request));

  app.post("/api/v1/account/mfa/enrollment", { preHandler: anySession }, async (request, reply) => {
    const enrollment = await withIdentity(() => startEnrollment(ctx, authOf(request)));
    return reply.status(201).send(enrollment);
  });

  app.post(
    "/api/v1/account/mfa/enrollment/confirm",
    {
      preHandler: anySession,
      schema: { body: Type.Object({ code: TotpCode }, { additionalProperties: false }) },
    },
    async (request) => {
      const { code } = request.body as { code: string };
      const codes = await withIdentity(() =>
        confirmEnrollment(ctx, authOf(request), code, requestInfo(request)),
      );
      return { codes };
    },
  );

  app.get("/api/v1/invitations/:token", { schema: { params: Token } }, async (request) => {
    const { token } = request.params as { token: string };
    return withIdentity(async () => {
      const rule = throttleRules.inviteOrigin(request.ip);
      const locked = await throttleStatus(ctx, [rule]);
      if (locked) throw identityErrors.throttled(locked);
      const invitation = await findUsableInvitation(ctx.identity, ctx.clock(), token);
      if (!invitation) {
        await registerFailure(ctx, [rule]);
        throw identityErrors.invitationInvalid();
      }
      const instance = invitation.instanceId ? await getInstance(ctx, invitation.instanceId) : null;
      return {
        target: invitation.target,
        instanceName: instance?.displayName ?? null,
        roleLabel:
          invitation.target === "plataforma"
            ? "Administrador da plataforma"
            : (ROLE_LABEL[invitation.role] ?? invitation.role),
        emailMasked: maskEmail(invitation.emailNormalized),
        accountExists:
          (await findAccountByEmail(ctx.identity, invitation.emailNormalized)) !== null,
        expiresAt: invitation.expiresAt.toISOString(),
      };
    });
  });

  app.post(
    "/api/v1/invitations/:token/accept",
    {
      schema: {
        params: Token,
        body: Type.Object(
          {
            displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
            password: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
            currentPassword: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string };
      const body = (request.body ?? {}) as {
        displayName?: string;
        password?: string;
        currentPassword?: string;
      };
      const result = await withIdentity(async () => {
        const current = await resolveCoreSession(ctx, readSessionCookie(request));
        return acceptInvitation(
          ctx,
          token,
          body,
          requestInfo(request),
          current.ok ? current.account.id : null,
        );
      });
      if (result.kind === "plataforma") setSessionCookie(reply, ctx.config, result.token);
      return { next: result.next };
    },
  );
}
