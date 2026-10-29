import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

export interface SecurityEventItem {
  id: string;
  type: string;
  actor_kind: string;
  actor_account_id: string | null;
  target_account_id: string | null;
  instance_id: string | null;
  result: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SecurityEventsFilters {
  instance_id?: string;
  actor_account_id?: string;
  type?: string;
  result?: string;
  from?: string;
  to?: string;
}

export interface SecurityEventsPage {
  items: SecurityEventItem[];
  total: number;
  page: number;
  page_size: number;
}

function buildQuery(filters: SecurityEventsFilters, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  if (filters.instance_id) p.set("instance_id", filters.instance_id);
  if (filters.actor_account_id) p.set("actor_account_id", filters.actor_account_id);
  if (filters.type) p.set("type", filters.type);
  if (filters.result) p.set("result", filters.result);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p.toString() ? `?${p.toString()}` : "";
}

export function useSecurityEvents(filters: SecurityEventsFilters, page: number, pageSize: number) {
  return useQuery<SecurityEventsPage>({
    queryKey: ["security-events", filters, page, pageSize],
    queryFn: () =>
      requestJson<SecurityEventsPage>(
        "GET",
        `/api/v1/security-events${buildQuery(filters, page, pageSize)}`,
      ),
  });
}

/** Dispara download CSV via <a> invisível com Accept: text/csv. */
export function exportSecurityEventsCsv(filters: SecurityEventsFilters): void {
  const p = new URLSearchParams();
  if (filters.instance_id) p.set("instance_id", filters.instance_id);
  if (filters.actor_account_id) p.set("actor_account_id", filters.actor_account_id);
  if (filters.type) p.set("type", filters.type);
  if (filters.result) p.set("result", filters.result);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const url = `/api/v1/security-events${qs}`;

  void fetch(url, { headers: { accept: "text/csv" }, credentials: "same-origin" }).then(
    async (res) => {
      const truncated = res.headers.get("X-Truncated") === "true";
      if (truncated) {
        alert(
          "Exportação limitada a 10.000 linhas. Refine os filtros para exportar um período menor.",
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `acessos-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  );
}
