import { useQuery } from "@tanstack/react-query";
import type { OneTimeLink } from "./admins";
import { requestJson } from "./client";

export type ProductRole = "administrador" | "colaborador";

/** Contrato `Member`. */
export interface Member {
  membershipId: string | null;
  invitationId: string | null;
  displayName: string | null;
  emailMasked: string | null;
  role: ProductRole;
  status: "ativo" | "revogado" | "convite_pendente";
  version: number | null;
}

/** Contrato `SyncOutcome`: resultado por instância das operações que alcançam a projeção. */
export interface SyncOutcome {
  instances: { instanceId: string; status: "aplicada" | "pendente" }[];
}

export const membersKey = (instanceId: string) => ["members", instanceId] as const;

export function useMembers(instanceId: string) {
  return useQuery({
    queryKey: membersKey(instanceId),
    queryFn: () =>
      requestJson<{ items: Member[] }>("GET", `/api/v1/instances/${instanceId}/members`),
    retry: false,
  });
}

export const membersApi = {
  invite: (instanceId: string, body: { email: string; role: ProductRole }, key: string) =>
    requestJson<OneTimeLink>("POST", `/api/v1/instances/${instanceId}/invitations`, {
      body,
      idempotencyKey: key,
    }),
  changeRole: (
    instanceId: string,
    membershipId: string,
    body: { role: ProductRole; reason: string; version: number },
    key: string,
  ) =>
    requestJson<SyncOutcome>(
      "POST",
      `/api/v1/instances/${instanceId}/members/${membershipId}/role`,
      { body, idempotencyKey: key },
    ),
  revoke: (
    instanceId: string,
    membershipId: string,
    body: { reason: string; version: number },
    key: string,
  ) =>
    requestJson<SyncOutcome>(
      "POST",
      `/api/v1/instances/${instanceId}/members/${membershipId}/revoke`,
      { body, idempotencyKey: key },
    ),
};

/** Mensagem para resultados com instância pendente (FR-027). */
export function pendingText(outcome: SyncOutcome): string | null {
  const pending = outcome.instances.filter((i) => i.status === "pendente").length;
  if (pending === 0) return null;
  return pending === 1
    ? "Gravado no Core, mas a instância está inacessível agora: a revogação está pendente e será repetida automaticamente."
    : `Gravado no Core, mas ${pending} instâncias estão inacessíveis: a aplicação está pendente e será repetida automaticamente.`;
}
