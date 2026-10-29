import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

export interface AuditEventItem {
  id: string;
  actor_kind: string;
  actor_id: string | null;
  action: string;
  object_type: string;
  object_id: string;
  changes: Record<string, unknown> | null;
  reason: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface AuditEventsFilters {
  object_type?: string;
  object_id?: string;
  actor_id?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditEventsPage {
  items: AuditEventItem[];
  total: number;
  page: number;
  page_size: number;
}

function buildQuery(filters: AuditEventsFilters, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  if (filters.object_type) p.set("object_type", filters.object_type);
  if (filters.object_id) p.set("object_id", filters.object_id);
  if (filters.actor_id) p.set("actor_id", filters.actor_id);
  if (filters.action) p.set("action", filters.action);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  p.set("page", String(page));
  p.set("pageSize", String(pageSize));
  return p.toString() ? `?${p.toString()}` : "";
}

export function useAuditEvents(filters: AuditEventsFilters, page: number, pageSize: number) {
  return useQuery<AuditEventsPage>({
    queryKey: ["audit-events", filters, page, pageSize],
    queryFn: () =>
      requestJson<AuditEventsPage>(
        "GET",
        `/api/v1/audit-events${buildQuery(filters, page, pageSize)}`,
      ),
  });
}

export function exportAuditEventsCsv(filters: AuditEventsFilters): void {
  const p = new URLSearchParams();
  if (filters.object_type) p.set("object_type", filters.object_type);
  if (filters.object_id) p.set("object_id", filters.object_id);
  if (filters.actor_id) p.set("actor_id", filters.actor_id);
  if (filters.action) p.set("action", filters.action);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  const qs = p.toString() ? `?${p.toString()}` : "";
  const url = `/api/v1/audit-events${qs}`;

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
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
  );
}
