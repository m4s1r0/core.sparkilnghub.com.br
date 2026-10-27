import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";
import type { InstanceSummary } from "./instances";

export type PersonType = "fisica" | "juridica";
export type ContractorStatus = "ativo" | "inativo";

export interface Address {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface ContractorInput {
  legalName: string;
  displayName: string;
  personType: PersonType;
  document: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  address: Address | null;
}

export interface Contractor extends ContractorInput {
  id: string;
  status: ContractorStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ContractorDetail extends Contractor {
  instances: InstanceSummary[];
}

export interface ContractorSummary {
  id: string;
  displayName: string;
  legalName: string;
  personType: PersonType;
  document: string | null;
  status: ContractorStatus;
  products: string[];
  instanceCount: number;
}

export interface SimilarContractor {
  id: string;
  displayName: string;
  legalName: string;
  document: string | null;
  status: ContractorStatus;
  match: "documento" | "nome";
}

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
}

export interface ContractorQuery {
  q: string;
  status: "" | ContractorStatus;
  page: number;
}

const PAGE_SIZE = 20;

export const contractorKey = (id: string) => ["contractor", id] as const;

export function useContractors(query: ContractorQuery) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(PAGE_SIZE) });
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  return useQuery({
    queryKey: ["contractors", query],
    queryFn: () =>
      requestJson<{ items: ContractorSummary[]; pageInfo: PageInfo }>(
        "GET",
        `/api/v1/contractors?${params.toString()}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useContractor(id: string) {
  return useQuery({
    queryKey: contractorKey(id),
    queryFn: () => contractorsApi.get(id),
  });
}

export const contractorsApi = {
  get: (id: string) => requestJson<ContractorDetail>("GET", `/api/v1/contractors/${id}`),
  similar: (legalName: string, document: string) => {
    const params = new URLSearchParams();
    if (legalName.trim()) params.set("legalName", legalName.trim());
    if (document.trim()) params.set("document", document.trim());
    return requestJson<{ items: SimilarContractor[] }>(
      "GET",
      `/api/v1/contractors/similar?${params.toString()}`,
    );
  },
  create: (input: ContractorInput, idempotencyKey: string) =>
    requestJson<Contractor>("POST", "/api/v1/contractors", { body: input, idempotencyKey }),
  update: (id: string, input: ContractorInput & { version: number }) =>
    requestJson<Contractor>("PUT", `/api/v1/contractors/${id}`, { body: input }),
  setStatus: (id: string, action: "inactivate" | "reactivate", reason: string, version: number) =>
    requestJson<Contractor>("POST", `/api/v1/contractors/${id}/${action}`, {
      body: { reason, version },
    }),
};

/** CPF `000.000.000-00`; CNPJ `00.000.000/0000-00` (também alfanumérico). */
export function formatDocument(document: string | null): string {
  if (!document) return "—";
  if (document.length === 11) {
    return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
  }
  return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
}
