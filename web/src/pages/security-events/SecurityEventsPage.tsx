import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  Input,
  Pagination,
  Select,
  Skeleton,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client";
import {
  exportSecurityEventsCsv,
  type SecurityEventItem,
  type SecurityEventsFilters,
  useSecurityEvents,
} from "../../api/security-events";

const RESULT_TONE: Record<string, "success" | "error" | "warning" | "neutral"> = {
  sucesso: "success",
  falha: "error",
  negado: "warning",
};

const RESULT_LABEL: Record<string, string> = {
  sucesso: "Sucesso",
  falha: "Falha",
  negado: "Negado",
};

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

const PAGE_SIZE = 50;

const RESULT_OPTIONS = [
  { value: "sucesso", label: "Sucesso" },
  { value: "falha", label: "Falha" },
  { value: "negado", label: "Negado" },
];

function setFilter<T>(setter: (fn: (prev: T) => T) => void, key: keyof T, val: string | undefined) {
  setter((prev) => {
    const next = { ...prev } as Record<string, unknown>;
    if (val !== undefined) next[key as string] = val;
    else delete next[key as string];
    return next as T;
  });
}

const columns: TableColumn<SecurityEventItem>[] = [
  {
    id: "created_at",
    header: "Data/Hora",
    cell: (row) => dateTimeFmt.format(new Date(row.created_at)),
  },
  { id: "type", header: "Tipo", cell: (row) => row.type },
  { id: "actor_kind", header: "Tipo Ator", cell: (row) => row.actor_kind },
  {
    id: "instance_id",
    header: "Instância",
    cell: (row) => (row.instance_id ? row.instance_id.slice(0, 8) + "…" : "—"),
  },
  {
    id: "result",
    header: "Resultado",
    cell: (row) => (
      <Badge tone={RESULT_TONE[row.result] ?? "neutral"}>
        {RESULT_LABEL[row.result] ?? row.result}
      </Badge>
    ),
  },
];

/** Tela de eventos de segurança com filtros, paginação e exportação CSV (F08-Core US3). */
export function SecurityEventsPage() {
  const [filters, setFilters] = useState<SecurityEventsFilters>({});
  const [draft, setDraft] = useState<SecurityEventsFilters>({});
  const [page, setPage] = useState(1);

  const query = useSecurityEvents(filters, page, PAGE_SIZE);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters({ ...draft });
    setPage(1);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <Heading level={1}>Acessos e segurança</Heading>
        <Text tone="muted">Eventos de autenticação, autorização e operações de segurança.</Text>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <Select
          label="Resultado"
          value={draft.result ?? ""}
          onChange={(e) => setFilter(setDraft, "result", e.target.value || undefined)}
          options={RESULT_OPTIONS}
          placeholder="Todos"
        />
        <Input
          label="Instância (UUID)"
          value={draft.instance_id ?? ""}
          onChange={(e) => setFilter(setDraft, "instance_id", e.target.value || undefined)}
          placeholder="UUID da instância"
        />
        <Input
          label="Conta (UUID)"
          value={draft.actor_account_id ?? ""}
          onChange={(e) => setFilter(setDraft, "actor_account_id", e.target.value || undefined)}
          placeholder="UUID da conta"
        />
        <Input
          label="De"
          type="date"
          value={draft.from ?? ""}
          onChange={(e) => setFilter(setDraft, "from", e.target.value || undefined)}
        />
        <Input
          label="Até"
          type="date"
          value={draft.to ?? ""}
          onChange={(e) => setFilter(setDraft, "to", e.target.value || undefined)}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Filtrar
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => exportSecurityEventsCsv(filters)}
          >
            Exportar CSV
          </Button>
        </div>
      </form>

      {query.isPending && <Skeleton label="Carregando acessos" lines={6} />}
      {query.isError && (
        <Alert tone="error" title="Falha ao carregar eventos">
          {query.error instanceof ApiError ? query.error.message : "Ocorreu uma falha inesperada."}
        </Alert>
      )}
      {query.data && (
        <>
          <Text tone="muted" as="p">
            {query.data.total.toLocaleString("pt-BR")} evento(s) encontrado(s)
          </Text>
          <DataTable
            caption="Eventos de segurança"
            columns={columns}
            rows={query.data.items}
            rowKey={(row) => row.id}
          />
          {query.data.total > PAGE_SIZE && (
            <Pagination
              page={page}
              pageCount={Math.ceil(query.data.total / PAGE_SIZE)}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </>
  );
}
