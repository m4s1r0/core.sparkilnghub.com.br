import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import Value from "typebox/value";
import { repoRoot } from "../paths.js";
import {
  BaseConfigSchema,
  type BaseConfig,
  type CredentialRole,
  credentialVariable,
  type SecretName,
  secretProblem,
  SecretSchema,
} from "./schema.js";

export interface Config extends BaseConfig {
  APP_VERSION: string;
  credentials: Partial<Record<CredentialRole, string>>;
  secrets: Partial<Record<SecretName, string>>;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Configuração inválida:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

let envFileLoaded = false;

/** Carrega `.env` da raiz do repositório, sem sobrescrever variáveis já definidas. */
export function loadEnvFile(): void {
  if (envFileLoaded) return;
  envFileLoaded = true;
  const file = join(repoRoot, ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}

function appVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

/**
 * Valida o ambiente e devolve a configuração. Lista todos os problemas de uma vez e nunca
 * usa valor padrão para segredo (FR-010). Cada processo pede só as credenciais que usa.
 */
export function loadConfig(
  options: {
    credentials?: readonly CredentialRole[];
    secrets?: readonly SecretName[];
    env?: NodeJS.ProcessEnv;
  } = {},
): Config {
  if (!options.env) loadEnvFile();
  const env = options.env ?? process.env;
  const problems: string[] = [];

  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(BaseConfigSchema.properties)) {
    if (env[key] !== undefined && env[key] !== "") raw[key] = env[key];
  }
  if (raw.SPARK_ENV === undefined) problems.push("SPARK_ENV ausente");

  const converted = Value.Default(BaseConfigSchema, Value.Convert(BaseConfigSchema, raw));
  if (!Value.Check(BaseConfigSchema, converted)) {
    for (const error of Value.Errors(BaseConfigSchema, converted)) {
      const name = error.instancePath.replace(/^\//, "") || "configuração";
      if (name === "SPARK_ENV" && raw.SPARK_ENV === undefined) continue;
      problems.push(`${name}: valor inválido (${error.message})`);
    }
  }

  const credentials: Partial<Record<CredentialRole, string>> = {};
  for (const role of options.credentials ?? []) {
    const variable = credentialVariable[role];
    const value = env[variable];
    if (value === undefined || value === "") problems.push(`${variable} ausente`);
    else if (value === "__defina__" || !Value.Check(SecretSchema, value))
      problems.push(`${variable} inválida (mínimo de 8 caracteres, sem valor de exemplo)`);
    else credentials[role] = value;
  }

  const secrets: Partial<Record<SecretName, string>> = {};
  for (const name of options.secrets ?? []) {
    const value = env[name];
    if (value === undefined || value === "") problems.push(`${name} ausente`);
    else if (value === "__defina__") problems.push(`${name} inválida (valor de exemplo)`);
    else {
      const problem = secretProblem[name](value);
      if (problem) problems.push(`${name} inválida (${problem})`);
      else secrets[name] = value;
    }
  }

  if (Value.Check(BaseConfigSchema, converted)) {
    problems.push(...securityProblems(converted));
  }

  if (problems.length > 0) {
    if (!options.env && !existsSync(join(repoRoot, ".env"))) {
      problems.push(
        "arquivo .env não encontrado: copie .env.example para .env e preencha as senhas",
      );
    }
    throw new ConfigError([...new Set(problems)]);
  }
  const base = converted as BaseConfig;
  return { ...base, APP_VERSION: base.APP_VERSION ?? appVersion(), credentials, secrets };
}

/** Lista de `TRUSTED_PROXIES` (IP ou CIDR), já sem espaços nem itens vazios. */
export function trustedProxies(config: Pick<BaseConfig, "TRUSTED_PROXIES">): string[] {
  return config.TRUSTED_PROXIES.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Regras de segurança entre variáveis (SEC-13, SEC-15): proxies válidos; fora do desenvolvimento,
 * TLS obrigatório até o MySQL e credenciais operacionais restritas à rede da aplicação.
 */
export function securityProblems(config: BaseConfig): string[] {
  const problems: string[] = [];
  for (const proxy of trustedProxies(config)) {
    const [address, prefix, extra] = proxy.split("/");
    const family = isIP(address ?? "");
    const bits = family === 4 ? 32 : 128;
    const prefixOk = prefix === undefined || (/^\d{1,3}$/.test(prefix) && Number(prefix) <= bits);
    if (family === 0 || !prefixOk || extra !== undefined) {
      problems.push(`TRUSTED_PROXIES: "${proxy}" não é IP nem CIDR`);
    }
  }
  if (config.MYSQL_TLS === "verify" && !config.MYSQL_TLS_CA) {
    problems.push("MYSQL_TLS_CA ausente (obrigatória com MYSQL_TLS=verify)");
  }
  if (config.SPARK_ENV !== "development") {
    if (config.MYSQL_TLS === "off") {
      problems.push(
        `MYSQL_TLS=off não é permitido em ${config.SPARK_ENV} (use required ou verify)`,
      );
    }
    if (config.INSTANCE_DB_USER_HOST === "%") {
      problems.push(
        `INSTANCE_DB_USER_HOST='%' não é permitido em ${config.SPARK_ENV} (use a rede da aplicação)`,
      );
    }
  }
  return problems;
}
