import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app/build-app.js";
import { registerModules } from "../../src/app/modules.js";
import type { Config } from "../../src/platform/config/load.js";
import type { AppContext } from "../../src/platform/context.js";
import { captureLogger, fixedStatusService, healthyStatus } from "./app.js";
import type { F01TestEnv } from "./f01.js";

export type F01App = Awaited<ReturnType<typeof buildF01App>>;

/**
 * App completo de F01 sobre o ambiente isolado de teste (bancos `t_<run>_*`, relógio do teste).
 * `extra` registra rotas de teste; `overrides` altera a configuração (ex.: SPARK_ENV).
 */
export async function buildF01App(
  env: F01TestEnv,
  extra?: (app: FastifyInstance, ctx: AppContext) => void,
  overrides: Partial<Config> = {},
  /** Contexto alternativo (ex.: pools novos de `env.freshContext()`). */
  base: AppContext = env.ctx,
) {
  const config = { ...base.config, ...overrides };
  // Mesmo contexto do ambiente (pools, relógio, bancos), com a configuração ajustada.
  const ctx: AppContext = Object.create(base, {
    config: { value: config },
  }) as AppContext;
  const capture = captureLogger();
  const app = await buildApp({
    config,
    logger: capture.logger,
    register: (instance) => {
      registerModules(instance, {
        config,
        pools: base.pools,
        ctx,
        statusService: fixedStatusService(healthyStatus()),
      });
      extra?.(instance, ctx);
    },
  });
  await app.ready();
  return { app, ctx, ...capture, close: () => app.close() };
}
