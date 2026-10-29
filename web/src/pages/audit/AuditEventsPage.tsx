import {
  Alert,
  Button,
  DataTable,
  Dialog,
  Heading,
  Input,
  Pagination,
  Skeleton,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client";
import {
  type AuditEventItem,
  type AuditEventsFilters,
  exportAuditEventsCsv,
  useAuditEvents,
} from "../../api/audit-events";

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

const PAGE_SIZE = 50;

function setFilter<T>(setter: (fn: (prev: T) => T) => void, key: keyof T, val: string | undefined) {
  setter((prev) => {
    const next = { ...prev } as Record<string, unknown>;
    if (val !== undefined) next[key as string] = val;
    else delete next[key as string];
    return next as T;
  });
}

function EventDetailDialog({ event }: { event: AuditEventItem }) {
  return (
    <Dialog
      title={`Detalhe — ${event.action}`}
      description={`${event.object_type} · ${event.object_id}`}
      trigger={
        <Button variant="ghost" type="button">
          Ver
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <div>
          <Text as="span" tone="muted">
            Data/Hora:{" "}
          </Text>
          <Text as="span">{dateTimeFmt.format(new Date(event.created_at))}</Text>
        </div>
        <div>
          <Text as="span" tone="muted">
            Entidade:{" "}
          </Text>
          <Text as="span">
            {event.object_type} · {event.object_id}
          </Text>
        </div>
        <div>
          <Text as="span" tone="muted">
            Ator:{" "}
          </Text>
          <Text as="span">
            {event.actor_kind}
            {event.actor_id ? ` · ${event.actor_id}` : ""}
          </Text>
        </div>
        {event.reason && (
          <div>
            <Text as="span" tone="muted">
              Motivo:{" "}
            </Text>
            <Text as="span">{event.reason}</Text>
          </div>
        )}
        {event.changes && (
          <div>
            <Text tone="muted">Alterações:</Text>
            <pre className="mt-1 rounded bg-[var(--color-sh-surface)] p-3 text-xs overflow-auto max-h-64">
              {JSON.stringify(event.changes, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Tela de auditoria administrativa com filtros, paginação e detalhe (F08-Core US4). */
export function AuditEventsPage() {
  const [filters, setFilters] = useState<AuditEventsFilters>({});
  const [draft, setDraft] = useState<AuditEventsFilters>({});
  const [page, setPage] = useState(1);

  const query = useAuditEvents(filters, page, PAGE_SIZE);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setFilters({ ...draft });
    setPage(1);
  };

  const columns: TableColumn<AuditEventItem>[] = [
    {
      id: "created_at",
      header: "Data/Hora",
      cell: (row) => dateTimeFmt.format(new Date(row.created_at)),
    },
    { id: "action", header: "Ação", cell: (row) => row.action },
    { id: "object_type", header: "Entidade", cell: (row) => row.object_type },
    { id: "object_id", header: "ID Entidade", cell: (row) => row.object_id },
    {
      id: "actor",
      header: "Ator",
      cell: (row) => `${row.actor_kind}${row.actor_id ? ` · ${row.actor_id.slice(0, 8)}…` : ""}`,
    },
    {
      id: "detail",
      header: "",
      cell: (row) => <EventDetailDialog event={row} />,
    },
  ];

  return (
    <>
      <div className="flex flex-col gap-2">
        <Heading level={1}>Auditoria administrativa</Heading>
        <Text tone="muted">Histórico de ações realizadas por administradores e pelo sistema.</Text>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <Input
          label="Entidade"
          value={draft.object_type ?? ""}
          onChange={(e) => setFilter(setDraft, "object_type", e.target.value || undefined)}
          placeholder="instancia, contratante..."
        />
        <Input
          label="ID da entidade"
          value={draft.object_id ?? ""}
          onChange={(e) => setFilter(setDraft, "object_id", e.target.value || undefined)}
          placeholder="UUID ou código"
        />
        <Input
          label="Usuário (UUID)"
          value={draft.actor_id ?? ""}
          onChange={(e) => setFilter(setDraft, "actor_id", e.target.value || undefined)}
          placeholder="UUID do ator"
        />
        <Input
          label="Ação"
          value={draft.action ?? ""}
          onChange={(e) => setFilter(setDraft, "action", e.target.value || undefined)}
          placeholder="instancia.editada..."
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
          <Button type="button" variant="secondary" onClick={() => exportAuditEventsCsv(filters)}>
            Exportar CSV
          </Button>
        </div>
      </form>

      {query.isPending && <Skeleton label="Carregando auditoria" lines={6} />}
      {query.isError && (
        <Alert tone="error" title="Falha ao carregar auditoria">
          {query.error instanceof ApiError ? query.error.message : "Ocorreu uma falha inesperada."}
        </Alert>
      )}
      {query.data && (
        <>
          <Text tone="muted" as="p">
            {query.data.total.toLocaleString("pt-BR")} registro(s) encontrado(s)
          </Text>
          <DataTable
            caption="Eventos de auditoria"
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
