import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Heading,
  Input,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import {
  type AccountSummary,
  accountsApi,
  type RecoveryRequest,
  useRecoveryRequests,
} from "../../api/accounts";
import { ApiError } from "../../api/client";

const STATUS: Record<
  AccountSummary["status"],
  { label: string; tone: "success" | "neutral" | "error" }
> = {
  ativa: { label: "Ativa", tone: "success" },
  inativa: { label: "Inativa", tone: "neutral" },
  bloqueada: { label: "Bloqueada", tone: "error" },
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

const requestColumns: TableColumn<RecoveryRequest>[] = [
  {
    id: "email",
    header: "E-mail",
    rowHeader: true,
    cell: (row) => <span className="break-all">{row.email}</span>,
  },
  { id: "when", header: "Pedido em", cell: (row) => dateTime.format(new Date(row.createdAt)) },
  {
    id: "account",
    header: "Conta",
    cell: (row) =>
      row.accountId ? (
        <Link to={`/contas/${row.accountId}`} className="underline underline-offset-4">
          Abrir conta
        </Link>
      ) : (
        "Sem conta"
      ),
  },
];

/** `/contas` — busca exata por e-mail e fila de pedidos de recuperação (US5, R-11). */
export function AccountsPage() {
  const requests = useRecoveryRequests();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFieldError("Informe o e-mail completo: a busca é exata.");
      return;
    }
    setFieldError(null);
    setError(null);
    setSearching(true);
    try {
      setResult((await accountsApi.find(email.trim())).items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Ocorreu uma falha inesperada.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Contas</Heading>
        <Text tone="muted">
          Localize uma conta pelo e-mail para ver vínculos, gerar link de recuperação ou bloquear.
        </Text>
      </div>
      <Card title="Buscar conta">
        <form
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
          noValidate
          onSubmit={(e) => void search(e)}
        >
          <div className="flex-1">
            <Input
              label="E-mail"
              type="email"
              name="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              {...(fieldError ? { error: fieldError } : {})}
            />
          </div>
          <Button type="submit" loading={searching}>
            Buscar
          </Button>
        </form>
        <div role="status" className="mt-4">
          {error && (
            <Alert tone="error" title="Não foi possível buscar">
              {error}
            </Alert>
          )}
          {result?.length === 0 && <Text>Nenhuma conta encontrada com este e-mail.</Text>}
          {result?.map((account) => (
            <div key={account.accountId} className="flex flex-wrap items-center gap-3">
              <Link to={`/contas/${account.accountId}`} className="underline underline-offset-4">
                {account.displayName}
              </Link>
              <span className="break-all">{account.email}</span>
              <Badge tone={STATUS[account.status].tone}>{STATUS[account.status].label}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Heading level={2}>Pedidos de recuperação pendentes</Heading>
      {requests.isError ? (
        <Alert tone="error" title="Não foi possível carregar os pedidos">
          <Button variant="secondary" onClick={() => void requests.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : (
        <DataTable
          caption="Pedidos de recuperação pendentes"
          columns={requestColumns}
          rows={requests.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={requests.isPending}
          emptyMessage="Nenhum pedido pendente."
        />
      )}
    </>
  );
}
