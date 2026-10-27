import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  DataTable,
  Dialog,
  DropdownButton,
  Heading,
  Input,
  Select,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { useParams } from "react-router";
import { adminsApi, type OneTimeLink } from "../../api/admins";
import { useInstance } from "../../api/instances";
import { ApiError } from "../../api/client";
import {
  type Member,
  membersApi,
  membersKey,
  pendingText,
  type ProductRole,
  type SyncOutcome,
  useMembers,
} from "../../api/members";
import { OneTimeLinkDialog } from "../../components/OneTimeLinkDialog";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";
import { useReauth } from "../../components/ReauthDialog";

const ROLE_OPTIONS = [
  { value: "colaborador", label: "Colaborador" },
  { value: "administrador", label: "Administrador" },
];
const ROLE_LABEL: Record<ProductRole, string> = {
  administrador: "Administrador",
  colaborador: "Colaborador",
};
const STATUS: Record<Member["status"], { label: string; tone: "success" | "neutral" | "warning" }> =
  {
    ativo: { label: "Ativo", tone: "success" },
    revogado: { label: "Revogado", tone: "neutral" },
    convite_pendente: { label: "Convite pendente", tone: "warning" },
  };

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : "Ocorreu uma falha inesperada.";

/** `/instancias/:id/vinculos` — vínculos e convites de uma instância (US4, FR-016 a FR-021). */
export function MembersPage() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const instance = useInstance(id);
  const members = useMembers(id);
  const reauth = useReauth();
  const latest = useRef<Member[]>([]);
  latest.current = members.data?.items ?? [];

  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProductRole>("colaborador");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<ProductRole>("colaborador");
  // O diálogo lê o papel escolhido no momento do envio, não no momento em que foi aberto.
  const chosenRole = useRef<ProductRole>(newRole);
  chosenRole.current = newRole;
  const [roleDialog, setRoleDialog] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  const instanceName = instance.data?.displayName ?? "instância";
  const refresh = () => client.invalidateQueries({ queryKey: membersKey(id) });

  const done = async (text: string, outcome?: SyncOutcome) => {
    const pending = outcome ? pendingText(outcome) : null;
    setAction(null);
    setNotice(
      pending ? { tone: "warning", text: `${text} ${pending}` } : { tone: "success", text },
    );
    await refresh();
  };

  const fail = async (caught: unknown) => {
    // Conflito de versão: recarrega a lista e mantém o motivo digitado no diálogo.
    if (caught instanceof ApiError && caught.code === "CONFLICT_VERSION") await refresh();
    setActionError(message(caught));
  };

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Informe um e-mail válido.");
      return;
    }
    setEmailError(null);
    setInviting(true);
    const key = crypto.randomUUID();
    try {
      const created = await reauth.run(() =>
        membersApi.invite(id, { email: email.trim(), role }, key),
      );
      setInviteOpen(false);
      setEmail("");
      setLink(created);
      await refresh();
    } catch (caught) {
      setEmailError(message(caught));
    } finally {
      setInviting(false);
    }
  };

  const changeRole = (row: Member) => {
    const name = row.displayName ?? "membro";
    const target: ProductRole = row.role === "administrador" ? "colaborador" : "administrador";
    setNewRole(target);
    setRoleDialog(true);
    setActionError(null);
    setAction({
      title: `Mudar papel de ${name}`,
      description: `Papel atual: ${ROLE_LABEL[row.role]}. A mudança vale para as próximas requisições do produto.`,
      confirmLabel: `Mudar papel de ${name}`,
      onConfirm: async (reason) => {
        const current = latest.current.find((m) => m.membershipId === row.membershipId);
        const key = crypto.randomUUID();
        try {
          const outcome = await reauth.run(() =>
            membersApi.changeRole(
              id,
              row.membershipId ?? "",
              { role: chosenRole.current, reason, version: current?.version ?? row.version ?? 1 },
              key,
            ),
          );
          await done(`Papel de ${name} alterado.`, outcome);
        } catch (caught) {
          await fail(caught);
        }
      },
    });
  };
  const revoke = (row: Member) => {
    const name = row.displayName ?? "membro";
    setRoleDialog(false);
    setActionError(null);
    setAction({
      title: "Revogar acesso",
      description:
        "As sessões desta pessoa nesta instância são encerradas. A conta e os outros vínculos continuam.",
      confirmLabel: `Revogar acesso de ${name} à ${instanceName}`,
      danger: true,
      onConfirm: async (reason) => {
        const current = latest.current.find((m) => m.membershipId === row.membershipId);
        const key = crypto.randomUUID();
        try {
          const outcome = await reauth.run(() =>
            membersApi.revoke(
              id,
              row.membershipId ?? "",
              { reason, version: current?.version ?? row.version ?? 1 },
              key,
            ),
          );
          await done(`Acesso de ${name} revogado.`, outcome);
        } catch (caught) {
          await fail(caught);
        }
      },
    });
  };

  const revokeInvite = (row: Member) => {
    setRoleDialog(false);
    setActionError(null);
    setAction({
      title: "Revogar convite",
      description: "O link enviado deixa de valer.",
      confirmLabel: `Revogar convite de ${row.emailMasked ?? ""}`,
      danger: true,
      onConfirm: async (reason) => {
        try {
          await reauth.run(() => adminsApi.revokeInvitation(row.invitationId ?? "", reason));
          await done(`Convite de ${row.emailMasked ?? ""} revogado.`);
        } catch (caught) {
          await fail(caught);
        }
      },
    });
  };

  const columns: TableColumn<Member>[] = [
    {
      id: "name",
      header: "Pessoa",
      rowHeader: true,
      cell: (row) => row.displayName ?? row.emailMasked ?? "—",
    },
    { id: "email", header: "E-mail", cell: (row) => row.emailMasked ?? "—" },
    { id: "role", header: "Papel", cell: (row) => ROLE_LABEL[row.role] },
    {
      id: "status",
      header: "Estado",
      cell: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>,
    },
    {
      id: "actions",
      header: "Ações",
      cell: (row) => {
        const label = `Ações para ${row.displayName ?? row.emailMasked ?? "convite"}`;
        if (row.status === "ativo") {
          return (
            <DropdownButton
              label={label}
              variant="secondary"
              items={[
                { id: "role", label: "Mudar papel", onSelect: () => changeRole(row) },
                {
                  id: "revoke",
                  label: "Revogar acesso",
                  destructive: true,
                  onSelect: () => revoke(row),
                },
              ]}
            />
          );
        }
        if (row.status === "convite_pendente") {
          return (
            <DropdownButton
              label={label}
              variant="secondary"
              items={[
                {
                  id: "revoke-invite",
                  label: "Revogar convite",
                  destructive: true,
                  onSelect: () => revokeInvite(row),
                },
              ]}
            />
          );
        }
        return "—";
      },
    },
  ];

  const dialog: ReasonRequest | null =
    action && roleDialog
      ? {
          ...action,
          extra: (
            <Select
              label="Novo papel"
              name="role"
              options={ROLE_OPTIONS}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as ProductRole)}
            />
          ),
        }
      : action;

  return (
    <>
      <Breadcrumb
        label="Caminho"
        items={[{ label: "Instâncias", href: "/instancias" }, { label: instanceName }]}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Vínculos de {instanceName}</Heading>
          <Text tone="muted">Quem acessa esta instância e com qual papel.</Text>
        </div>
        <Dialog
          title="Convidar para a instância"
          description="O convite vale por 48 horas, serve uma vez e concede só o papel escolhido."
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            if (!open) setEmailError(null);
          }}
          trigger={<Button>Convidar</Button>}
        >
          <form className="flex flex-col gap-4" noValidate onSubmit={(e) => void submitInvite(e)}>
            <Input
              label="E-mail"
              type="email"
              name="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...(emailError ? { error: emailError } : {})}
            />
            <Select
              label="Papel"
              name="role"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(e) => setRole(e.target.value as ProductRole)}
            />
            <Button type="submit" loading={inviting}>
              {inviting ? "Gerando convite…" : "Gerar convite"}
            </Button>
          </form>
        </Dialog>
      </div>

      <div role="status">
        {notice && (
          <Alert
            tone={notice.tone}
            title={notice.tone === "success" ? "Feito" : "Aplicação pendente"}
          >
            {notice.text}
          </Alert>
        )}
      </div>

      {members.isError ? (
        <Alert tone="error" title="Não foi possível carregar os vínculos">
          <div className="flex flex-col items-start gap-3">
            <span>{message(members.error)}</span>
            <Button variant="secondary" onClick={() => void members.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        <DataTable
          caption={`Vínculos e convites de ${instanceName}`}
          columns={columns}
          rows={members.data?.items ?? []}
          rowKey={(row) => row.membershipId ?? row.invitationId ?? ""}
          loading={members.isPending}
          emptyMessage="Nenhum vínculo nesta instância."
        />
      )}

      <ReasonDialog request={dialog} error={actionError} onClose={() => setAction(null)} />
      <OneTimeLinkDialog title="Convite gerado" link={link} onClose={() => setLink(null)} />
      {reauth.dialog}
    </>
  );
}
