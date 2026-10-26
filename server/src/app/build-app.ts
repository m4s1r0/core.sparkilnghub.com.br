import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Logger } from "pino";
import type { Config } from "../platform/config/load.js";
import { createLogger } from "../platform/logging/logger.js";
import { correlationServerOptions, registerCorrelation } from "./plugins/correlation.js";
import { registerErrorHandling } from "./plugins/errors.js";
import { hasWebBuild, registerWeb } from "./plugins/web.js";

export interface AppOptions {
  config: Config;
  logger?: Logger;
  /** Diretório da interface construída (web/dist); servida apenas se existir. */
  webRoot?: string;
  /** Registra rotas e plugins adicionais (módulos). */
  register?: (app: FastifyInstance) => Promise<void> | void;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({
    // Sem a conversão, o tipo Logger do pino se propaga e torna a instância incompatível com
    // FastifyInstance nos plugins; o ESLint não enxerga essa inferência.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    loggerInstance: (options.logger ?? createLogger({ name: "app" })) as FastifyBaseLogger,
    ...correlationServerOptions,
    // Campos desconhecidos são rejeitados (422) em vez de removidos silenciosamente.
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: true } },
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<TypeBoxTypeProvider>();

  registerCorrelation(app);
  const spaFallback =
    options.webRoot && hasWebBuild(options.webRoot)
      ? await registerWeb(app, options.webRoot)
      : undefined;
  registerErrorHandling(app, spaFallback ? { spaFallback } : {});
  if (options.register) await options.register(app);
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
