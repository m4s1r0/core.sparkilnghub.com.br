import type { FastifyInstance } from "fastify";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { credentialOf, requireAppCredential } from "../../platform/http/app-credential.js";
import { withIdentity } from "../../platform/http/identity-errors.js";
import { accessDatabaseName } from "../../platform/migrations/apply-artifact.js";
import { recordSecurityEvent } from "../identity/security-events.js";
import type { InstanceState } from "../instances/instances.js";
import { getResource, resourceSecret } from "../provisioning/resources.js";
import { instanceForCredential, Slug } from "./sessions.js";

/** Sem recursos prontos ainda: o produto não tem o que conectar. */
const NOT_READY: ReadonlySet<InstanceState> = new Set([
  "CADASTRADA",
  "PROVISIONANDO",
  "FALHA_PROVISIONAMENTO",
]);

const notFound = () => new AppError(404, "NOT_FOUND", "Recurso não encontrado.");

/**
 * Contrato interno de conexão (F02 research.md R-10, FR-031): a senha operacional é decifrada só
 * para esta resposta, que nunca vai a log nem a cache. Instância de outro produto responde igual
 * a inexistente; o produto pode guardar a conexão em memória (T-15).
 */
export function registerInternalConnectionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    "/internal/v1/instances/:slug/connection",
    { preHandler: requireAppCredential(ctx, "connection"), schema: { params: Slug } },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const credential = credentialOf(request);
      const instance = await withIdentity(() => instanceForCredential(ctx, credential, slug));
      if (!instance) throw notFound();
      if (NOT_READY.has(instance.state)) {
        throw new AppError(
          409,
          "INSTANCE_NOT_READY",
          "A instância ainda não terminou o provisionamento.",
          { retryable: true },
        );
      }
      const user = await getResource(ctx.core, instance.id, "usuario_mysql");
      // Instâncias anteriores a F02 (sementes de F01) não têm credencial registrada no Core.
      if (!user) throw notFound();
      const password = resourceSecret(ctx, instance.id, user);
      await recordSecurityEvent(ctx.identity, {
        type: "conexao_entregue",
        actorKind: "aplicacao",
        instanceId: instance.id,
        result: "sucesso",
        detail: { credencial: credential.id },
        correlationId: request.id,
        at: ctx.clock(),
      });
      return reply.header("cache-control", "no-store").send({
        instanceId: instance.id,
        state: instance.state,
        host: ctx.config.INSTANCE_DB_HOST ?? ctx.config.MYSQL_HOST,
        port: ctx.config.INSTANCE_DB_PORT ?? ctx.config.MYSQL_PORT,
        database: instance.databaseName,
        accessDatabase: accessDatabaseName(instance.databaseName),
        user: user.identifier,
        password,
        credentialVersion: user.secretKeyVersion ?? 1,
      });
    },
  );
}
