import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { type InstanceItem, useInstances } from "../../api/members";

const columns: TableColumn<InstanceItem>[] = [
  {
    id: "name",
    header: "Instância",
    rowHeader: true,
    cell: (row) => (
      <Link to={`/instancias/${row.id}/vinculos`} className="underline underline-offset-4">
        {row.displayName}
      </Link>
    ),
  },
  { id: "product", header: "Produto", cell: (row) => row.productCode },
  { id: "slug", header: "Identificador", cell: (row) => <code>{row.slug}</code> },
  {
    id: "kind",
    header: "Tipo",
    cell: (row) =>
      row.synthetic ? <Badge tone="warning">Sintética</Badge> : <Badge tone="neutral">Real</Badge>,
  },
];

/** `/instancias` — referências de instância (F01 mínimo; cadastro completo em F02). */
export function InstancesPage() {
  const instances = useInstances();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Instâncias</Heading>
        <Text tone="muted">Escolha uma instância para gerenciar vínculos e convites.</Text>
      </div>
      {instances.isError ? (
        <Alert tone="error" title="Não foi possível carregar as instâncias">
          <div className="flex flex-col items-start gap-3">
            <span>
              {instances.error instanceof ApiError
                ? instances.error.message
                : "Ocorreu uma falha inesperada."}
            </span>
            <Button variant="secondary" onClick={() => void instances.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Alert>
      ) : (
        <DataTable
          caption="Instâncias"
          columns={columns}
          rows={instances.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={instances.isPending}
          emptyMessage="Nenhuma instância cadastrada."
        />
      )}
    </>
  );
}
