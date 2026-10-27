import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  type TableColumn,
  Text,
  Tooltip,
} from "@sparkling-hub/design-system";
import { Link } from "react-router";
import { ApiError } from "../../api/client";
import { type Product, REASON_TEXT, useProducts } from "../../api/products";

const columns: TableColumn<Product>[] = [
  {
    id: "name",
    header: "Produto",
    rowHeader: true,
    cell: (row) => (
      <Link to={`/produtos/${row.code}`} className="underline underline-offset-4">
        {row.name}
      </Link>
    ),
  },
  { id: "code", header: "Código", cell: (row) => <code>{row.code}</code> },
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
    id: "version",
    header: "Versão implantada",
    cell: (row) => (row.deployedVersion === null ? "—" : `v${row.deployedVersion}`),
  },
  {
    id: "provisionable",
    header: "Provisionável",
    cell: (row) =>
      row.provisionable || !row.notProvisionableReason ? (
        <Badge tone="success">Sim</Badge>
      ) : (
        <Tooltip content={REASON_TEXT[row.notProvisionableReason]}>
          <span>
            <Badge tone="warning">Não</Badge>
            <span className="sr-only"> — {REASON_TEXT[row.notProvisionableReason]}</span>
          </span>
        </Tooltip>
      ),
  },
];

/** `/produtos` — catálogo; versões e provisionador vêm do código implantado (US2, SC-009). */
export function ProductsPage() {
  const products = useProducts();
  return (
    <>
      <div className="flex flex-col gap-1">
        <Heading level={1}>Produtos</Heading>
        <Text tone="muted">
          Um produto só é provisionável quando seu artefato de migração é publicado com o Core.
        </Text>
      </div>
      {products.isError ? (
        <Alert tone="error" title="Não foi possível carregar o catálogo">
          <p>
            {products.error instanceof ApiError
              ? products.error.message
              : "Ocorreu uma falha inesperada."}
          </p>
          <Button variant="secondary" onClick={() => void products.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      ) : (
        <DataTable
          caption="Catálogo de produtos"
          columns={columns}
          rows={products.data?.items ?? []}
          rowKey={(row) => row.code}
          loading={products.isPending}
          emptyMessage="Nenhum produto no catálogo."
        />
      )}
    </>
  );
}
