import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, requestJson } from "./client";

/** Contrato `SessionInfo` (contracts/openapi.yaml). */
export interface SessionInfo {
  account: { id: string; displayName: string; email: string };
  mfa: { enrolled: boolean; confirmed: boolean; reauthValidUntil: string | null };
  platformRole: "administrador" | null;
}

export type LoginNext = "mfa" | "mfa_enrollment" | "done";

export interface InvitationPreview {
  target: "plataforma" | "instancia";
  instanceName: string | null;
  roleLabel: string;
  emailMasked: string;
  accountExists: boolean;
  expiresAt: string;
}

export const SESSION_KEY = ["session"] as const;

/** Sessão atual; `null` quando não há sessão (401). */
export function useSession() {
  return useQuery<SessionInfo | null>({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      try {
        return await requestJson<SessionInfo>("GET", "/api/v1/session");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

/** Invalida a sessão em cache depois de login, segundo fator, logout ou reautenticação. */
export function useRefreshSession() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: SESSION_KEY });
}

export const authApi = {
  login: (email: string, password: string) =>
    requestJson<{ next: LoginNext }>("POST", "/api/v1/auth/login", { body: { email, password } }),
  confirmMfa: (input: { code: string } | { recoveryCode: string }) =>
    requestJson<{ next: LoginNext }>("POST", "/api/v1/auth/mfa", { body: input }),
  reauth: (code: string) =>
    requestJson<SessionInfo>("POST", "/api/v1/auth/reauth", { body: { code } }),
  logout: () => requestJson<undefined>("POST", "/api/v1/auth/logout"),
  startEnrollment: () =>
    requestJson<{ otpauthUri: string; secret: string }>("POST", "/api/v1/account/mfa/enrollment"),
  confirmEnrollment: (code: string) =>
    requestJson<{ codes: string[] }>("POST", "/api/v1/account/mfa/enrollment/confirm", {
      body: { code },
    }),
  inspectInvitation: (token: string) =>
    requestJson<InvitationPreview>("GET", `/api/v1/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (
    token: string,
    body: { displayName?: string; password?: string; currentPassword?: string },
  ) =>
    requestJson<{ next: LoginNext }>(
      "POST",
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
      { body },
    ),
};

/** Texto de espera para limitação de tentativas (429 com Retry-After). */
export function retryText(error: ApiError): string {
  const minutes = Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60));
  return minutes === 1 ? "cerca de 1 minuto" : `cerca de ${minutes} minutos`;
}
