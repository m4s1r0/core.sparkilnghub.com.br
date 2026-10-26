import Type, { type Static } from "typebox";
import { literals } from "@sparkcore/contracts";

export const Environments = ["development", "homologation", "production"] as const;
export type Env = (typeof Environments)[number];

export const EnvSchema = literals(Environments);

const port = (defaultPort: number) =>
  Type.Integer({ minimum: 1, maximum: 65535, default: defaultPort });
const Secret = Type.String({ minLength: 8 });

/** Credenciais MySQL por papel (research.md R-06). */
export const CredentialRoles = ["migrator", "web", "worker", "provisioner", "test"] as const;
export type CredentialRole = (typeof CredentialRoles)[number];

export const credentialVariable: Record<CredentialRole, string> = {
  migrator: "MYSQL_MIGRATOR_PASSWORD",
  web: "MYSQL_WEB_PASSWORD",
  worker: "MYSQL_WORKER_PASSWORD",
  provisioner: "MYSQL_PROVISIONER_PASSWORD",
  test: "MYSQL_TEST_PASSWORD",
};

export const mysqlUser: Record<CredentialRole, string> = {
  migrator: "spark_core_migrator",
  web: "spark_core_web",
  worker: "spark_core_worker",
  provisioner: "spark_provisioner",
  test: "spark_test",
};

/** Variáveis não secretas, com valor padrão de desenvolvimento quando ausentes. */
export const BaseConfigSchema = Type.Object({
  SPARK_ENV: EnvSchema,
  APP_VERSION: Type.Optional(Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" })),
  HTTP_HOST: Type.String({ minLength: 1, default: "127.0.0.1" }),
  HTTP_PORT: port(3000),
  MYSQL_HOST: Type.String({ minLength: 1, default: "127.0.0.1" }),
  MYSQL_PORT: port(3307),
  DB_POOL_LIMIT: Type.Integer({ minimum: 1, maximum: 50, default: 5 }),
  DB_POOL_GLOBAL_LIMIT: Type.Integer({ minimum: 1, maximum: 500, default: 50 }),
});

export type BaseConfig = Static<typeof BaseConfigSchema>;

export const SecretSchema = Secret;
