import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OneTimeLink } from "./admins";
import { requestJson } from "./client";

export type InstanceState =
  | "CADASTRADA"
  | "PROVISIONANDO"
  | "FALHA_PROVISIONAMENTO"
  | "PRONTA"
  | "ATIVA"
  | "SUSPENSA"
  | "MANUTENCAO"
  | "ENCERRADA";

export type TaskStatus =
  "pendente" | "em_execucao" | "aguardando_repeticao" | "concluida" | "falhou";

export interface InstanceSummary {
  id: string;
  contractorId: string;
  contractorName: string;
  productCode: string;
  slug: string;
  displayName: string;
  state: InstanceState;
  synthetic: boolean;
  lastTask: { protocol: string; status: TaskStatus } | null;
  validityExpired: boolean;
  createdAt: string;
}

/** Rótulo e tom de cada estado (contracts/ui-f02.md). */
export const STATE_LABEL: Record<
  InstanceState,
  { label: string; tone: "neutral" | "success" | "warning" | "error" }
> = {
  CADASTRADA: { label: "Cadastrada", tone: "neutral" },
  PROVISIONANDO: { label: "Provisionando", tone: "warning" },
  FALHA_PROVISIONAMENTO: { label: "Falha no provisionamento", tone: "error" },
  PRONTA: { label: "Pronta", tone: "success" },
  ATIVA: { label: "Ativa", tone: "success" },
  SUSPENSA: { label: "Suspensa", tone: "warning" },
  MANUTENCAO: { label: "Manutenção", tone: "warning" },
  ENCERRADA: { label: "Encerrada", tone: "neutral" },
};

export interface InstanceRequest {
  contractorId: string;
  productCode: string;
  displayName: string;
  slug: string;
  timezone: string;
  initialAdminEmail: string;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

export interface InstancePreview {
  slug: string;
  slugAvailable: boolean;
  contractor: { id: string; displayName: string };
  product: { code: string; name: string };
  timezone: string;
  initialAdminEmail: string;
}

export interface InstanceCreated {
  instance: InstanceSummary;
  task: { id: string; protocol: string; status: TaskStatus };
}

export function useTimezones() {
  return useQuery({
    queryKey: ["timezones"],
    queryFn: () =>
      requestJson<{ items: string[]; default: string }>("GET", "/api/v1/instances/timezones"),
    staleTime: Infinity,
  });
}

export interface InstanceDetail extends InstanceSummary {
  timezone: string;
  initialAdminEmail: string;
  schemaVersion: number | null;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
  version: number;
  initialInvitation: {
    status: "aguardando_emissao" | "emitido" | "expirado" | "aceito" | "revogado" | "inexistente";
    expiresAt: string | null;
  };
  transitions: {
    from: InstanceState | null;
    to: InstanceState;
    actorKind: "usuario" | "sistema";
    actorName: string;
    reason: string | null;
    at: string;
  }[];
}

export interface InstanceFilters {
  contractorId: string;
  productCode: string;
  state: "" | InstanceState;
  createdFrom: string;
  createdTo: string;
  page: number;
}

const PAGE_SIZE = 20;

export const instanceKey = (id: string) => ["instance", id] as const;

export function useInstanceList(filters: InstanceFilters) {
  const params = new URLSearchParams({ page: String(filters.page), pageSize: String(PAGE_SIZE) });
  for (const key of ["contractorId", "productCode", "state", "createdFrom", "createdTo"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return useQuery({
    queryKey: ["instances", filters],
    queryFn: () =>
      requestJson<{
        items: InstanceSummary[];
        pageInfo: { page: number; pageSize: number; total: number };
      }>("GET", `/api/v1/instances?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
}

export function useInstance(id: string) {
  return useQuery({
    queryKey: instanceKey(id),
    queryFn: () => requestJson<InstanceDetail>("GET", `/api/v1/instances/${id}`),
  });
}

export const instancesApi = {
  update: (
    id: string,
    input: {
      displayName: string;
      notes: string | null;
      validFrom: string | null;
      validUntil: string | null;
      version: number;
    },
  ) => requestJson<InstanceDetail>("PUT", `/api/v1/instances/${id}`, { body: input }),
  issueInitialInvitation: (id: string, idempotencyKey: string) =>
    requestJson<OneTimeLink>("POST", `/api/v1/instances/${id}/initial-invitation/issue`, {
      idempotencyKey,
    }),
  preview: (input: InstanceRequest) =>
    requestJson<InstancePreview>("POST", "/api/v1/instances/preview", { body: input }),
  request: (input: InstanceRequest, idempotencyKey: string) =>
    requestJson<InstanceCreated>("POST", "/api/v1/instances", { body: input, idempotencyKey }),
};
