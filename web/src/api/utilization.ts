import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

export interface UsageByKind {
  kind: string;
  count: number;
  last_occurred_at: string;
}

export interface UsageByPeriod {
  instance_id: string;
  period_start: string;
  period_end: string;
  timezone: string;
  events: UsageByKind[];
  data_status: "ok" | "dados_insuficientes" | "atraso_detectado";
}

export interface ConsolidatedUsage {
  period_start: string;
  period_end: string;
  timezone: string;
  instances: UsageByPeriod[];
  generated_at: string;
}

function buildPeriodQuery(
  from: string,
  to: string,
  timezone?: string,
  instanceId?: string,
): string {
  const p = new URLSearchParams({ from, to });
  if (timezone) p.set("timezone", timezone);
  if (instanceId) p.set("instance_id", instanceId);
  return `?${p.toString()}`;
}

export function useInstanceUsage(
  instanceId: string,
  from: string,
  to: string,
  timezone = "America/Sao_Paulo",
) {
  return useQuery<UsageByPeriod>({
    queryKey: ["instance-usage", instanceId, from, to, timezone],
    queryFn: () =>
      requestJson<UsageByPeriod>(
        "GET",
        `/api/v1/instances/${instanceId}/usage${buildPeriodQuery(from, to, timezone)}`,
      ),
    enabled: Boolean(instanceId && from && to),
  });
}

export function useConsolidatedUsage(
  from: string,
  to: string,
  timezone = "America/Sao_Paulo",
  instanceId?: string,
) {
  return useQuery<ConsolidatedUsage>({
    queryKey: ["consolidated-usage", from, to, timezone, instanceId],
    queryFn: () =>
      requestJson<ConsolidatedUsage>(
        "GET",
        `/api/v1/usage${buildPeriodQuery(from, to, timezone, instanceId)}`,
      ),
    enabled: Boolean(from && to),
  });
}

export function exportUsageCsv(
  from: string,
  to: string,
  timezone = "America/Sao_Paulo",
  instanceId?: string,
): void {
  const url = `/api/v1/usage${buildPeriodQuery(from, to, timezone, instanceId)}`;
  void fetch(url, { headers: { accept: "text/csv" }, credentials: "same-origin" }).then(
    async (res) => {
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `utilizacao-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  );
}
