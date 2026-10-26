import type { SystemStatus } from "@sparkcore/contracts";
import { useQuery } from "@tanstack/react-query";
import { type ApiResponse, getJson } from "./client";

export const SYSTEM_STATUS_URL = "/api/v1/system/status";

/** Situação operacional; 503 traz o mesmo corpo (contracts/openapi.yaml). */
export function useSystemStatus() {
  return useQuery<ApiResponse<SystemStatus>>({
    queryKey: ["system-status"],
    queryFn: () => getJson<SystemStatus>(SYSTEM_STATUS_URL, [200, 503]),
    retry: false,
    refetchOnWindowFocus: false,
  });
}
