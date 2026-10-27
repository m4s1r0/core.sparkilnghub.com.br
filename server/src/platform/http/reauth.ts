import type { FastifyRequest } from "fastify";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../context.js";
import { authOf } from "./session-guard.js";

/** Janela da reconfirmação do TOTP para ações sensíveis (FR-008, SC-026). */
export const REAUTH_WINDOW_MS = 5 * 60_000;

export function reauthValidUntil(mfaConfirmedAt: Date | null): Date | null {
  return mfaConfirmedAt ? new Date(mfaConfirmedAt.getTime() + REAUTH_WINDOW_MS) : null;
}

/** Ação sensível: exige TOTP confirmado nos últimos 5 minutos, senão 403 AUTH_REAUTH_REQUIRED. */
export function requireRecentMfa(ctx: AppContext, request: FastifyRequest): void {
  const until = reauthValidUntil(authOf(request).session.mfaConfirmedAt);
  if (!until || ctx.clock() >= until) {
    throw new AppError(
      403,
      "AUTH_REAUTH_REQUIRED",
      "Confirme o código do aplicativo autenticador para continuar.",
    );
  }
}
