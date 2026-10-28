import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OneTimeLink } from "./admins";
import { requestJson } from "./client";

export type MigrationStep =
  | "confirmar_manutencao"
  | "confirmar_backup_previo"
  | "aplicar_migracoes_instancia"
  | "verificar_pos_migracao";

export interface TransitionResult {
  id: string;
  state: InstanceState;
  version: number;
}

export interface HealthCheck {
  checkedAt: string;
  healthy: boolean;
  schemaVersion: number | null;
  reason: string | null;
}

export interface InstanceHealthStatus {
  productVersion: string;
  schemaVersion: number | null;
  connectivity: "saudavel" | "indisponivel" | "desconhecida";
  lastCheck: HealthCheck | null;
  backup: {
    lastSuccessfulAt: string | null;
    lastResult: "sucesso" | "falha" | null;
    origin: string | null;
  };
}

export interface MigrationTask {
  id: string;
  protocol: string;
  status: TaskStatus;
  fromVersion: number | null;
  toVersion: number;
  currentStep: MigrationStep | null;
  attempt: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string; step: MigrationStep } | null;
}

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

export const healthKey = (id: string) => ["instance", id, "health"] as const;
export function useInstanceHealth(id: string) {
  return useQuery({
    queryKey: healthKey(id),
    queryFn: () => requestJson<InstanceHealthStatus>("GET", `/api/v1/instances/${id}/health`),
  });
}

export const migrationKey = (id: string) => ["instance", id, "migration"] as const;
export function useInstanceMigration(id: string, enabled: boolean) {
  return useQuery({
    queryKey: migrationKey(id),
    queryFn: () => requestJson<MigrationTask | null>("GET", `/api/v1/instances/${id}/migration`),
    enabled,
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
  // F03: ciclo e operação da instância.
  activate: (id: string, idempotencyKey: string) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/activate`, { idempotencyKey }),
  suspend: (id: string, reason: string, idempotencyKey: string) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/suspend`, {
      body: { reason },
      idempotencyKey,
    }),
  reactivate: (id: string, idempotencyKey: string) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/reactivate`, {
      idempotencyKey,
    }),
  enterMaintenance: (id: string, reason: string, idempotencyKey: string) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/maintenance/enter`, {
      body: { reason },
      idempotencyKey,
    }),
  exitMaintenance: (id: string, idempotencyKey: string) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/maintenance/exit`, {
      idempotencyKey,
    }),
  terminate: (
    id: string,
    input: { reason: string; exportReference: string | null; retentionPolicy: string },
    idempotencyKey: string,
  ) =>
    requestJson<TransitionResult>("POST", `/api/v1/instances/${id}/terminate`, {
      body: input,
      idempotencyKey,
    }),
  checkHealthNow: (id: string) =>
    requestJson<HealthCheck>("POST", `/api/v1/instances/${id}/health`),
  applyMigration: (id: string, idempotencyKey: string) =>
    requestJson<MigrationTask>("POST", `/api/v1/instances/${id}/migration`, { idempotencyKey }),
};
