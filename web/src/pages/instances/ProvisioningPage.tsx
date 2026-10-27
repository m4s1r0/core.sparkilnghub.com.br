import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  Progress,
  Skeleton,
  StepsBlock,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { ApiError } from "../../api/client";
import type { OneTimeLink } from "../../api/admins";
import { instanceKey, instancesApi, STATE_LABEL, useInstance } from "../../api/instances";
import {
  provisioningApi,
  provisioningKey,
  type ProvisioningTask,
  STEP_LABEL,
  STEP_ORDER,
  useProvisioning,
} from "../../api/provisioning";
import { OneTimeLinkDialog } from "../../components/OneTimeLinkDialog";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";
import { useReauth } from "../../components/ReauthDialog";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

type Attempt = ProvisioningTask["steps"][number];

const ATTEMPT_STATUS: Record<
  Attempt["status"],
  { label: string; tone: "neutral" | "success" | "warning" | "error" }
> = {
  em_execucao: { label: "Em execução", tone: "warning" },
  concluida: { label: "Concluída", tone: "success" },
  ignorada: { label: "Já estava feita", tone: "neutral" },
  falhou: { label: "Falhou", tone: "error" },
  interrompida: { label: "Interrompida", tone: "warning" },
};

const INVITATION_TEXT: Record<
  string,
  { label: string; tone: "neutral" | "success" | "warning" | "error" }
> = {
  aguardando_emissao: { label: "Aguardando emissão do link", tone: "warning" },
  emitido: { label: "Link emitido", tone: "success" },
  expirado: { label: "Link expirado", tone: "error" },
  aceito: { label: "Aceito", tone: "success" },
  revogado: { label: "Revogado", tone: "neutral" },
  inexistente: { label: "Sem convite inicial", tone: "neutral" },
};

/**
 * Convite inicial (US5, R-12): situação separada da prontidão técnica; o link é emitido depois
 * da prontidão e exibido uma única vez (D-07). Reemitir não toca em banco nem credencial.
 */
function InitialInvitation({ instanceId }: { instanceId: string }) {
  const instance = useInstance(instanceId);
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!instance.data) return null;
  const { initialInvitation, initialAdminEmail, state } = instance.data;
  const text = INVITATION_TEXT[initialInvitation.status] ?? INVITATION_TEXT.inexistente;
  const canIssue =
    state === "PRONTA" &&
    initialInvitation.status !== "aceito" &&
    initialInvitation.status !== "inexistente";

  const issue = async () => {
    setError(null);
    setIssuing(true);
    // Uma chave por emissão: a repetição após reautenticação não gera outro link.
    const key = crypto.randomUUID();
    try {
      setLink(await reauth.run(() => instancesApi.issueInitialInvitation(instanceId, key)));
      await queryClient.invalidateQueries({ queryKey: instanceKey(instanceId) });
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED")) {
        setError(caught instanceof ApiError ? caught.message : "Falha inesperada.");
      }
    } finally {
      setIssuing(false);
    }
  };

  return (
    <section aria-labelledby="convite-inicial" className="flex flex-col gap-3">
      <Heading level={2} id="convite-inicial">
        Convite inicial
      </Heading>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={text?.tone ?? "neutral"}>{text?.label ?? ""}</Badge>
        <span className="break-all">{initialAdminEmail}</span>
      </div>
      {error && (
        <Alert tone="error" title="Não foi possível emitir o link">
          {error}
        </Alert>
      )}
      {canIssue && (
        <div>
          <Button loading={issuing} onClick={() => void issue()}>
            {initialInvitation.status === "aguardando_emissao" ? "Emitir link" : "Reemitir link"}
          </Button>
        </div>
      )}
      <OneTimeLinkDialog
        title="Link do convite inicial"
        link={link}
        onClose={() => setLink(null)}
      />
      {reauth.dialog}
    </section>
  );
}

const attemptColumns: TableColumn<Attempt>[] = [
  { id: "step", header: "Etapa", rowHeader: true, cell: (row) => STEP_LABEL[row.step].title },
  { id: "run", header: "Execução", cell: (row) => `${row.runNumber}ª, tentativa ${row.attempt}` },
  {
    id: "status",
    header: "Resultado",
    cell: (row) => (
      <Badge tone={ATTEMPT_STATUS[row.status].tone}>{ATTEMPT_STATUS[row.status].label}</Badge>
    ),
  },
  {
    id: "duration",
    header: "Duração",
    align: "end",
    cell: (row) => (row.durationMs === null ? "—" : `${(row.durationMs / 1000).toFixed(1)} s`),
  },
];

/** Etapa em que a tarefa está (ou a última concluída), para o bloco de etapas. */
function currentIndex(task: ProvisioningTask): number {
  if (task.status === "concluida") return STEP_ORDER.length - 1;
  if (task.currentStep) return STEP_ORDER.indexOf(task.currentStep);
  const done = task.steps.filter((s) => s.status === "concluida" || s.status === "ignorada");
  const last = done.at(-1);
  return last ? STEP_ORDER.indexOf(last.step) : 0;
}

/** `/instancias/:id/provisionamento` — protocolo, etapas e situação (US3/US4, R-17). */
export function ProvisioningPage() {
  const { id = "" } = useParams();
  const provisioning = useProvisioning(id);
  const queryClient = useQueryClient();
  const reauth = useReauth();
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (provisioning.isPending) return <Skeleton label="Carregando provisionamento" lines={6} />;
  if (provisioning.isError) {
    const notFound = provisioning.error instanceof ApiError && provisioning.error.status === 404;
    return (
      <Alert tone="error" title={notFound ? "Provisionamento não encontrado" : "Falha ao carregar"}>
        {notFound ? (
          <Link to="/instancias" className="underline underline-offset-4">
            Voltar às instâncias
          </Link>
        ) : (
          <Button variant="secondary" onClick={() => void provisioning.refetch()}>
            Tentar novamente
          </Button>
        )}
      </Alert>
    );
  }
  const task = provisioning.data;
  const index = currentIndex(task);
  const state = STATE_LABEL[task.instanceState];
  const failedStep = task.error ? STEP_LABEL[task.error.step].title : null;

  const askRetry = () => {
    setActionError(null);
    // Uma chave por pedido de repetição: reenvio do mesmo pedido não agenda outra execução.
    const key = crypto.randomUUID();
    setAction({
      title: `Repetir o provisionamento ${task.protocol}`,
      description:
        "A tarefa retoma da última etapa válida; o histórico das tentativas anteriores é mantido.",
      confirmLabel: "Repetir provisionamento",
      onConfirm: async (reason) => {
        try {
          await reauth.run(() => provisioningApi.retry(id, reason, key));
          setAction(null);
          await queryClient.invalidateQueries({ queryKey: provisioningKey(id) });
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === "AUTH_REAUTH_REQUIRED") return;
          setActionError(caught instanceof ApiError ? caught.message : "Falha inesperada.");
        }
      },
    });
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <Heading level={1}>Provisionamento {task.protocol}</Heading>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={state.tone}>{state.label}</Badge>
          <Link to={`/instancias/${id}`} className="underline underline-offset-4">
            Detalhe da instância
          </Link>
        </div>
      </div>

      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        {(task.status === "pendente" || task.status === "em_execucao") && (
          <>
            <Text>
              Em andamento: {STEP_LABEL[STEP_ORDER[index] ?? "validar"].title}. Esta página se
              atualiza sozinha.
            </Text>
            <Progress
              label="Progresso do provisionamento"
              value={index + 1}
              max={STEP_ORDER.length}
            />
          </>
        )}
        {task.status === "aguardando_repeticao" && (
          <Alert tone="warning" title="Aguardando nova tentativa">
            {task.error?.message ?? "Falha temporária."} Próxima tentativa
            {task.nextAttemptAt ? ` às ${dateTime.format(new Date(task.nextAttemptAt))}` : ""} (
            {task.attempt} de {task.maxAttempts}).
          </Alert>
        )}
        {task.status === "falhou" && task.error && task.error.retryable && (
          <Alert tone="error" title="Falha no provisionamento">
            <p>
              Etapa {failedStep}: {task.error.message}
            </p>
            <p className="mt-2">
              Corrija a causa e repita. Código <code>{task.error.code}</code>.
            </p>
            <div className="mt-3">
              <Button onClick={askRetry}>Repetir</Button>
            </div>
          </Alert>
        )}
        {task.status === "falhou" && task.error && !task.error.retryable && (
          <Alert tone="error" title="Falha que exige procedimento operacional">
            <p>
              Etapa {failedStep}: {task.error.message}
            </p>
            <p className="mt-2">
              Encaminhe o protocolo <strong>{task.protocol}</strong> e o código{" "}
              <code>{task.error.code}</code> à operação (procedimento em
              docs/operacao/provisionamento.md). Nada foi apagado.
            </p>
          </Alert>
        )}
        {task.status === "concluida" && (
          <Alert tone="success" title="Instância pronta">
            Bancos, credencial, migrações e verificação concluídos. A instância ficará disponível
            aos usuários depois da ativação, numa etapa posterior.
          </Alert>
        )}
      </div>

      <StepsBlock
        current={index}
        steps={STEP_ORDER.map((step) => ({
          title: STEP_LABEL[step].title,
          description: STEP_LABEL[step].description,
        }))}
      />

      {task.status === "concluida" && <InitialInvitation instanceId={id} />}

      <Heading level={2}>Tentativas</Heading>
      <DataTable
        caption={`Tentativas do provisionamento ${task.protocol}`}
        columns={attemptColumns}
        rows={task.steps}
        rowKey={(row) => `${row.step}-${row.runNumber}-${row.attempt}-${row.startedAt}`}
        compact
        emptyMessage="Nenhuma etapa executada ainda."
      />
      <ReasonDialog request={action} error={actionError} onClose={() => setAction(null)} />
      {reauth.dialog}
    </>
  );
}
