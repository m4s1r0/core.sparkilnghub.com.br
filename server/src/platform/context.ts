import type { Kysely } from "kysely";
import type { Logger } from "pino";
import type { Config } from "./config/load.js";
import type { CredentialRole } from "./config/schema.js";
import { KeyRing } from "./crypto/index.js";
import type { PoolRegistry } from "./db/pools.js";
import { createLogger } from "./logging/logger.js";

/**
 * Dependências compartilhadas pelos módulos de F01. Os nomes dos bancos e a credencial dos bancos
 * do Core são parâmetros para que os testes de integração usem bancos `t_<run>_*` isolados; a
 * projeção de acesso sempre usa a credencial `access` (R-07).
 */
export interface AppContext {
  config: Config;
  pools: PoolRegistry;
  /** `spark_identity`: contas, vínculos, sessões do Core, eventos de segurança. */
  identity: Kysely<unknown>;
  /** `spark_core`: referências de instância, credenciais de aplicação, sincronização. */
  core: Kysely<unknown>;
  /** Pool exclusivo do banco de acesso de uma instância (um pool por banco, sem `USE`). */
  access(accessDatabase: string): Kysely<unknown>;
  keyRing: KeyRing;
  clock: () => Date;
  logger: Logger;
}

export interface ContextOptions {
  identityDatabase?: string;
  coreDatabase?: string;
  /** Credencial dos bancos do Core: `web` no servidor, `worker` no trabalhador. */
  role?: CredentialRole;
  clock?: () => Date;
  logger?: Logger;
}

export function createAppContext(
  config: Config,
  pools: PoolRegistry,
  options: ContextOptions = {},
): AppContext {
  const role = options.role ?? "web";
  let ring: KeyRing | undefined;
  return {
    config,
    pools,
    identity: pools.get(role, options.identityDatabase ?? "spark_identity"),
    core: pools.get(role, options.coreDatabase ?? "spark_core"),
    access: (accessDatabase) => pools.get("access", accessDatabase),
    // Só o servidor carrega a chave; o trabalhador nunca decifra segredos TOTP.
    get keyRing() {
      const key = config.secrets.IDENTITY_SECRET_KEY;
      if (!key) throw new Error("IDENTITY_SECRET_KEY não carregada nesta configuração");
      ring ??= KeyRing.fromBase64(config.IDENTITY_SECRET_KEY_VERSION, key);
      return ring;
    },
    clock: options.clock ?? (() => new Date()),
    logger: options.logger ?? createLogger({ name: "sparkcore" }),
  };
}
