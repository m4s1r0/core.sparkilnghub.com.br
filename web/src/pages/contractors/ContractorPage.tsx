import {
  Alert,
  Badge,
  Button,
  DataTable,
  DescriptionList,
  DropdownButton,
  Heading,
  Skeleton,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiError } from "../../api/client";
import {
  contractorKey,
  contractorsApi,
  type ContractorDetail,
  formatDocument,
  useContractor,
} from "../../api/contractors";
import { type InstanceSummary, STATE_LABEL } from "../../api/instances";
import { ReasonDialog, type ReasonRequest } from "../../components/ReasonDialog";

const instanceColumns: TableColumn<InstanceSummary>[] = [
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
  { id: "product", header: "Produto", cell: (row) => row.productCode },
  { id: "slug", header: "Identificador", cell: (row) => <code>{row.slug}</code> },
  {
    id: "state",
    header: "Estado",
    cell: (row) => <Badge tone={STATE_LABEL[row.state].tone}>{STATE_LABEL[row.state].label}</Badge>,
  },
];

function addressText(contractor: ContractorDetail): string {
  const a = contractor.address;
  if (!a) return "—";
  return [
    [a.logradouro, a.numero].filter(Boolean).join(", "),
    a.complemento,
    a.bairro,
    [a.cidade, a.uf].filter(Boolean).join("/"),
    a.cep,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** `/contratantes/:id` — dados, instâncias e situação (US1, SC-006, CA-SC-003). */
export function ContractorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const contractor = useContractor(id);
  const [action, setAction] = useState<ReasonRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<{ id: string; name: string }[] | null>(null);

  if (contractor.isPending) return <Skeleton label="Carregando contratante" lines={6} />;
  if (contractor.isError) {
    const notFound = contractor.error instanceof ApiError && contractor.error.status === 404;
    return (
      <Alert tone="error" title={notFound ? "Contratante não encontrado" : "Falha ao carregar"}>
        {notFound ? (
          <Link to="/contratantes" className="underline underline-offset-4">
            Voltar aos contratantes
          </Link>
        ) : contractor.error instanceof ApiError ? (
          contractor.error.message
        ) : (
          "Ocorreu uma falha inesperada."
        )}
      </Alert>
    );
  }
  const c = contractor.data;
  const active = c.status === "ativo";

  const changeStatus = () => {
    setActionError(null);
    setBlocking(null);
    setAction({
      title: active ? `Inativar ${c.displayName}` : `Reativar ${c.displayName}`,
      description: active
        ? "Contratante inativo não recebe novas instâncias. As instâncias existentes não mudam."
        : "O contratante volta a poder receber novas instâncias.",
      confirmLabel: active ? `Inativar ${c.displayName}` : `Reativar ${c.displayName}`,
      danger: active,
      onConfirm: async (reason) => {
        try {
          await contractorsApi.setStatus(
            id,
            active ? "inactivate" : "reactivate",
            reason,
            c.version,
          );
          setAction(null);
          await queryClient.invalidateQueries({ queryKey: contractorKey(id) });
          await queryClient.invalidateQueries({ queryKey: ["contractors"] });
        } catch (caught) {
          if (
            caught instanceof ApiError &&
            caught.code === "CONFLICT_CONTRACTOR_HAS_ACTIVE_INSTANCES"
          ) {
            setAction(null);
            setBlocking(caught.details.map((d) => ({ id: d.code, name: d.message })));
            return;
          }
          if (caught instanceof ApiError && caught.code === "CONFLICT_VERSION") {
            await queryClient.invalidateQueries({ queryKey: contractorKey(id) });
          }
          setActionError(caught instanceof ApiError ? caught.message : "Falha inesperada.");
        }
      },
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Heading level={1}>{c.displayName}</Heading>
          <div className="flex flex-wrap items-center gap-2">
            {active ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>}
            <Text tone="muted">{c.legalName}</Text>
          </div>
        </div>
        <DropdownButton
          label="Ações"
          items={[
            {
              id: "edit",
              label: "Editar",
              onSelect: () => void navigate(`/contratantes/${id}/editar`),
            },
            {
              id: "status",
              label: active ? "Inativar" : "Reativar",
              destructive: active,
              onSelect: changeStatus,
            },
          ]}
        />
      </div>

      {blocking && (
        <Alert tone="warning" title="Inativação recusada: há instâncias ativas">
          <p>Suspenda estas instâncias antes de inativar o contratante. Nada foi alterado.</p>
          <ul className="mt-2 list-disc pl-5">
            {blocking.map((item) => (
              <li key={item.id}>
                <Link to={`/instancias/${item.id}`} className="underline underline-offset-4">
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <DescriptionList
        items={[
          {
            id: "type",
            term: "Tipo",
            description: c.personType === "juridica" ? "Pessoa jurídica" : "Pessoa física",
          },
          {
            id: "document",
            term: c.personType === "juridica" ? "CNPJ" : "CPF",
            description: formatDocument(c.document),
          },
          { id: "contact", term: "Contato", description: c.contactName },
          {
            id: "email",
            term: "E-mail",
            description: <span className="break-all">{c.email}</span>,
          },
          { id: "phone", term: "Telefone", description: c.phone ?? "—" },
          { id: "address", term: "Endereço", description: addressText(c) },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <Heading level={2}>Instâncias</Heading>
        {active && (
          <Button
            variant="secondary"
            onClick={() => void navigate(`/instancias/nova?contratante=${id}`)}
          >
            Solicitar instância
          </Button>
        )}
      </div>
      <DataTable
        caption={`Instâncias de ${c.displayName}`}
        columns={instanceColumns}
        rows={c.instances}
        rowKey={(row) => row.id}
        emptyMessage="Nenhuma instância deste contratante."
      />

      <ReasonDialog request={action} error={actionError} onClose={() => setAction(null)} />
    </>
  );
}
