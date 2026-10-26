import type {
  ComponentName,
  ComponentStatus,
  HealthState,
  StatusReason,
  SystemStatus,
} from "@sparkcore/contracts";
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Heading,
  Skeleton,
  StatsBlock,
  type TableColumn,
  Text,
} from "@sparkling-hub/design-system";
import { ApiError } from "../../api/client";
import { useSystemStatus } from "../../api/system-status";

const STATE_LABEL: Record<HealthState, string> = {
  SAUDAVEL: "Saudável",
  DEGRADADA: "Degradada",
  INDISPONIVEL: "Indisponível",
  DESCONHECIDA: "Desconhecida",
};

const STATE_TONE: Record<HealthState, "success" | "warning" | "error" | "neutral"> = {
  SAUDAVEL: "success",
  DEGRADADA: "warning",
  INDISPONIVEL: "error",
  DESCONHECIDA: "neutral",
};

const COMPONENT_LABEL: Record<ComponentName, string> = {
  server: "Servidor",
  worker: "Trabalhador de tarefas",
  spark_core: "Banco spark_core",
  spark_identity: "Banco spark_identity",
};

const REASON_LABEL: Record<StatusReason, string> = {
  DB_UNREACHABLE: "Banco inacessível",
  SCHEMA_BEHIND: "Migrações pendentes",
  SCHEMA_FAILED: "Migração com falha",
  SCHEMA_CHECKSUM_MISMATCH: "Migração alterada após aplicada",
  SCHEMA_UNKNOWN_VERSION: "Versão de schema desconhecida",
  WORKER_STALE: "Sem sinal de vida recente",
  WORKER_ABSENT: "Nenhum trabalhador ativo",
};

const ENVIRONMENT_LABEL: Record<SystemStatus["environment"], string> = {
  development: "desenvolvimento",
  homologation: "homologação",
  production: "produção",
};

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const formatTime = (iso: string | undefined) => (iso ? timeFormat.format(new Date(iso)) : "—");

const columns: TableColumn<ComponentStatus>[] = [
  { id: "name", header: "Componente", rowHeader: true, cell: (row) => COMPONENT_LABEL[row.name] },
  {
    id: "status",
    header: "Estado",
    cell: (row) => <Badge tone={STATE_TONE[row.status]}>{STATE_LABEL[row.status]}</Badge>,
  },
  {
    id: "schema",
    header: "Schema (atual / esperado)",
    cell: (row) =>
      row.expectedSchemaVersion === undefined
        ? "—"
        : `${row.schemaVersion ?? "—"} / ${row.expectedSchemaVersion ?? "—"}`,
  },
  { id: "reason", header: "Motivo", cell: (row) => (row.reason ? REASON_LABEL[row.reason] : "—") },
  { id: "checkedAt", header: "Verificado às", cell: (row) => formatTime(row.checkedAt) },
];

function Brand() {
  return (
    <span className="flex items-center gap-3">
      <picture>
        {/* Assinatura completa só a partir de 240 px de largura (DESIGN.md); abaixo, o monograma. */}
        <source media="(min-width: 640px)" srcSet="/brand/sparkling-hub-principal.svg" />
        <img
          src="/brand/monograma-principal.svg"
          alt="Sparkling Hub"
          className="h-10 w-auto sm:h-12"
        />
      </picture>
      <span className="font-semibold">SparkCore</span>
    </span>
  );
}

function Summary({ status }: { status: SystemStatus }) {
  // StatsBlock recebe só contagens: valores textuais longos não cabem nas colunas em 360 px.
  const count = (states: HealthState[]) =>
    String(status.components.filter((c) => states.includes(c.status)).length);
  return (
    <div className="flex flex-col gap-3">
      <Text as="div" className="flex flex-wrap items-center gap-2">
        Estado geral: <Badge tone={STATE_TONE[status.status]}>{STATE_LABEL[status.status]}</Badge>
      </Text>
      <StatsBlock
        label="Componentes por estado"
        items={[
          { label: "Saudáveis", value: count(["SAUDAVEL"]) },
          { label: "Degradados", value: count(["DEGRADADA"]) },
          {
            label: "Indisponíveis ou desconhecidos",
            value: count(["INDISPONIVEL", "DESCONHECIDA"]),
          },
        ]}
      />
    </div>
  );
}

/** Página base de F00 (contracts/ui-base-page.md). */
export function SystemStatusPage() {
  const query = useSystemStatus();
  const result = query.data;
  const loading = query.isPending;
  const refreshing = query.isFetching && !loading && !query.isError;
  const error = query.isError ? query.error : null;
  const apiError = error instanceof ApiError ? error : null;
  const correlationId = apiError?.correlationId ?? result?.correlationId ?? null;

  return (
    <>
      {/* Cabeçalho com layout Tailwind: o Navbar 0.2.0 exibe o botão "Menu" mesmo sem itens
          (lacuna registrada em docs/design-system-updates.md). */}
      <header className="border-b border-[var(--color-sh-line)] bg-[var(--color-sh-surface)]">
        <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-3 sm:px-6">
          <Brand />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <Heading level={1}>Situação do sistema</Heading>
            <Text tone="muted">
              {result
                ? `SparkCore ${result.body.version} · ambiente de ${ENVIRONMENT_LABEL[result.body.environment]}`
                : "SparkCore"}
            </Text>
          </div>
          <Button
            variant="secondary"
            loading={query.isFetching && !loading}
            onClick={() => void query.refetch()}
          >
            Atualizar situação
          </Button>
        </div>

        <section
          data-testid="status-region"
          aria-label="Situação dos componentes"
          aria-busy={loading || refreshing}
          className="flex flex-col gap-6"
        >
          {loading && (
            <>
              <Text>Consultando situação…</Text>
              <Skeleton label="Carregando resumo" lines={2} />
              <Skeleton label="Carregando componentes" lines={4} />
            </>
          )}

          {error && (
            <Alert tone="error" title="Não foi possível obter a situação do sistema">
              <div className="flex flex-col items-start gap-3">
                <span>{apiError?.message ?? "Ocorreu uma falha inesperada."}</span>
                {correlationId && <span>Correlação: {correlationId}</span>}
                <Button variant="secondary" onClick={() => void query.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            </Alert>
          )}

          {!error && result && (
            <>
              {result.status === 503 ? (
                <Alert tone="warning" title="Um ou mais componentes estão indisponíveis">
                  Os componentes marcados como indisponíveis impedem a operação normal.
                </Alert>
              ) : (
                <div role="status">
                  <Text tone="muted">
                    {refreshing
                      ? "Atualizando…"
                      : `Situação atualizada às ${formatTime(result.body.checkedAt)}`}
                  </Text>
                </div>
              )}
              {result.status === 503 && refreshing && <Text tone="muted">Atualizando…</Text>}
              <Summary status={result.body} />
              <DataTable
                caption="Componentes do SparkCore"
                columns={columns}
                rows={result.body.components}
                rowKey={(row) => row.name}
              />
            </>
          )}
        </section>

        {!loading && correlationId && (
          <footer>
            <Text tone="muted" as="p">
              Correlação da última consulta: <code>{correlationId}</code>
            </Text>
          </footer>
        )}
      </main>
    </>
  );
}
