import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { createInvitationTx, invitationLink } from "./invitations.js";
import { recordSecurityEvent } from "./security-events.js";

/** Bootstrap recusado: já existe administrador ativo ou convite de plataforma pendente. */
export class BootstrapRefused extends Error {
  readonly exitCode = 3;
  constructor(message: string) {
    super(message);
    this.name = "BootstrapRefused";
  }
}

/**
 * Gera o convite do primeiro administrador da plataforma (FR-005, R-12). Não existe cadastro
 * público: o procedimento recusa quando já há administrador ativo ou convite de plataforma
 * pendente no prazo. O link é exibido uma única vez para quem executou (D-07).
 */
export async function bootstrapAdmin(
  ctx: AppContext,
  email: string,
): Promise<{ link: string; expiresAt: Date }> {
  const now = ctx.clock();
  return ctx.identity.transaction().execute(async (trx) => {
    const { rows: admins } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM platform_role WHERE status = 'ativo' FOR UPDATE`.execute(trx);
    if (Number(admins[0]?.n ?? 0) > 0) {
      throw new BootstrapRefused(
        "Já existe administrador da plataforma ativo; convide novos administradores pelo painel.",
      );
    }
    const { rows: pending } = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM invitation
       WHERE target = 'plataforma' AND status = 'pendente' AND expires_at > ${now}
       FOR UPDATE`.execute(trx);
    if (Number(pending[0]?.n ?? 0) > 0) {
      throw new BootstrapRefused(
        "Já existe convite de administrador pendente e válido; use-o ou aguarde expirar.",
      );
    }
    const { invitation, token } = await createInvitationTx(trx, now, {
      target: "plataforma",
      instanceId: null,
      role: "administrador",
      email,
      createdBy: null,
    });
    await recordSecurityEvent(trx, {
      type: "bootstrap",
      actorKind: "sistema",
      result: "sucesso",
      detail: { convite: invitation.id },
      at: now,
    });
    return { link: invitationLink(ctx.config, token), expiresAt: invitation.expiresAt };
  });
}
