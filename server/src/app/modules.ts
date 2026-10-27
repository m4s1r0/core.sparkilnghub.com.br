import type { FastifyInstance } from "fastify";
import { registerCatalogRoutes } from "../modules/catalog/routes.js";
import { registerContractorRoutes } from "../modules/contractors/routes.js";
import { registerAccountRoutes } from "../modules/identity/account-routes.js";
import { registerAdminRoutes } from "../modules/identity/admin-routes.js";
import { registerIdentityRoutes } from "../modules/identity/routes.js";
import { registerInstanceRoutes } from "../modules/instances/routes.js";
import { registerInternalConnectionRoutes } from "../modules/internal-api/connection.js";
import { registerInternalMemberRoutes } from "../modules/internal-api/members.js";
import { registerInternalSessionRoutes } from "../modules/internal-api/sessions.js";
import { registerMembershipRoutes } from "../modules/memberships/routes.js";
import { SystemStatusService } from "../modules/system/probe.js";
import { registerSystemRoutes } from "../modules/system/routes.js";
import type { Config } from "../platform/config/load.js";
import { type AppContext, createAppContext } from "../platform/context.js";
import type { PoolRegistry } from "../platform/db/pools.js";
import { registerCookies } from "../platform/http/cookies.js";
import { registerOriginCheck } from "../platform/http/origin-check.js";
import { requireSession } from "../platform/http/session-guard.js";

export interface ModuleDeps {
  config: Config;
  pools: PoolRegistry;
  /** Contexto pronto (testes); padrão: bancos e credencial do servidor (`web`). */
  ctx?: AppContext;
  statusService?: SystemStatusService;
}

/** Ponto único de registro dos módulos do monólito (constituição VII). */
export function registerModules(app: FastifyInstance, deps: ModuleDeps): void {
  const ctx = deps.ctx ?? createAppContext(deps.config, deps.pools, { logger: app.log as never });
  registerCookies(app);
  registerOriginCheck(app, deps.config);
  // Desde F01 a situação detalhada exige sessão de administrador com MFA; /health/live é público.
  registerSystemRoutes(
    app,
    deps.statusService ?? new SystemStatusService(deps.config, deps.pools),
    {
      preHandler: requireSession(ctx),
    },
  );
  registerIdentityRoutes(app, ctx);
  registerAdminRoutes(app, ctx);
  registerAccountRoutes(app, ctx);
  registerMembershipRoutes(app, ctx);
  registerInternalSessionRoutes(app, ctx);
  registerInternalMemberRoutes(app, ctx);
  registerContractorRoutes(app, ctx);
  registerCatalogRoutes(app, ctx);
  registerInstanceRoutes(app, ctx);
  registerInternalConnectionRoutes(app, ctx);
}
