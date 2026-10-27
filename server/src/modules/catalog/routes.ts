import type { FastifyInstance, FastifyRequest } from "fastify";
import Type from "typebox";
import type { AppContext } from "../../platform/context.js";
import { authOf, requireSession } from "../../platform/http/session-guard.js";
import { getProduct, listProducts, setProductStatus, updateProduct } from "./catalog.js";

const Params = Type.Object({ code: Type.String({ pattern: "^[a-z][a-z0-9]{2,15}$" }) });
const UpdateBody = Type.Object(
  {
    name: Type.String({ minLength: 2, maxLength: 80 }),
    description: Type.String({ maxLength: 280 }),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
const StatusBody = Type.Object(
  {
    reason: Type.String({ minLength: 3, maxLength: 500 }),
    version: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const actorOf = (request: FastifyRequest) => ({
  accountId: authOf(request).account.id,
  correlationId: request.id,
});
const codeOf = (request: FastifyRequest) => (request.params as { code: string }).code;

/** Catálogo (US2, SC-007 a SC-009). Nenhuma rota aceita SQL, script, URL ou provisionador. */
export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  const session = requireSession(ctx);

  app.get("/api/v1/products", { preHandler: session }, async () => ({
    items: await listProducts(ctx),
  }));

  app.get(
    "/api/v1/products/:code",
    { preHandler: session, schema: { params: Params } },
    async (request) => getProduct(ctx, codeOf(request)),
  );

  app.put(
    "/api/v1/products/:code",
    { preHandler: session, schema: { params: Params, body: UpdateBody } },
    async (request) =>
      updateProduct(
        ctx,
        codeOf(request),
        request.body as { name: string; description: string; version: number },
        actorOf(request),
      ),
  );

  for (const [path, to] of [
    ["inactivate", "inativo"],
    ["reactivate", "ativo"],
  ] as const) {
    app.post(
      `/api/v1/products/:code/${path}`,
      { preHandler: session, schema: { params: Params, body: StatusBody } },
      async (request) =>
        setProductStatus(
          ctx,
          codeOf(request),
          to,
          request.body as { reason: string; version: number },
          actorOf(request),
        ),
    );
  }
}
