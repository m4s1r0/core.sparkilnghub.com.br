import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../app/errors.js";
import {
  type CoreSession,
  resolveCoreSession,
  type SessionAccount,
} from "../../modules/identity/core-sessions.js";
import type { AppContext } from "../context.js";
import { clearSessionCookie, readSessionCookie } from "./cookies.js";
import { withIdentity } from "./identity-errors.js";

export interface AuthContext {
  session: CoreSession;
  account: SessionAccount;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export const sessionRequired = () =>
  new AppError(401, "AUTH_SESSION_REQUIRED", "Sua sessão terminou. Entre novamente.");

/**
 * Exige sessão do Core válida. `mfa: true` (padrão) exige o segundo fator confirmado; rotas do
 * próprio segundo fator e do cadastro de TOTP aceitam a sessão pré-MFA.
 */
export function requireSession(ctx: AppContext, options: { mfa?: boolean } = {}) {
  const needsMfa = options.mfa ?? true;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const resolved = await withIdentity(() => resolveCoreSession(ctx, readSessionCookie(request)));
    if (!resolved.ok) {
      clearSessionCookie(reply, ctx.config);
      throw sessionRequired();
    }
    if (needsMfa && !resolved.session.mfaConfirmedAt) {
      throw new AppError(401, "AUTH_MFA_REQUIRED", "Confirme o segundo fator para continuar.");
    }
    request.auth = { session: resolved.session, account: resolved.account };
  };
}

export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw sessionRequired();
  return request.auth;
}
