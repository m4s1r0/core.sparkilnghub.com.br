import type { FastifyInstance, FastifyRequest } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { withIdempotency } from "../../platform/http/idempotency.js";
import { pageOf, PageQueryFields } from "../../platform/http/pagination.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import {
  type Actor,
  type ContractorInput,
  createContractor,
  getContractor,
  searchContractors,
  setContractorStatus,
  similarContractors,
  updateContractor,
} from "./contractors.js";

const Text = (min: number, max: number) => Type.String({ minLength: min, maxLength: max });
const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);

const Address = Type.Object(
  {
    cep: Type.Optional(Type.String({ pattern: "^[0-9]{8}$" })),
    logradouro: Type.Optional(Type.String({ maxLength: 120 })),
    numero: Type.Optional(Type.String({ maxLength: 20 })),
    complemento: Type.Optional(Type.String({ maxLength: 60 })),
    bairro: Type.Optional(Type.String({ maxLength: 80 })),
    cidade: Type.Optional(Type.String({ maxLength: 80 })),
    uf: Type.Optional(Type.String({ pattern: "^[A-Za-z]{2}$" })),
  },
  { additionalProperties: false },
);

const contractorFields = {
  legalName: Text(2, 200),
  displayName: Text(2, 120),
  personType: Type.Union([Type.Literal("fisica"), Type.Literal("juridica")]),
  document: Type.Optional(Nullable(Type.String({ maxLength: 18 }))),
  contactName: Text(2, 120),
  email: Type.String({ format: "email", maxLength: 254 }),
  phone: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
  address: Type.Optional(Nullable(Address)),
};

const ContractorBody = Type.Object(contractorFields, { additionalProperties: false });
const UpdateBody = Type.Object(
  { ...contractorFields, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const StatusBody = Type.Object(
  { reason: Text(3, 500), version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
const Params = Type.Object({ contractorId: Type.String({ format: "uuid" }) });
const ListQuery = Type.Object(
  {
    q: Type.Optional(Type.String({ maxLength: 120 })),
    status: Type.Optional(Type.Union([Type.Literal("ativo"), Type.Literal("inativo")])),
    ...PageQueryFields,
  },
  { additionalProperties: false },
);
const SimilarQuery = Type.Object(
  {
    legalName: Type.Optional(Type.String({ maxLength: 200 })),
    document: Type.Optional(Type.String({ maxLength: 18 })),
  },
  { additionalProperties: false },
);

const actorOf = (request: FastifyRequest): Actor => ({
  accountId: authOf(request).account.id,
  correlationId: request.id,
});

/** Contratantes (US1, SC-003 a SC-006). Ações do painel; sem reautenticação (matriz §2.2). */
export function registerContractorRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  app.get(
    "/api/v1/contractors",
    { preHandler: session, schema: { querystring: ListQuery } },
    async (request) => {
      const query = request.query as {
        q?: string;
        status?: "ativo" | "inativo";
        page?: string;
        pageSize?: string;
      };
      const page = pageOf(query);
      const result = await searchContractors(ctx, query, page);
      return { items: result.items, pageInfo: { ...page, total: result.total } };
    },
  );

  app.get(
    "/api/v1/contractors/similar",
    { preHandler: session, schema: { querystring: SimilarQuery } },
    async (request) => ({
      items: await similarContractors(
        ctx,
        request.query as { legalName?: string; document?: string },
      ),
    }),
  );

  app.post(
    "/api/v1/contractors",
    { preHandler: session, schema: { body: ContractorBody } },
    async (request, reply) => {
      const actor = actorOf(request);
      return withIdempotency(
        ctx,
        request,
        reply,
        { actor: actor.accountId, operation: "criar_contratante" },
        async () => ({
          status: 201,
          body: await createContractor(ctx, request.body as ContractorInput, actor),
        }),
      );
    },
  );

  app.get(
    "/api/v1/contractors/:contractorId",
    { preHandler: session, schema: { params: Params } },
    async (request) =>
      getContractor(ctx, (request.params as { contractorId: string }).contractorId),
  );

  app.put(
    "/api/v1/contractors/:contractorId",
    { preHandler: session, schema: { params: Params, body: UpdateBody } },
    async (request) =>
      updateContractor(
        ctx,
        (request.params as { contractorId: string }).contractorId,
        request.body as ContractorInput & { version: number },
        actorOf(request),
      ),
  );

  for (const [path, to] of [
    ["inactivate", "inativo"],
    ["reactivate", "ativo"],
  ] as const) {
    app.post(
      `/api/v1/contractors/:contractorId/${path}`,
      { preHandler: session, schema: { params: Params, body: StatusBody } },
      async (request) =>
        setContractorStatus(
          ctx,
          (request.params as { contractorId: string }).contractorId,
          to,
          request.body as { reason: string; version: number },
          actorOf(request),
        ),
    );
  }
}
