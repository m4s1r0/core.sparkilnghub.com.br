import { sql, type Kysely } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { retryOnDeadlock } from "../../platform/db/retry.js";
import { uuidToBin } from "../../platform/ids.js";
import { type Account, findAccountByEmail, insertAccount, passwordHashOf } from "./accounts.js";
import { createCoreSession } from "./core-sessions.js";
import { identityErrors, type RequestInfo } from "./errors.js";
import { findUsableInvitation, type Invitation, markInvitationAccepted } from "./invitations.js";
import { hasConfirmedFactor } from "./mfa.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "./password.js";
import { recordSecurityEvent } from "./security-events.js";
import { clearFailures, registerFailure, throttleRules, throttleStatus } from "./throttle.js";

export interface AcceptInput {
  displayName?: string;
  password?: string;
  currentPassword?: string;
}

/**
 * Vínculo de instância criado no aceite (US4). Registrado pelo módulo de vínculos para evitar
 * dependência circular; recebe a transação com o convite travado.
 */
type InstanceAcceptor = (
  ctx: AppContext,
  trx: Kysely<unknown>,
  invitation: Invitation,
  account: Account,
  now: Date,
) => Promise<{ membershipId: string }>;
let instanceAcceptor: InstanceAcceptor | undefined;
export function setInstanceAcceptor(acceptor: InstanceAcceptor): void {
  instanceAcceptor = acceptor;
}

/** Depois do commit: o vínculo aceito é replicado na projeção da instância. */
type AfterInstanceAccept = (
  ctx: AppContext,
  membershipId: string,
  instanceId: string,
) => Promise<void>;
let afterInstanceAccept: AfterInstanceAccept | undefined;
export function setAfterInstanceAccept(handler: AfterInstanceAccept): void {
  afterInstanceAccept = handler;
}

export type AcceptResult =
  | { kind: "plataforma"; token: string; next: "mfa" | "mfa_enrollment" }
  | { kind: "instancia"; next: "done" };

/**
 * Aceite de convite (FR-016, FR-019). Conta nova define nome e senha conforme a política. Conta
 * existente prova a posse com a senha atual — a senha não é trocada e nada dos outros vínculos é
 * revelado. Sessão do Core de OUTRA conta presente → recusa (caso-limite da spec). O convite é
 * travado com FOR UPDATE: dois aceites simultâneos resultam em um só.
 */
export async function acceptInvitation(
  ctx: AppContext,
  token: string,
  input: AcceptInput,
  info: RequestInfo,
  sessionAccountId: string | null,
): Promise<AcceptResult> {
  const now = ctx.clock();
  const originRule = throttleRules.inviteOrigin(info.ip);
  const locked = await throttleStatus(ctx, [originRule]);
  if (locked) throw identityErrors.throttled(locked);

  const preview = await findUsableInvitation(ctx.identity, now, token);
  if (!preview) {
    const nowLocked = await registerFailure(ctx, [originRule]);
    if (nowLocked) throw identityErrors.throttled(nowLocked);
    throw identityErrors.invitationInvalid();
  }

  const existing = await findAccountByEmail(ctx.identity, preview.emailNormalized);
  if (sessionAccountId && sessionAccountId !== existing?.id)
    throw identityErrors.invitationMismatch();

  let passwordHash: string | null = null;
  if (existing) {
    const accountRule = throttleRules.account(existing.id);
    const accountLocked = await throttleStatus(ctx, [accountRule]);
    if (accountLocked) throw identityErrors.throttled(accountLocked);
    if (sessionAccountId !== existing.id) {
      if (!input.currentPassword) {
        throw identityErrors.missingField(
          "/currentPassword",
          "Informe a senha atual da sua conta.",
        );
      }
      const stored = await passwordHashOf(ctx.identity, existing.id);
      const ok =
        existing.status === "ativa" &&
        stored !== null &&
        (await verifyPassword(stored.hash, input.currentPassword));
      if (!ok) {
        const nowLocked = await registerFailure(ctx, [accountRule]);
        if (nowLocked) throw identityErrors.throttled(nowLocked);
        throw identityErrors.invalidCredentials();
      }
      await clearFailures(ctx, [accountRule]);
    }
  } else {
    const displayName = input.displayName?.trim() ?? "";
    if (!displayName) throw identityErrors.missingField("/displayName", "Informe seu nome.");
    if (!input.password) throw identityErrors.missingField("/password", "Defina uma senha.");
    const problem = checkPasswordPolicy(input.password, {
      email: preview.emailNormalized,
      displayName,
    });
    if (problem) throw identityErrors.passwordPolicy(problem);
    passwordHash = await hashPassword(input.password);
  }

  const outcome = await retryOnDeadlock(() =>
    ctx.identity.transaction().execute(async (trx) => {
      const invitation = await findUsableInvitation(trx, now, token, { forUpdate: true });
      if (!invitation) throw identityErrors.invitationInvalid();
      let account = await findAccountByEmail(trx, invitation.emailNormalized, { forUpdate: true });
      if (!account) {
        if (!passwordHash) throw identityErrors.invitationInvalid();
        account = await insertAccount(trx, now, {
          email: invitation.emailNormalized,
          displayName: input.displayName ?? "",
          passwordHash,
        });
      } else if (existing === null) {
        // Conta criada por outro aceite entre a verificação e a trava: prova de posse ausente.
        throw identityErrors.invitationInvalid();
      }
      let membershipId: string | null = null;
      if (invitation.target === "plataforma") {
        await sql`INSERT INTO platform_role (account_id, role, status, granted_by, granted_at,
                  changed_by, changed_at, change_reason)
                VALUES (${uuidToBin(account.id)}, 'administrador', 'ativo',
                        ${invitation.createdBy ? uuidToBin(invitation.createdBy) : null}, ${now},
                        ${uuidToBin(account.id)}, ${now}, 'convite aceito')
                ON DUPLICATE KEY UPDATE status = 'ativo', changed_by = VALUES(changed_by),
                  changed_at = VALUES(changed_at), change_reason = VALUES(change_reason)`.execute(
          trx,
        );
      } else {
        if (!instanceAcceptor) throw identityErrors.invitationInvalid();
        membershipId = (await instanceAcceptor(ctx, trx, invitation, account, now)).membershipId;
      }
      await markInvitationAccepted(trx, now, invitation.id, account.id);
      await recordSecurityEvent(trx, {
        type: "convite_aceito",
        actorKind: "usuario",
        actorAccountId: account.id,
        targetAccountId: account.id,
        instanceId: invitation.instanceId,
        result: "sucesso",
        detail: { convite: invitation.id, alvo: invitation.target, papel: invitation.role },
        correlationId: info.correlationId,
        ip: info.ip,
        userAgent: info.userAgent,
        at: now,
      });
      return { invitation, account, membershipId };
    }),
  );

  if (outcome.invitation.target === "instancia") {
    if (outcome.membershipId && outcome.invitation.instanceId && afterInstanceAccept) {
      await afterInstanceAccept(ctx, outcome.membershipId, outcome.invitation.instanceId);
    }
    return { kind: "instancia", next: "done" };
  }
  const { token: sessionToken } = await createCoreSession(
    ctx.identity,
    now,
    outcome.account.id,
    outcome.account.authRevision,
    null,
  );
  const enrolled = await hasConfirmedFactor(ctx.identity, outcome.account.id);
  return { kind: "plataforma", token: sessionToken, next: enrolled ? "mfa" : "mfa_enrollment" };
}
