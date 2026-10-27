import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  DropdownButton,
  Heading,
  Input,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  ADMINS_KEY,
  adminsApi,
  type OneTimeLink,
  type PlatformAdmin,
  usePlatformAdmins,
} from "../../api/admins";
import { ApiError } from "../../api/client";
import { OneTimeLinkDialog } from "../../components/OneTimeLinkDialog";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";
import { useReauth } from "../../components/ReauthDialog";

const STATUS: Record<
  PlatformAdmin["status"],
  { label: string; tone: "success" | "neutral" | "warning" }
> = {
  ativo: { label: "Ativo", tone: "success" },
  inativo: { label: "Inativo", tone: "neutral" },
  convite_pendente: { label: "Convite pendente", tone: "warning" },
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : "Ocorreu uma falha inesperada.";

/** `/administradores` — equipe de administração da plataforma (US2, FR-009). */
export function AdminsPage() {
  const admins = usePlatformAdmins();
  const client = useQueryClient();
  const reauth = useReauth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteKey, setInviteKey] = useState(() => crypto.randomUUID());
  const [link, setLink] = useState<OneTimeLink | null>(null);
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const items = admins.data?.items ?? [];
  const activeCount = items.filter((i) => i.status === "ativo").length;
  const refresh = () => client.invalidateQueries({ queryKey: ADMINS_KEY });

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Informe um e-mail válido.");
      return;
    }
    setEmailError(null);
    setInviting(true);
    try {
      // A mesma chave vale para a repetição depois da reautenticação ou de um timeout.
      const created = await reauth.run(() => adminsApi.invite(email.trim(), inviteKey));
      setInviteOpen(false);
      setEmail("");
      setInviteKey(crypto.randomUUID());
      setLink(created);
      await refresh();
    } catch (caught) {
      setEmailError(message(caught));
    } finally {
      setInviting(false);
    }
  };

  const ask = (row: PlatformAdmin, kind: "deactivate" | "reactivate" | "revoke") => {
    const name = row.displayName ?? row.email;
    const config = {
      deactivate: {
        title: "Inativar administrador",
        description: "As sessões dele no painel serão encerradas imediatamente.",
        confirmLabel: `Inativar acesso de ${name}`,
        danger: true,
        run: (reason: string) => adminsApi.deactivate(row.accountId ?? "", reason),
        done: `Acesso de ${name} inativado.`,
      },
      reactivate: {
        title: "Reativar administrador",
        description: "Ele precisará entrar de novo com senha e segundo fator.",
        confirmLabel: `Reativar acesso de ${name}`,
        danger: false,
        run: (reason: string) => adminsApi.reactivate(row.accountId ?? "", reason),
        done: `Acesso de ${name} reativado.`,
      },
      revoke: {
        title: "Revogar convite",
        description: "O link enviado deixa de valer.",
        confirmLabel: `Revogar convite de ${row.email}`,
        danger: true,
        run: (reason: string) => adminsApi.revokeInvitation(row.invitationId ?? "", reason),
        done: `Convite de ${row.email} revogado.`,
      },
    }[kind];
    setActionError(null);
    setAction({
      ...config,
      onConfirm: async (reason) => {
        try {
          await reauth.run(() => config.run(reason));
          setAction(null);
          setNotice({ tone: "success", text: config.done });
          await refresh();
        } catch (caught) {
          setActionError(message(caught));
        }
      },
    });
  };

  const columns: TableColumn<PlatformAdmin>[] = [
    { id: "name", header: "Nome", rowHeader: true, cell: (row) => row.displayName ?? "—" },
    {
      id: "email",
      header: "E-mail",
      cell: (row) => <span className="break-all">{row.email}</span>,
    },
    {
      id: "status",
      header: "Estado",
      cell: (row) => <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>,
    },
    {
      id: "last",
      header: "Último acesso",
      cell: (row) => (row.lastLoginAt ? dateTime.format(new Date(row.lastLoginAt)) : "—"),
    },
    {
      id: "actions",
      header: "Ações",
      cell: (row) => {
        const name = row.displayName ?? row.email;
        const items =
          row.status === "ativo"
            ? [
                {
                  id: "deactivate",
                  label: "Inativar",
                  destructive: true,
                  disabled: activeCount <= 1,
                  onSelect: () => ask(row, "deactivate"),
                },
              ]
            : row.status === "inativo"
              ? [{ id: "reactivate", label: "Reativar", onSelect: () => ask(row, "reactivate") }]
              : [
                  {
                    id: "revoke",
                    label: "Revogar convite",
                    destructive: true,
                    onSelect: () => ask(row, "revoke"),
                  },
                ];
        return <DropdownButton label={`Ações para ${name}`} variant="secondary" items={items} />;
      },
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Administradores da plataforma</Heading>
          <Text tone="muted">
            Quem pode operar o SparkCore. Ações sensíveis pedem o código do aplicativo.
          </Text>
        </div>
        <Dialog
          title="Convidar administrador"
          description="O convite vale por 48 horas e só pode ser usado uma vez."
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            if (!open) setEmailError(null);
          }}
          trigger={<Button>Convidar administrador</Button>}
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
            <Button type="submit" loading={inviting}>
              {inviting ? "Gerando convite…" : "Gerar convite"}
            </Button>
          </form>
        </Dialog>
      </div>

      <div role="status">
        {notice && (
          <Alert tone={notice.tone} title={notice.tone === "success" ? "Feito" : "Atenção"}>
            {notice.text}
          </Alert>
        )}
      </div>

      {admins.isError ? (
        <Alert tone="error" title="Não foi possível carregar os administradores">
          <div className="flex flex-col items-start gap-3">
            <span>{message(admins.error)}</span>
            <Button variant="secondary" onClick={() => void admins.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <DataTable
            caption="Administradores e convites"
            columns={columns}
            rows={items}
            rowKey={(row) => row.accountId ?? row.invitationId ?? row.email}
            loading={admins.isPending}
            emptyMessage="Nenhum administrador encontrado."
          />
          {activeCount === 1 && (
            <Text tone="muted">
              Há só um administrador ativo: ele não pode ser inativado até que outro aceite um
              convite.
            </Text>
          )}
        </>
      )}

      <ReasonDialog request={action} error={actionError} onClose={() => setAction(null)} />
      <OneTimeLinkDialog title="Convite gerado" link={link} onClose={() => setLink(null)} />
      {reauth.dialog}
    </>
  );
}
