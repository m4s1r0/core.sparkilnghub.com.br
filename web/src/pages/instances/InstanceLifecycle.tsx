import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Dialog,
  DropdownButton,
  Input,
  Skeleton,
  type TableColumn,
  Text,
  Textarea,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client";
import {
  healthKey,
  type InstanceDetail,
  instanceKey,
  instancesApi,
  type MigrationStep,
  type MigrationTask,
  migrationKey,
  useInstanceHealth,
  useInstanceMigration,
} from "../../api/instances";
import { ConfirmDialog, type ConfirmRequest } from "../../components/ConfirmDialog";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";
import { useReauth } from "../../components/ReauthDialog";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

const MIGRATION_STEP_LABEL: Record<MigrationStep, string> = {
  confirmar_manutencao: "Confirmar manutenção",
  confirmar_backup_previo: "Confirmar backup prévio",
  aplicar_migracoes_instancia: "Aplicar migrações",
  verificar_pos_migracao: "Verificar",
};

function key() {
  return crypto.randomUUID();
}

/**
 * Ações de ciclo no cabeçalho da instância (US1 a US4, US7, contracts/ui-f03.md): o conjunto de
 * ações disponíveis depende só do estado atual — nunca aparece a que não pode ser feita.
 */
export function LifecycleActions({ instance }: { instance: InstanceDetail }) {
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const [reasonAction, setReasonAction] = useState<ReasonRequest | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmRequest | null>(null);
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: instanceKey(instance.id) });

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await reauth.run(action);
      await refresh();
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED") return false;
      setError(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
      return false;
    }
  };

  const items: {
    id: string;
    label: string;
    destructive?: boolean;
    onSelect: () => void;
  }[] = [];

  if (instance.state === "PRONTA") {
    items.push({
      id: "ativar",
      label: "Ativar",
      onSelect: () =>
        setConfirmAction({
          title: `Ativar ${instance.displayName}`,
          description: "A instância passa a ATIVA e o produto aceita login.",
          confirmLabel: "Ativar",
          onConfirm: async () => {
            if (await run(() => instancesApi.activate(instance.id, key()))) setConfirmAction(null);
          },
        }),
    });
  }
  if (instance.state === "ATIVA") {
    items.push(
      {
        id: "suspender",
        label: "Suspender",
        destructive: true,
        onSelect: () =>
          setReasonAction({
            title: `Suspender ${instance.displayName}`,
            description:
              "A partir da confirmação, toda nova autorização nesta instância é negada e as sessões abertas são encerradas. Uma transação já autorizada antes pode concluir.",
            confirmLabel: "Suspender",
            danger: true,
            onConfirm: async (reason) => {
              if (await run(() => instancesApi.suspend(instance.id, reason, key()))) {
                setReasonAction(null);
              }
            },
          }),
      },
      {
        id: "manutencao",
        label: "Entrar em manutenção",
        onSelect: () =>
          setReasonAction({
            title: `Colocar ${instance.displayName} em manutenção`,
            description:
              "Novas operações de negócio ficam bloqueadas; uma transação já em curso pode concluir.",
            confirmLabel: "Entrar em manutenção",
            onConfirm: async (reason) => {
              if (await run(() => instancesApi.enterMaintenance(instance.id, reason, key()))) {
                setReasonAction(null);
              }
            },
          }),
      },
    );
  }
  if (instance.state === "SUSPENSA") {
    items.push(
      {
        id: "reativar",
        label: "Reativar",
        onSelect: () =>
          setConfirmAction({
            title: `Reativar ${instance.displayName}`,
            description:
              "A instância volta a ATIVA. Sessões revogadas pela suspensão não voltam a valer.",
            confirmLabel: "Reativar",
            onConfirm: async () => {
              if (await run(() => instancesApi.reactivate(instance.id, key()))) {
                setConfirmAction(null);
              }
            },
          }),
      },
      {
        id: "encerrar",
        label: "Encerrar",
        destructive: true,
        onSelect: () => setTerminating(true),
      },
    );
  }
  if (instance.state === "MANUTENCAO") {
    items.push({
      id: "sair-manutencao",
      label: "Sair da manutenção",
      onSelect: () =>
        setConfirmAction({
          title: `Sair da manutenção — ${instance.displayName}`,
          description: "Uma checagem de saúde roda agora; só sai se o resultado for saudável.",
          confirmLabel: "Sair da manutenção",
          onConfirm: async () => {
            if (await run(() => instancesApi.exitMaintenance(instance.id, key()))) {
              setConfirmAction(null);
            }
          },
        }),
    });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <DropdownButton label="Ações" items={items} />
      </div>
      {error && (
        <Alert tone="error" title="Não foi possível concluir">
          {error}
        </Alert>
      )}
      <ReasonDialog request={reasonAction} error={null} onClose={() => setReasonAction(null)} />
      <ConfirmDialog request={confirmAction} error={null} onClose={() => setConfirmAction(null)} />
      {terminating && (
        <TerminateDialog
          instance={instance}
          onClose={() => setTerminating(false)}
          onDone={() => {
            setTerminating(false);
            void refresh();
          }}
        />
      )}
      {reauth.dialog}
    </div>
  );
}

/** Encerrar exige motivo e política de retenção; a referência de exportação é opcional (SC-031). */
function TerminateDialog({
  instance,
  onClose,
  onDone,
}: {
  instance: InstanceDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const reauth = useReauth();
  const [reason, setReason] = useState("");
  const [retentionPolicy, setRetentionPolicy] = useState("");
  const [exportReference, setExportReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim().length < 3) {
      setError("Explique o motivo (pelo menos 3 caracteres).");
      return;
    }
    if (retentionPolicy.trim().length < 3) {
      setError("Informe a política de retenção.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await reauth.run(() =>
        instancesApi.terminate(
          instance.id,
          {
            reason: reason.trim(),
            retentionPolicy: retentionPolicy.trim(),
            exportReference: exportReference.trim() || null,
          },
          key(),
        ),
      );
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED") return;
      setError(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog
        title={`Encerrar ${instance.displayName}`}
        description="Ação administrativa terminal no MVP, depois da suspensão."
        trigger={<span hidden />}
        open
        onOpenChange={(open) => {
          if (!open && !submitting) onClose();
        }}
      >
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submit(e)}>
          <Alert tone="warning" title="Ação irreversível no MVP">
            O banco continua existindo (sem exclusão), mas não há, hoje, ação para reabrir ou
            excluir definitivamente uma instância encerrada.
          </Alert>
          {error && (
            <Alert tone="error" title="Não foi possível concluir">
              {error}
            </Alert>
          )}
          <Textarea
            label="Motivo"
            name="reason"
            maxLength={500}
            rows={3}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Textarea
            label="Política de retenção"
            name="retentionPolicy"
            maxLength={300}
            rows={2}
            required
            value={retentionPolicy}
            onChange={(e) => setRetentionPolicy(e.target.value)}
          />
          <Input
            label="Referência de exportação/backup (opcional)"
            name="exportReference"
            maxLength={300}
            value={exportReference}
            onChange={(e) => setExportReference(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" loading={submitting}>
              Encerrar {instance.displayName}
            </Button>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </form>
      </Dialog>
      {reauth.dialog}
    </>
  );
}

const CONNECTIVITY_LABEL: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "error" }
> = {
  saudavel: { label: "Saudável", tone: "success" },
  indisponivel: { label: "Indisponível", tone: "error" },
  desconhecida: { label: "Nunca verificada", tone: "neutral" },
};

/** Aba "Saúde" (US5, SC-042): versão, schema, conectividade e status de backup. */
export function HealthPanel({ instanceId }: { instanceId: string }) {
  const health = useInstanceHealth(instanceId);
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (health.isPending) return <Skeleton label="Carregando saúde" lines={4} />;
  if (health.isError) {
    return (
      <Alert tone="error" title="Falha ao carregar">
        <Button variant="secondary" onClick={() => void health.refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  }
  const data = health.data;
  const connectivity = CONNECTIVITY_LABEL[data.connectivity] ?? CONNECTIVITY_LABEL.desconhecida!;

  const checkNow = async () => {
    setError(null);
    setChecking(true);
    try {
      await instancesApi.checkHealthNow(instanceId);
      await queryClient.invalidateQueries({ queryKey: healthKey(instanceId) });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="error" title="Não foi possível verificar">
          {error}
        </Alert>
      )}
      <DescriptionList
        items={[
          { id: "product-version", term: "Versão do produto", description: data.productVersion },
          {
            id: "schema-version",
            term: "Versão de schema",
            description: data.schemaVersion === null ? "—" : `v${data.schemaVersion}`,
          },
          {
            id: "connectivity",
            term: "Conectividade",
            description: <Badge tone={connectivity.tone}>{connectivity.label}</Badge>,
          },
          {
            id: "last-check",
            term: "Última verificação",
            description: data.lastCheck
              ? `${dateTime.format(new Date(data.lastCheck.checkedAt))}${
                  data.lastCheck.healthy ? "" : ` · ${data.lastCheck.reason ?? "reprovada"}`
                }`
              : "Nunca verificada",
          },
          {
            id: "backup",
            term: "Último backup bem-sucedido",
            description: data.backup.lastSuccessfulAt
              ? `${dateTime.format(new Date(data.backup.lastSuccessfulAt))} · ${data.backup.origin ?? ""}`
              : "Sem backup bem-sucedido registrado",
          },
        ]}
      />
      <div>
        <Button variant="secondary" loading={checking} onClick={() => void checkNow()}>
          Verificar agora
        </Button>
      </div>
    </div>
  );
}

const migrationColumns: TableColumn<{
  step: MigrationStep;
  attempt: number;
  result: string;
}>[] = [
  { id: "step", header: "Etapa", rowHeader: true, cell: (row) => MIGRATION_STEP_LABEL[row.step] },
  { id: "attempt", header: "Tentativa", cell: (row) => String(row.attempt) },
  { id: "result", header: "Resultado", cell: (row) => row.result },
];

/** Aba "Migração" (US6, SC-044), só quando MANUTENCAO. */
export function MigrationPanel({ instance }: { instance: InstanceDetail }) {
  const enabled = instance.state === "MANUTENCAO";
  const migration = useInstanceMigration(instance.id, enabled);
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return <Text tone="muted">A migração só fica disponível com a instância em manutenção.</Text>;
  }
  if (migration.isPending) return <Skeleton label="Carregando migração" lines={3} />;

  const task: MigrationTask | null | undefined = migration.data;
  const inProgress = task?.status === "pendente" || task?.status === "em_execucao";

  const apply = async () => {
    setError(null);
    setApplying(true);
    try {
      await reauth.run(() => instancesApi.applyMigration(instance.id, key()));
      await queryClient.invalidateQueries({ queryKey: migrationKey(instance.id) });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED") return;
      setError(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="error" title="Não foi possível aplicar a migração">
          {error}
        </Alert>
      )}
      {task && (
        <Alert
          tone={
            task.status === "concluida" ? "success" : task.status === "falhou" ? "error" : "warning"
          }
          title={`Protocolo ${task.protocol}`}
        >
          Para a versão v{task.toVersion}: {task.status}
          {task.error ? ` · ${MIGRATION_STEP_LABEL[task.error.step]}: ${task.error.message}` : ""}
        </Alert>
      )}
      <div>
        <Button loading={applying || inProgress} onClick={() => void apply()}>
          Aplicar atualização
        </Button>
      </div>
      {task && task.status !== "pendente" && (
        <DataTable
          caption="Histórico desta tarefa de migração"
          columns={migrationColumns}
          rows={[
            {
              step: task.currentStep ?? "verificar_pos_migracao",
              attempt: task.attempt,
              result: task.status,
            },
          ]}
          rowKey={(row) => row.step}
          compact
        />
      )}
      {reauth.dialog}
    </div>
  );
}
