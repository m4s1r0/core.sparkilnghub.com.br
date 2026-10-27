import { useQuery } from "@tanstack/react-query";
import type { OneTimeLink } from "./admins";
import { requestJson } from "./client";
import type { SyncOutcome } from "./members";

export interface AccountSummary {
  accountId: string;
  displayName: string;
  email: string;
  status: "ativa" | "inativa" | "bloqueada";
}

export interface AccountDetail {
  account: AccountSummary;
  mfaEnrolled: boolean;
  platformRole: "ativo" | "inativo" | null;
  memberships: {
    membershipId: string;
    instanceId: string;
    instanceName: string;
    role: "administrador" | "colaborador";
    status: "ativo" | "revogado";
  }[];
  pendingRecoveryRequests: number;
}

export interface RecoveryRequest {
  id: string;
  email: string;
  accountId: string | null;
  createdAt: string;
}

export interface PendingSync {
  jobId: string;
  instanceId: string;
  instanceName: string;
  kind: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

export const accountKey = (id: string) => ["account", id] as const;

export function useAccount(id: string) {
  return useQuery({
    queryKey: accountKey(id),
    queryFn: () => requestJson<AccountDetail>("GET", `/api/v1/accounts/${id}`),
    retry: false,
  });
}

export function useRecoveryRequests() {
  return useQuery({
    queryKey: ["recovery-requests"],
    queryFn: () => requestJson<{ items: RecoveryRequest[] }>("GET", "/api/v1/recovery-requests"),
    retry: false,
  });
}

export function usePendingSync() {
  return useQuery({
    queryKey: ["access-sync-pending"],
    queryFn: () => requestJson<{ items: PendingSync[] }>("GET", "/api/v1/access-sync/pending"),
    retry: false,
  });
}

export const accountsApi = {
  requestRecovery: (email: string) =>
    requestJson<{ message: string }>("POST", "/api/v1/recovery-requests", { body: { email } }),
  completeReset: (token: string, password: string) =>
    requestJson<SyncOutcome>("POST", `/api/v1/password-resets/${encodeURIComponent(token)}`, {
      body: { password },
    }),
  find: (email: string) =>
    requestJson<{ items: AccountSummary[] }>(
      "GET",
      `/api/v1/accounts?email=${encodeURIComponent(email)}`,
    ),
  issueReset: (id: string) =>
    requestJson<OneTimeLink>("POST", `/api/v1/accounts/${id}/password-reset`),
  blockPreview: (id: string) =>
    requestJson<{ instances: { instanceId: string; name: string; role: string }[] }>(
      "GET",
      `/api/v1/accounts/${id}/block-preview`,
    ),
  block: (id: string, reason: string, key: string) =>
    requestJson<SyncOutcome>("POST", `/api/v1/accounts/${id}/block`, {
      body: { reason },
      idempotencyKey: key,
    }),
  unblock: (id: string, reason: string, key: string) =>
    requestJson<SyncOutcome>("POST", `/api/v1/accounts/${id}/unblock`, {
      body: { reason },
      idempotencyKey: key,
    }),
};
