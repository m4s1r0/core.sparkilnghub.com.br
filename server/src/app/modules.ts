import type { FastifyInstance } from "fastify";
import { SystemStatusService } from "../modules/system/probe.js";
import { registerSystemRoutes } from "../modules/system/routes.js";
import type { Config } from "../platform/config/load.js";
import type { PoolRegistry } from "../platform/db/pools.js";

export interface ModuleDeps {
  config: Config;
  pools: PoolRegistry;
  statusService?: SystemStatusService;
}

/** Ponto único de registro dos módulos do monólito (constituição VII). */
export function registerModules(app: FastifyInstance, deps: ModuleDeps): void {
  registerSystemRoutes(app, deps.statusService ?? new SystemStatusService(deps.config, deps.pools));
}
