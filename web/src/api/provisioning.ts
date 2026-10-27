import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";
import type { InstanceState, TaskStatus } from "./instances";

export type StepName =
  | "validar"
  | "reservar"
  | "criar_bancos"
  | "criar_credencial"
  | "aplicar_migracoes"
  | "configurar"
  | "preparar_convite"
  | "verificar"
  | "concluir";

export interface ProvisioningTask {
  id: string;
  protocol: string;
  instanceId: string;
  instanceState: InstanceState;
  status: TaskStatus;
  currentStep: StepName | null;
  runNumber: number;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  artifactVersion: number;
  error: { code: string; message: string; step: StepName; retryable: boolean } | null;
  steps: {
    step: StepName;
    runNumber: number;
    attempt: number;
    status: "em_execucao" | "concluida" | "falhou" | "interrompida" | "ignorada";
    startedAt: string;
    finishedAt: string | null;
    durationMs: number | null;
    errorCode: string | null;
  }[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Etapas na ordem da tarefa (FR-021), com o texto exibido. */
export const STEP_LABEL: Record<StepName, { title: string; description: string }> = {
  validar: { title: "Validação", description: "Contratante, produto e artefato conferidos." },
  reservar: { title: "Reserva", description: "Identidade da instância e tarefa registradas." },
  criar_bancos: { title: "Bancos", description: "Banco operacional e banco de acesso exclusivos." },
  criar_credencial: {
    title: "Credencial",
    description: "Credencial operacional restrita aos bancos da instância.",
  },
  aplicar_migracoes: { title: "Migrações", description: "Versões do produto aplicadas." },
  configurar: { title: "Configuração", description: "Marcador da instância e acesso preparados." },
  preparar_convite: {
    title: "Convite inicial",
    description: "Convite do primeiro administrador preparado.",
  },
  verificar: { title: "Verificação", description: "Conexão, versão e privilégios conferidos." },
  concluir: { title: "Pronta", description: "Instância pronta para ativação." },
};

export const STEP_ORDER = Object.keys(STEP_LABEL) as StepName[];

const ACTIVE: ReadonlySet<TaskStatus> = new Set([
  "pendente",
  "em_execucao",
  "aguardando_repeticao",
]);

export const provisioningKey = (instanceId: string) => ["provisioning", instanceId] as const;

/** Acompanhamento a cada 2 s enquanto a tarefa está ativa (research.md R-17). */
export function useProvisioning(instanceId: string) {
  return useQuery({
    queryKey: provisioningKey(instanceId),
    queryFn: () =>
      requestJson<ProvisioningTask>("GET", `/api/v1/instances/${instanceId}/provisioning`),
    refetchInterval: (query) =>
      query.state.data && ACTIVE.has(query.state.data.status) ? 2_000 : false,
    refetchIntervalInBackground: false,
  });
}

export const provisioningApi = {
  retry: (instanceId: string, reason: string, idempotencyKey: string) =>
    requestJson<ProvisioningTask>("POST", `/api/v1/instances/${instanceId}/provisioning/retry`, {
      body: { reason },
      idempotencyKey,
    }),
};
