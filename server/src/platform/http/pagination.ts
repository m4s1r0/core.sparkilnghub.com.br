import Type from "typebox";

/**
 * Paginação de listas do painel (`page`, `pageSize`). O Ajv do servidor não converte tipos
 * (build-app), então a query chega como texto: validada por padrão e convertida aqui.
 */
export const PageQueryFields = {
  page: Type.Optional(Type.String({ pattern: "^[1-9][0-9]{0,5}$" })),
  pageSize: Type.Optional(Type.String({ pattern: "^(?:[1-9][0-9]?|100)$" })),
};

export interface Page {
  page: number;
  pageSize: number;
}

export function pageOf(query: { page?: string; pageSize?: string }, defaultSize = 25): Page {
  return {
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Number(query.pageSize) : defaultSize,
  };
}
