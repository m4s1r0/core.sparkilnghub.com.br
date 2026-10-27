import { useQuery } from "@tanstack/react-query";
import { requestJson } from "./client";

export type NotProvisionableReason =
  "SEM_PROVISIONADOR" | "ARTEFATO_INVALIDO" | "PRODUTO_INATIVO" | "AMBIENTE_NAO_PERMITIDO";

export interface Product {
  code: string;
  name: string;
  description: string;
  status: "ativo" | "inativo";
  provisioner: string | null;
  deployedVersion: number | null;
  supportedSchemaVersion: number | null;
  provisionable: boolean;
  notProvisionableReason: NotProvisionableReason | null;
  version: number;
}

export const REASON_TEXT: Record<NotProvisionableReason, string> = {
  SEM_PROVISIONADOR: "O produto ainda não publicou seu artefato de migração.",
  ARTEFATO_INVALIDO: "O artefato implantado não passou na verificação.",
  PRODUTO_INATIVO: "Produto inativo para novas contratações.",
  AMBIENTE_NAO_PERMITIDO: "Produto não disponível neste ambiente.",
};

export const PRODUCTS_KEY = ["products"] as const;
export const productKey = (code: string) => ["product", code] as const;

export function useProducts() {
  return useQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: () => requestJson<{ items: Product[] }>("GET", "/api/v1/products"),
  });
}

export function useProduct(code: string) {
  return useQuery({
    queryKey: productKey(code),
    queryFn: () => requestJson<Product>("GET", `/api/v1/products/${code}`),
  });
}

export const productsApi = {
  update: (code: string, input: { name: string; description: string; version: number }) =>
    requestJson<Product>("PUT", `/api/v1/products/${code}`, { body: input }),
  setStatus: (code: string, action: "inactivate" | "reactivate", reason: string, version: number) =>
    requestJson<Product>("POST", `/api/v1/products/${code}/${action}`, {
      body: { reason, version },
    }),
};
