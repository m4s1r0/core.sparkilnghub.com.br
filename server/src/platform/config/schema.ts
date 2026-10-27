import Type, { type Static } from "typebox";
import { literals } from "@sparkcore/contracts";

export const Environments = ["development", "homologation", "production"] as const;
export type Env = (typeof Environments)[number];

export const EnvSchema = literals(Environments);

const port = (defaultPort: number) =>
  Type.Integer({ minimum: 1, maximum: 65535, default: defaultPort });
const Secret = Type.String({ minLength: 8 });

/**
 * Credenciais MySQL por papel (F00 research.md R-06). `access` escreve a projeção de acesso nos
 * bancos `<instância>_acc` (F01 research.md R-07).
 */
export const CredentialRoles = [
  "migrator",
  "web",
  "worker",
  "provisioner",
  "access",
  "test",
] as const;
export type CredentialRole = (typeof CredentialRoles)[number];

export const credentialVariable: Record<CredentialRole, string> = {
  migrator: "MYSQL_MIGRATOR_PASSWORD",
  web: "MYSQL_WEB_PASSWORD",
  worker: "MYSQL_WORKER_PASSWORD",
  provisioner: "MYSQL_PROVISIONER_PASSWORD",
  access: "MYSQL_ACCESS_WRITER_PASSWORD",
  test: "MYSQL_TEST_PASSWORD",
};

export const mysqlUser: Record<CredentialRole, string> = {
  migrator: "spark_core_migrator",
  web: "spark_core_web",
  worker: "spark_core_worker",
  provisioner: "spark_provisioner",
  access: "spark_access_writer",
  test: "spark_test",
};

/** Segredos que não são credenciais MySQL; cada processo pede só os que usa. */
export const SecretNames = [
  "IDENTITY_SECRET_KEY",
  "INSTANCE_SECRET_KEY",
  "SEED_USER_PASSWORD",
] as const;
export type SecretName = (typeof SecretNames)[number];

/** Validação de cada segredo; devolve a mensagem do problema ou `null`. */
export const secretProblem: Record<SecretName, (value: string) => string | null> = {
  // Chave AES-256 do segredo TOTP (research.md R-03): 32 bytes em base64.
  IDENTITY_SECRET_KEY: (value) =>
    Buffer.from(value, "base64").length === 32 ? null : "deve ter 32 bytes em base64",
  // Chave AES-256 da senha operacional das instâncias (F02 research.md R-09): 32 bytes em base64.
  INSTANCE_SECRET_KEY: (value) =>
    Buffer.from(value, "base64").length === 32 ? null : "deve ter 32 bytes em base64",
  // Senha das contas sintéticas das sementes; segue a política de senha (FR-003).
  SEED_USER_PASSWORD: (value) => (value.length >= 12 ? null : "mínimo de 12 caracteres"),
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
  // Origem pública da interface, aceita na verificação de origem contra CSRF (research.md R-05).
  PUBLIC_ORIGIN: Type.String({
    pattern: "^https?://[a-z0-9.-]+(:[0-9]{1,5})?$",
    default: "http://127.0.0.1:3000",
  }),
  // Versão da IDENTITY_SECRET_KEY gravada junto de cada segredo cifrado (research.md R-03).
  IDENTITY_SECRET_KEY_VERSION: Type.Integer({ minimum: 1, maximum: 255, default: 1 }),
  // Versão da INSTANCE_SECRET_KEY gravada junto da senha operacional cifrada (F02 R-09).
  INSTANCE_SECRET_KEY_VERSION: Type.Integer({ minimum: 1, maximum: 255, default: 1 }),
  // Endereço do MySQL entregue aos produtos pelo contrato de conexão (F02 R-10); ausente = o do
  // Core.
  INSTANCE_DB_HOST: Type.Optional(Type.String({ minLength: 1 })),
  INSTANCE_DB_PORT: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  // Tentativas por etapa de provisionamento em cada execução (F02 R-08).
  PROVISIONING_MAX_ATTEMPTS: Type.Integer({ minimum: 1, maximum: 20, default: 5 }),
});

export type BaseConfig = Static<typeof BaseConfigSchema>;

export const SecretSchema = Secret;
