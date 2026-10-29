import { Alert, Heading, Skeleton, StatsBlock, Text } from "@sparkling-hub/design-system";
import { ApiError } from "../../api/client";
import { type DashboardStats, useDashboardStats } from "../../api/dashboard";
import { SystemStatusPage } from "../system-status/SystemStatusPage";

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "medium",
});

function UsageStats({ stats }: { stats: DashboardStats }) {
  return (
    <div className="flex flex-col gap-4">
      <StatsBlock
        label="Provisionamento"
        items={[
          { label: "Pendentes", value: String(stats.pending_provisionings) },
          { label: "Com falha", value: String(stats.failed_provisionings) },
        ]}
      />
      <StatsBlock
        label="Utilização"
        items={[
          { label: "Sem dados (7d)", value: String(stats.instances_without_recent_usage.last7d) },
          { label: "Sem dados (30d)", value: String(stats.instances_without_recent_usage.last30d) },
          { label: "Sem histórico", value: String(stats.instances_without_any_data) },
        ]}
      />
      <StatsBlock
        label="Telemetria"
        items={[
          { label: "Com atraso", value: String(stats.instances_with_telemetry_delay) },
          { label: "Schema desatualizado", value: String(stats.instances_with_schema_issue) },
        ]}
      />
      {stats.cleanup_last_run && (
        <StatsBlock
          label="Limpeza de privacidade"
          items={[
            {
              label: "Última execução",
              value: dateTimeFmt.format(new Date(stats.cleanup_last_run)),
            },
            {
              label: "Registros limpos",
              value: String(stats.cleanup_last_count ?? 0),
            },
          ]}
        />
      )}
      <Text tone="muted" as="p">
        Calculado em: {dateTimeFmt.format(new Date(stats.calculated_at))}
      </Text>
    </div>
  );
}

/** Painel principal expandido — situação do sistema + métricas de utilização (F08-Core US2). */
export function DashboardPage() {
  const statsQuery = useDashboardStats();

  return (
    <>
      {/* Seção de situação do sistema existente (F00/F01) */}
      <SystemStatusPage />

      {/* Nova seção de métricas de utilização e telemetria */}
      <section aria-label="Métricas de utilização e telemetria" className="flex flex-col gap-4">
        <Heading level={2}>Métricas operacionais</Heading>

        {statsQuery.isPending && <Skeleton label="Carregando painel" lines={4} />}

        {statsQuery.isError && (
          <Alert tone="error" title="Falha ao carregar métricas">
            {statsQuery.error instanceof ApiError
              ? statsQuery.error.message
              : "Ocorreu uma falha inesperada."}
          </Alert>
        )}

        {statsQuery.data && <UsageStats stats={statsQuery.data} />}
      </section>
    </>
  );
}
