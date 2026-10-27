import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type PendingSync, usePendingSync } from "../../api/accounts";
import { ApiError } from "../../api/client";

const KIND: Record<string, string> = {
  revogar_sessoes_conta: "Revogar sessões da conta",
  revogar_vinculo: "Revogar vínculo",
  replicar_vinculo: "Replicar vínculo",
  revisao_instancia: "Revisão da instância",
  reconciliar: "Reconciliar projeção",
};

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

const columns: TableColumn<PendingSync>[] = [
  { id: "instance", header: "Instância", rowHeader: true, cell: (row) => row.instanceName },
  { id: "kind", header: "Operação", cell: (row) => KIND[row.kind] ?? row.kind },
  {
    id: "status",
    header: "Estado",
    cell: (row) => (
      <Badge tone={row.status === "falhou" ? "error" : "warning"}>
        {row.status === "falhou"
          ? "Falhou"
          : row.status === "em_execucao"
            ? "Em execução"
            : "Pendente"}
      </Badge>
    ),
  },
  { id: "attempts", header: "Tentativas", align: "end", cell: (row) => String(row.attempts) },
  {
    id: "next",
    header: "Próxima tentativa",
    cell: (row) => dateTime.format(new Date(row.nextAttemptAt)),
  },
  { id: "error", header: "Último erro", cell: (row) => row.lastError ?? "—" },
];

/**
 * `/pendencias` — revogações e réplicas ainda não gravadas em instâncias inacessíveis (FR-027).
 * O trabalhador repete automaticamente; nada aqui é dado como concluído antes de gravado.
 */
export function PendingPage() {
  const pending = usePendingSync();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Pendências de sincronização</Heading>
        <Text tone="muted">
          Operações registradas no Core que ainda não chegaram ao banco de acesso de uma instância.
          O trabalhador tenta de novo automaticamente.
        </Text>
      </div>
      {pending.isError ? (
        <Alert tone="error" title="Não foi possível carregar as pendências">
          <div className="flex flex-col items-start gap-3">
            <span>
              {pending.error instanceof ApiError
                ? pending.error.message
                : "Ocorreu uma falha inesperada."}
            </span>
            <Button variant="secondary" onClick={() => void pending.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        <DataTable
          caption="Pendências por instância"
          columns={columns}
          rows={pending.data?.items ?? []}
          rowKey={(row) => row.jobId}
          loading={pending.isPending}
          emptyMessage="Nenhuma pendência: todas as instâncias estão em dia."
        />
      )}
    </>
  );
}
