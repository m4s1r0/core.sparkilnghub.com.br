import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

export interface DashboardStats {
  instances_by_state: Record<string, number>;
  pending_provisionings: number;
  failed_provisionings: number;
  instances_without_recent_usage: { last7d: number; last30d: number };
  instances_without_any_data: number;
  instances_with_telemetry_delay: number;
  instances_with_schema_issue: number;
  cleanup_last_run: string | null;
  cleanup_last_count: number | null;
  calculated_at: string;
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: () => requestJson<DashboardStats>("GET", "/api/v1/dashboard/stats"),
    refetchInterval: 60_000,
  });
}
