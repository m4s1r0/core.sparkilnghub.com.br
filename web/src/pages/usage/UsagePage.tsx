import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  Input,
  Skeleton,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { type FormEvent, useState } from "react";
import { ApiError } from "../../api/client";
import { exportUsageCsv, type UsageByPeriod, useConsolidatedUsage } from "../../api/utilization";

const STATUS_TONE: Record<string, "success" | "neutral" | "warning"> = {
  ok: "success",
  dados_insuficientes: "neutral",
  atraso_detectado: "warning",
};

const STATUS_LABEL: Record<string, string> = {
  ok: "OK",
  dados_insuficientes: "Sem dados",
  atraso_detectado: "Atraso",
};

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function kindCount(row: UsageByPeriod, kind: string): number {
  return row.events.find((e) => e.kind === kind)?.count ?? 0;
}

const columns: TableColumn<UsageByPeriod>[] = [
  {
    id: "instance_id",
    header: "Instância",
    rowHeader: true,
    cell: (row) => row.instance_id.slice(0, 8) + "…",
  },
  {
    id: "period",
    header: "Período",
    cell: (row) => `${row.period_start} → ${row.period_end}`,
  },
  {
    id: "atendimentos_iniciados",
    header: "Atend. iniciados",
    cell: (row) => kindCount(row, "atendimentos_iniciados").toLocaleString("pt-BR"),
  },
  {
    id: "atendimentos_concluidos",
    header: "Atend. concluídos",
    cell: (row) => kindCount(row, "atendimentos_concluidos").toLocaleString("pt-BR"),
  },
  {
    id: "vendas_confirmadas",
    header: "Vendas",
    cell: (row) => kindCount(row, "vendas_confirmadas").toLocaleString("pt-BR"),
  },
  {
    id: "usuarios_ativos",
    header: "Usuários ativos",
    cell: (row) => kindCount(row, "usuarios_ativos").toLocaleString("pt-BR"),
  },
  {
    id: "data_status",
    header: "Status",
    cell: (row) => (
      <Badge tone={STATUS_TONE[row.data_status] ?? "neutral"}>
        {STATUS_LABEL[row.data_status] ?? row.data_status}
      </Badge>
    ),
  },
];

/** Utilização consolidada de instâncias (F08-Core US5, SC-036, SC-040). */
export function UsagePage() {
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(defaultTo());
  const [timezone] = useState("America/Sao_Paulo");
  const [instanceId, setInstanceId] = useState("");

  const [applied, setApplied] = useState({ from, to, timezone, instanceId });
  const query = useConsolidatedUsage(
    applied.from,
    applied.to,
    applied.timezone,
    applied.instanceId || undefined,
  );

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ from, to, timezone, instanceId });
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <Heading level={1}>Utilização</Heading>
        <Text tone="muted">Métricas de utilização consolidadas por instância e período.</Text>
      </div>

      <form onSubmit={apply} className="flex flex-wrap items-end gap-3">
        <Input label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input
          label="Instância (UUID)"
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          placeholder="Filtrar por instância"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Aplicar
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              exportUsageCsv(
                applied.from,
                applied.to,
                applied.timezone,
                applied.instanceId || undefined,
              )
            }
          >
            Exportar CSV
          </Button>
        </div>
      </form>

      {query.isPending && <Skeleton label="Carregando utilização" lines={4} />}
      {query.isError && (
        <Alert tone="error" title="Falha ao carregar utilização">
          {query.error instanceof ApiError ? query.error.message : "Ocorreu uma falha inesperada."}
        </Alert>
      )}
      {query.data && (
        <>
          <Text tone="muted" as="p">
            {query.data.instances.length.toLocaleString("pt-BR")} instância(s) · Gerado em{" "}
            {new Intl.DateTimeFormat("pt-BR", {
              timeZone: "America/Sao_Paulo",
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(query.data.generated_at))}
          </Text>
          <DataTable
            caption="Utilização por instância"
            columns={columns}
            rows={query.data.instances}
            rowKey={(row) => row.instance_id}
          />
        </>
      )}
    </>
  );
}
