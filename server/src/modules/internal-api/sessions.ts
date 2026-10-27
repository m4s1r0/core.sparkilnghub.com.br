import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "kysely";
import Type from "typebox";
import { AppError } from "../../app/errors.js";
import { readMemberState } from "../access-projection/source.js";
import { createProductSession, touchProductSession } from "../access-projection/writer.js";
import { findAccountByEmail, passwordHashOf } from "../identity/accounts.js";
import { normalizeEmail } from "../identity/email.js";
import { identityErrors } from "../identity/errors.js";
import { isActivePlatformAdmin } from "../identity/login.js";
import { burnPasswordCheck, verifyPassword } from "../identity/password.js";
import { recordSecurityEvent } from "../identity/security-events.js";
import {
  clearFailures,
  registerFailure,
  throttleRules,
  throttleStatus,
} from "../identity/throttle.js";
import { findInstanceBySlug, type Instance } from "../instances/instances.js";
import type { AppContext } from "../../platform/context.js";
import {
  type AppCredential,
  credentialOf,
  requireAppCredential,
} from "../../platform/http/app-credential.js";
import { isConnectionError, withIdentity } from "../../platform/http/identity-errors.js";
import { uuidToBin, binToUuid } from "../../platform/ids.js";

export const Slug = Type.Object({
  slug: Type.String({ pattern: "^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$" }),
});

const instanceUnavailable = () =>
  new AppError(
    503,
    "SYSTEM_INSTANCE_UNAVAILABLE",
    "O banco da instância está temporariamente indisponível. Tente novamente em instantes.",
    { retryable: true, retryAfterSeconds: 10 },
  );

/** Instância pelo produto da credencial: instância de outro produto é inexistente (R-09). */
export async function instanceForCredential(
  ctx: AppContext,
  credential: AppCredential,
  slug: string,
): Promise<Instance | null> {
  return findInstanceBySlug(ctx, credential.productCode, slug);
}

const sessionToken = (request: FastifyRequest): string => {
  const header = request.headers["x-instance-session"];
  return (Array.isArray(header) ? header[0] : header) ?? "";
};

/**
 * Login de produto (US3, D-04): o Core confere senha, vínculo ativo, conta ativa e instância, e
 * grava a sessão só no banco de acesso daquela instância. Qualquer recusa — sem vínculo, senha
 * errada, conta bloqueada, administrador da plataforma (FR-035), instância de outro produto —
 * recebe a mesma resposta, assim como instância que ainda não está ATIVA. A origem limitada é o IP do usuário informado pelo produto.
 */
async function productLogin(
  ctx: AppContext,
  credential: AppCredential,
  slug: string,
  input: { email: string; password: string; clientIp: string; userAgent?: string },
  correlationId: string,
) {
  const now = ctx.clock();
  const email = normalizeEmail(input.email);
  const rules = [
    throttleRules.loginEmail(email),
    throttleRules.appOrigin(credential.id, input.clientIp),
  ];
  const locked = await throttleStatus(ctx, rules);
  if (locked) throw identityErrors.throttled(locked);

  const instance = await instanceForCredential(ctx, credential, slug);
  const account = await findAccountByEmail(ctx.identity, email);
  const stored = account ? await passwordHashOf(ctx.identity, account.id) : null;
  const passwordOk = stored
    ? await verifyPassword(stored.hash, input.password)
    : (await burnPasswordCheck(input.password), false);

  let membershipId: string | null = null;
  // Instância ainda não ativa (PRONTA, em provisionamento ou em falha): nenhuma sessão é criada
  // e a recusa é a mesma das credenciais inválidas (F02 FR-028, CA-SC-007).
  if (passwordOk && account && instance?.state === "ATIVA" && account.status === "ativa") {
    const { rows } = await sql<{ id: Buffer }>`SELECT id FROM membership
       WHERE account_id = ${uuidToBin(account.id)} AND instance_id = ${uuidToBin(instance.id)}
         AND status = 'ativo'`.execute(ctx.identity);
    if (rows[0] && !(await isActivePlatformAdmin(ctx, account.id)))
      membershipId = binToUuid(rows[0].id);
  }
  const member = membershipId ? await readMemberState(ctx, membershipId) : null;

  const event = {
    type: "login_produto" as const,
    actorKind: "aplicacao" as const,
    actorAccountId: account?.id ?? null,
    targetAccountId: account?.id ?? null,
    instanceId: instance?.id ?? null,
    correlationId,
    ip: input.clientIp,
    userAgent: input.userAgent ?? null,
    at: now,
  };
  if (!account || !instance || !member) {
    const nowLocked = await registerFailure(ctx, rules);
    await recordSecurityEvent(ctx.identity, {
      ...event,
      result: "falha",
      detail: { credencial: credential.id },
    });
    if (nowLocked) throw identityErrors.throttled(nowLocked);
    throw identityErrors.invalidCredentials();
  }

  await clearFailures(ctx, [throttleRules.loginEmail(email)]);
  let created: { token: string; expiresAt: Date };
  try {
    created = await createProductSession(ctx, instance, member);
  } catch (error) {
    ctx.logger.warn(
      { err: error, instanceId: instance.id },
      "Banco de acesso inacessível no login",
    );
    throw instanceUnavailable();
  }
  await recordSecurityEvent(ctx.identity, {
    ...event,
    result: "sucesso",
    detail: { credencial: credential.id, papel: member.role },
  });
  return {
    token: created.token,
    expiresAt: created.expiresAt.toISOString(),
    idleTimeoutSeconds: 7200,
    account: { id: account.id, displayName: member.displayName },
    role: member.role,
  };
}

/** Contratos internos de sessão de produto (/internal/v1, US3). */
export function registerInternalSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    "/internal/v1/instances/:slug/sessions",
    {
      preHandler: requireAppCredential(ctx, "sessions"),
      schema: {
        params: Slug,
        body: Type.Object(
          {
            email: Type.String({ format: "email", maxLength: 254 }),
            password: Type.String({ minLength: 1, maxLength: 128 }),
            clientIp: Type.String({ minLength: 1, maxLength: 45 }),
            userAgent: Type.Optional(Type.String({ maxLength: 300 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const body = request.body as {
        email: string;
        password: string;
        clientIp: string;
        userAgent?: string;
      };
      const result = await withIdentity(() =>
        productLogin(ctx, credentialOf(request), slug, body, request.id),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/internal/v1/instances/:slug/sessions/touch",
    { preHandler: requireAppCredential(ctx, "sessions"), schema: { params: Slug } },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const instance = await withIdentity(() =>
        instanceForCredential(ctx, credentialOf(request), slug),
      );
      const invalid = () =>
        new AppError(401, "AUTH_SESSION_INVALID", "Sessão inválida ou encerrada.");
      if (!instance) throw invalid();
      let session;
      try {
        session = await touchProductSession(ctx, instance, sessionToken(request));
      } catch (error) {
        if (isConnectionError(error)) throw instanceUnavailable();
        throw error;
      }
      if (!session) throw invalid();
      return reply.status(204).send();
    },
  );
}

export { sessionToken };
