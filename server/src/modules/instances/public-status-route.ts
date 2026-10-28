import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../platform/context.js";
import { findInstanceBySlugOnly } from "./instances.js";

const page = (title: string, message: string) => `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 12vh auto; padding: 0 24px; text-align: center; color: #1a1a1a;">
  <h1 style="font-size: 1.25rem; margin-bottom: 0.75rem;">${title}</h1>
  <p style="color: #4a4a4a; line-height: 1.5;">${message}</p>
</body>
</html>
`;

const UNAVAILABLE = page(
  "Serviço temporariamente indisponível",
  "Esta instância está temporariamente indisponível. Entre em contato com o suporte para mais informações.",
);
const NOT_FOUND = page("Página não encontrada", "Não foi possível encontrar o que você procura.");

/**
 * Página pública mínima de indisponibilidade (F03, SC-027, FR-007): sem sessão, sem exibir
 * motivo financeiro ou detalhe interno. Mesma resposta 404 para instância inexistente ou em
 * qualquer outro estado, para não confirmar nem negar a existência de um slug (evita enumeração).
 */
export function registerPublicInstanceStatusRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/i/:slug", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const instance = await findInstanceBySlugOnly(ctx, slug);
    const unavailable = instance?.state === "SUSPENSA" || instance?.state === "MANUTENCAO";
    return reply
      .status(unavailable ? 200 : 404)
      .type("text/html; charset=utf-8")
      .send(unavailable ? UNAVAILABLE : NOT_FOUND);
  });
}
