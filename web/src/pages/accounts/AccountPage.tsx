import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  DataTable,
  DescriptionList,
  Heading,
  Skeleton,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { type AccountDetail, accountKey, accountsApi, useAccount } from "../../api/accounts";
import type { OneTimeLink } from "../../api/admins";
import { ApiError } from "../../api/client";
import { pendingText, type SyncOutcome } from "../../api/members";
import { OneTimeLinkDialog } from "../../components/OneTimeLinkDialog";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";
import { useReauth } from "../../components/ReauthDialog";

type Membership = AccountDetail["memberships"][number];

const STATUS_LABEL = { ativa: "Ativa", inativa: "Inativa", bloqueada: "Bloqueada" } as const;
const message = (error: unknown) =>
  error instanceof ApiError ? error.message : "Ocorreu uma falha inesperada.";

const columns: TableColumn<Membership>[] = [
  { id: "instance", header: "Instância", rowHeader: true, cell: (row) => row.instanceName },
  {
    id: "role",
    header: "Papel",
    cell: (row) => (row.role === "administrador" ? "Administrador" : "Colaborador"),
  },
  {
    id: "status",
    header: "Estado",
    cell: (row) => (
      <Badge tone={row.status === "ativo" ? "success" : "neutral"}>
        {row.status === "ativo" ? "Ativo" : "Revogado"}
      </Badge>
    ),
  },
];

/**
 * `/contas/:id` — conta global: vínculos, link de recuperação (exibido uma vez), bloqueio com
 * prévia das instâncias afetadas e desbloqueio (US5, FR-022, SC-012).
 */
export function AccountPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const detail = useAccount(id);
  const reauth = useReauth();
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);

  const refresh = () => client.invalidateQueries({ queryKey: accountKey(id) });
  const finish = async (text: string, outcome: SyncOutcome) => {
    const pending = pendingText(outcome);
    setAction(null);
    setNotice(
      pending ? { tone: "warning", text: `${text} ${pending}` } : { tone: "success", text },
    );
    await refresh();
  };

  if (detail.isPending) return <Skeleton label="Carregando conta" lines={6} />;
  if (detail.isError) {
    return (
      <Alert tone="error" title="Não foi possível carregar a conta">
        {message(detail.error)}
      </Alert>
    );
  }
  const { account } = detail.data;
  const name = account.displayName;

  const issueLink = async () => {
    setIssuing(true);
    setNotice(null);
    try {
      setLink(await reauth.run(() => accountsApi.issueReset(id)));
      await refresh();
    } catch (caught) {
      setNotice({ tone: "error", text: message(caught) });
    } finally {
      setIssuing(false);
    }
  };

  const prepareBlock = async () => {
    setPreparing(true);
    setNotice(null);
    try {
      const preview = await accountsApi.blockPreview(id);
      setActionError(null);
      setAction({
        title: `Bloquear ${name}`,
        description:
          "Bloqueio global: a conta deixa de entrar em qualquer lugar e todas as sessões são encerradas.",
        confirmLabel: `Bloquear ${name} em todas as instâncias`,
        danger: true,
        extra: (
          <div className="flex flex-col gap-2">
            <Text>Instâncias afetadas:</Text>
            {preview.instances.length === 0 ? (
              <Text tone="muted">Nenhuma instância (só o acesso ao painel, se houver).</Text>
            ) : (
              <ul className="list-disc pl-6" aria-label="Instâncias afetadas">
                {preview.instances.map((i) => (
                  <li key={i.instanceId}>
                    {i.name} ({i.role === "administrador" ? "administrador" : "colaborador"})
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
        onConfirm: async (reason) => {
          const key = crypto.randomUUID();
          try {
            await finish(
              `${name} bloqueada.`,
              await reauth.run(() => accountsApi.block(id, reason, key)),
            );
          } catch (caught) {
            setActionError(message(caught));
          }
        },
      });
    } catch (caught) {
      setNotice({ tone: "error", text: message(caught) });
    } finally {
      setPreparing(false);
    }
  };

  const prepareUnblock = () => {
    setActionError(null);
    setAction({
      title: `Desbloquear ${name}`,
      description: "A conta volta a poder entrar. Sessões encerradas no bloqueio não voltam.",
      confirmLabel: `Desbloquear ${name}`,
      onConfirm: async (reason) => {
        const key = crypto.randomUUID();
        try {
          await finish(
            `${name} desbloqueada.`,
            await reauth.run(() => accountsApi.unblock(id, reason, key)),
          );
        } catch (caught) {
          setActionError(message(caught));
        }
      },
    });
  };

  return (
    <>
      <Breadcrumb label="Caminho" items={[{ label: "Contas", href: "/contas" }, { label: name }]} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <Heading level={1}>{name}</Heading>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={issuing} onClick={() => void issueLink()}>
            Gerar link de recuperação
          </Button>
          {account.status === "bloqueada" ? (
            <Button onClick={prepareUnblock}>Desbloquear</Button>
          ) : (
            <Button variant="danger" loading={preparing} onClick={() => void prepareBlock()}>
              Bloquear conta
            </Button>
          )}
        </div>
      </div>
      <div role="status">
        {notice && (
          <Alert
            tone={notice.tone}
            title={
              notice.tone === "success"
                ? "Feito"
                : notice.tone === "warning"
                  ? "Aplicação pendente"
                  : "Atenção"
            }
          >
            {notice.text}
          </Alert>
        )}
      </div>
      <DescriptionList
        items={[
          { id: "email", term: "E-mail", description: account.email },
          {
            id: "status",
            term: "Estado",
            description: (
              <Badge
                tone={
                  account.status === "ativa"
                    ? "success"
                    : account.status === "bloqueada"
                      ? "error"
                      : "neutral"
                }
              >
                {STATUS_LABEL[account.status]}
              </Badge>
            ),
          },
          {
            id: "platform",
            term: "Administração da plataforma",
            description:
              detail.data.platformRole === "ativo"
                ? "Administrador ativo"
                : detail.data.platformRole === "inativo"
                  ? "Administrador inativo"
                  : "Não",
          },
          {
            id: "mfa",
            term: "Aplicativo autenticador",
            description: detail.data.mfaEnrolled ? "Cadastrado" : "Não cadastrado",
          },
          {
            id: "requests",
            term: "Pedidos de recuperação pendentes",
            description: String(detail.data.pendingRecoveryRequests),
          },
        ]}
      />
      <DataTable
        caption="Vínculos da conta"
        columns={columns}
        rows={detail.data.memberships}
        rowKey={(row) => row.membershipId}
        emptyMessage="Esta conta não tem vínculos com instâncias."
      />
      <ReasonDialog request={action} error={actionError} onClose={() => setAction(null)} />
      <OneTimeLinkDialog
        title="Link de recuperação gerado"
        link={link}
        onClose={() => setLink(null)}
      />
      {reauth.dialog}
    </>
  );
}
