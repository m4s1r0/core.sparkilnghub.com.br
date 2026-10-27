import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

/** Contrato `PlatformAdmin`. */
export interface PlatformAdmin {
  accountId: string | null;
  invitationId: string | null;
  displayName: string | null;
  email: string;
  status: "ativo" | "inativo" | "convite_pendente";
  lastLoginAt: string | null;
}

/** Contrato `OneTimeLink`: exibido uma única vez (D-07). */
export interface OneTimeLink {
  link: string;
  expiresAt: string;
}

export const ADMINS_KEY = ["platform-admins"] as const;

export function usePlatformAdmins() {
  return useQuery({
    queryKey: ADMINS_KEY,
    queryFn: () => requestJson<{ items: PlatformAdmin[] }>("GET", "/api/v1/platform-admins"),
    retry: false,
  });
}

export const adminsApi = {
  invite: (email: string, idempotencyKey: string) =>
    requestJson<OneTimeLink>("POST", "/api/v1/platform-admins/invitations", {
      body: { email },
      idempotencyKey,
    }),
  deactivate: (accountId: string, reason: string) =>
    requestJson<undefined>("POST", `/api/v1/platform-admins/${accountId}/deactivate`, {
      body: { reason },
    }),
  reactivate: (accountId: string, reason: string) =>
    requestJson<undefined>("POST", `/api/v1/platform-admins/${accountId}/reactivate`, {
      body: { reason },
    }),
  revokeInvitation: (invitationId: string, reason: string) =>
    requestJson<undefined>("POST", `/api/v1/invitations/${invitationId}/revoke`, {
      body: { reason },
    }),
};
