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
import { useNavigate, useSearchParams, Link } from "react-router";
import { ApiError } from "../../api/client";
import { useContractors } from "../../api/contractors";
import {
  type InstanceFilters,
  type InstanceState,
  type InstanceSummary,
  STATE_LABEL,
  useInstanceList,
} from "../../api/instances";
import { useProducts } from "../../api/products";

const columns: TableColumn<InstanceSummary>[] = [
  {
    id: "name",
    header: "Instância",
    rowHeader: true,
    cell: (row) => (
      <Link to={`/instancias/${row.id}`} className="underline underline-offset-4">
        {row.displayName}
      </Link>
    ),
  },
  { id: "contractor", header: "Contratante", cell: (row) => row.contractorName },
  { id: "product", header: "Produto", cell: (row) => row.productCode },
  {
    id: "state",
    header: "Estado",
    cell: (row) => (
      <span className="flex flex-wrap gap-1">
        <Badge tone={STATE_LABEL[row.state].tone}>{STATE_LABEL[row.state].label}</Badge>
        {row.validityExpired && <Badge tone="warning">Vigência vencida</Badge>}
      </span>
    ),
  },
  {
    id: "task",
    header: "Último protocolo",
    cell: (row) =>
      row.lastTask ? (
        <Link to={`/instancias/${row.id}/provisionamento`} className="underline underline-offset-4">
          {row.lastTask.protocol}
        </Link>
      ) : (
        "—"
      ),
  },
];

const STATES = Object.entries(STATE_LABEL).map(([value, { label }]) => ({ value, label }));
const FILTER_KEYS = ["contractorId", "productCode", "state", "createdFrom", "createdTo"] as const;

/** `/instancias` — lista filtrada e paginada (US6, SC-018). Filtros na URL não são autoridade. */
export function InstancesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters: InstanceFilters = {
    contractorId: params.get("contractorId") ?? "",
    productCode: params.get("productCode") ?? "",
    state: (params.get("state") ?? "") as "" | InstanceState,
    createdFrom: params.get("createdFrom") ?? "",
    createdTo: params.get("createdTo") ?? "",
    page: Number(params.get("page") ?? "1") || 1,
  };
  const instances = useInstanceList(filters);
  const contractors = useContractors({ q: "", status: "", page: 1 });
  const products = useProducts();

  const update = (next: Partial<InstanceFilters>) => {
    const merged = { ...filters, page: 1, ...next };
    const search = new URLSearchParams();
    for (const key of FILTER_KEYS) if (merged[key]) search.set(key, merged[key]);
    if (merged.page > 1) search.set("page", String(merged.page));
    setParams(search);
  };

  const total = instances.data?.pageInfo.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / (instances.data?.pageInfo.pageSize ?? 20)));
  const noFilters = FILTER_KEYS.every((key) => !filters[key]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Heading level={1}>Instâncias</Heading>
          <Text tone="muted">
            Instâncias de produtos por contratante, com estado e provisionamento.
          </Text>
        </div>
        <Button onClick={() => void navigate("/instancias/nova")}>Nova instância</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
        <Select
          label="Contratante"
          name="contractorId"
          placeholder="Todos"
          options={[
            { value: "", label: "Todos" },
            ...(contractors.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
          ]}
          value={filters.contractorId}
          onChange={(e) => update({ contractorId: e.target.value })}
        />
        <Select
          label="Produto"
          name="productCode"
          options={[
            { value: "", label: "Todos" },
            ...(products.data?.items ?? []).map((p) => ({ value: p.code, label: p.name })),
          ]}
          value={filters.productCode}
          onChange={(e) => update({ productCode: e.target.value })}
        />
        <Select
          label="Estado"
          name="state"
          options={[{ value: "", label: "Todos" }, ...STATES]}
          value={filters.state}
          onChange={(e) => update({ state: e.target.value as "" | InstanceState })}
        />
        <Input
          label="Criadas desde"
          type="date"
          name="createdFrom"
          value={filters.createdFrom}
          onChange={(e) => update({ createdFrom: e.target.value })}
        />
        <Input
          label="Criadas até"
          type="date"
          name="createdTo"
          value={filters.createdTo}
          onChange={(e) => update({ createdTo: e.target.value })}
        />
      </div>

      {instances.isError ? (
        <Alert tone="error" title="Não foi possível carregar as instâncias">
          <p>
            {instances.error instanceof ApiError
              ? instances.error.message
              : "Ocorreu uma falha inesperada."}
          </p>
          <Button variant="secondary" onClick={() => void instances.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : instances.isSuccess && total === 0 && noFilters ? (
        <EmptyState
          title="Nenhuma instância ainda"
          description="Solicite a primeira instância para um contratante."
          action={<Button onClick={() => void navigate("/instancias/nova")}>Nova instância</Button>}
        />
      ) : (
        <>
          <DataTable
            caption="Instâncias"
            columns={columns}
            rows={instances.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={instances.isPending}
            emptyMessage="Nenhuma instância com esses filtros."
          />
          <Pagination
            label="Páginas de instâncias"
            page={filters.page}
            pageCount={pageCount}
            onPageChange={(page) => update({ page })}
            disabled={instances.isFetching}
          />
        </>
      )}
    </>
  );
}
