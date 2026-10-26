import type { Logger } from "pino";
import type { Config } from "./load.js";
import { openAdminConnection } from "../db/pools.js";
import type { Env } from "./schema.js";

export class EnvGuardError extends Error {
  readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "EnvGuardError";
  }
}

/** Lê `spark_core.environment_marker`; `null` se o banco ainda não foi migrado. */
export async function readEnvironmentMarker(config: Config): Promise<Env | null> {
  const connection = await openAdminConnection(config, "migrator");
  try {
    const [rows] = await connection.query(
      "SELECT environment FROM spark_core.environment_marker WHERE id = 1",
    );
    const row = (rows as { environment: Env }[])[0];
    return row?.environment ?? null;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ER_NO_SUCH_TABLE" || code === "ER_BAD_DB_ERROR") return null;
    throw error;
  } finally {
    await connection.end();
  }
}

/**
 * Recusa o comando se `SPARK_ENV` não estiver em `allowed` ou divergir do marcador gravado no
 * banco (FR-011, FR-028; constituição IV, v1.1.1). Saída 2 nos CLIs.
 */
export async function assertEnvironment(
  allowed: readonly Env[],
  command: string,
  deps: { config: Config; logger: Logger; readMarker?: (config: Config) => Promise<Env | null> },
): Promise<void> {
  const { config, logger } = deps;
  let marker: Env | null | "não consultado" = "não consultado";
  const refuse = (reason: string) => {
    logger.warn(
      { event: "env_guard_refused", command, sparkEnv: config.SPARK_ENV, marker, allowed },
      reason,
    );
    throw new EnvGuardError(reason);
  };
  // Recusa antes de qualquer acesso ao banco quando o próprio SPARK_ENV não é permitido.
  if (!allowed.includes(config.SPARK_ENV)) {
    refuse(
      `Comando "${command}" não permitido em ${config.SPARK_ENV} (permitido: ${allowed.join(", ")})`,
    );
  }
  marker = await (deps.readMarker ?? readEnvironmentMarker)(config);
  if (marker !== null && marker !== config.SPARK_ENV) {
    refuse(`Ambiente divergente: SPARK_ENV=${config.SPARK_ENV}, marcador do banco=${marker}`);
  }
  if (marker !== null && !allowed.includes(marker)) {
    refuse(`Comando "${command}" não permitido no ambiente marcado ${marker}`);
  }
}
