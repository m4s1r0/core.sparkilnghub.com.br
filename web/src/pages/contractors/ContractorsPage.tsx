import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Heading,
  Input,
  Pagination,
  Select,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  type ContractorQuery,
  type ContractorSummary,
  formatDocument,
  useContractors,
} from "../../api/contractors";

const columns: TableColumn<ContractorSummary>[] = [
  {
    id: "name",
    header: "Contratante",
    rowHeader: true,
    cell: (row) => (
      <Link to={`/contratantes/${row.id}`} className="underline underline-offset-4">
        {row.displayName}
      </Link>
    ),
  },
  { id: "document", header: "Documento", cell: (row) => formatDocument(row.document) },
  {
    id: "status",
    header: "Situação",
    cell: (row) =>
      row.status === "ativo" ? (
        <Badge tone="success">Ativo</Badge>
      ) : (
        <Badge tone="neutral">Inativo</Badge>
      ),
  },
  {
    id: "products",
    header: "Produtos",
    cell: (row) => (row.products.length > 0 ? row.products.join(", ") : "—"),
  },
  { id: "instances", header: "Instâncias", align: "end", cell: (row) => row.instanceCount },
];

const STATUS_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "ativo", label: "Ativos" },
  { value: "inativo", label: "Inativos" },
];

/** `/contratantes` — busca por nome, documento ou contato (US1, SC-005). */
export function ContractorsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query: ContractorQuery = {
    q: params.get("q") ?? "",
    status: (params.get("status") ?? "") as ContractorQuery["status"],
    page: Number(params.get("page") ?? "1") || 1,
  };
  const [term, setTerm] = useState(query.q);
  const contractors = useContractors(query);

  const update = (next: Partial<ContractorQuery>) => {
    const merged = { ...query, page: 1, ...next };
    const search = new URLSearchParams();
    if (merged.q) search.set("q", merged.q);
    if (merged.status) search.set("status", merged.status);
    if (merged.page > 1) search.set("page", String(merged.page));
    setParams(search);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: term.trim() });
  };

  const total = contractors.data?.pageInfo.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (contractors.data?.pageInfo.pageSize ?? 20)));
  const empty = contractors.isSuccess && total === 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Contratantes</Heading>
          <Text tone="muted">Clientes que contratam os produtos da Sparkling Hub.</Text>
        </div>
        <Button onClick={() => void navigate("/contratantes/novo")}>Novo contratante</Button>
      </div>

      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        role="search"
        noValidate
        onSubmit={submit}
      >
        <div className="flex-1">
          <Input
            label="Buscar por nome, documento ou contato"
            type="search"
            name="q"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        <Select
          label="Situação"
          name="status"
          options={STATUS_OPTIONS}
          value={query.status}
          onChange={(e) => update({ status: e.target.value as ContractorQuery["status"] })}
        />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {contractors.isError ? (
        <Alert tone="error" title="Não foi possível carregar os contratantes">
          <p>
            {contractors.error instanceof ApiError
              ? contractors.error.message
              : "Ocorreu uma falha inesperada."}
          </p>
          <Button variant="secondary" onClick={() => void contractors.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : empty && !query.q && !query.status ? (
        <EmptyState
          title="Nenhum contratante cadastrado"
          description="Cadastre o primeiro contratante para solicitar uma instância."
          action={
            <Button onClick={() => void navigate("/contratantes/novo")}>Novo contratante</Button>
          }
        />
      ) : (
        <>
          <DataTable
            caption="Contratantes"
            columns={columns}
            rows={contractors.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={contractors.isPending}
            emptyMessage="Nenhum contratante encontrado com esses filtros."
          />
          <Pagination
            label="Páginas de contratantes"
            page={query.page}
            pageCount={pageCount}
            onPageChange={(page) => update({ page })}
            disabled={contractors.isFetching}
          />
        </>
      )}
    </>
  );
}
