import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../../../src/platform/config/load.js";

const secret = "s3nha-local-ok";

describe("loadConfig (FR-010)", () => {
  it("converte números e aplica valores padrão não secretos", () => {
    const config = loadConfig({
      env: { SPARK_ENV: "development", HTTP_PORT: "3100", MYSQL_WEB_PASSWORD: secret },
      credentials: ["web"],
    });
    expect(config.HTTP_PORT).toBe(3100);
    expect(config.MYSQL_PORT).toBe(3307);
    expect(config.HTTP_HOST).toBe("127.0.0.1");
    expect(config.credentials.web).toBe(secret);
    expect(config.APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lista todas as variáveis ausentes ou inválidas de uma vez", () => {
    let error: unknown;
    try {
      loadConfig({ env: { HTTP_PORT: "abc" }, credentials: ["web", "worker"] });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const problems = (error as ConfigError).problems.join("\n");
    expect(problems).toMatch(/SPARK_ENV ausente/);
    expect(problems).toMatch(/HTTP_PORT/);
    expect(problems).toMatch(/MYSQL_WEB_PASSWORD ausente/);
    expect(problems).toMatch(/MYSQL_WORKER_PASSWORD ausente/);
  });

  it("nunca aceita o valor de exemplo como segredo", () => {
    expect(() =>
      loadConfig({
        env: { SPARK_ENV: "development", MYSQL_WEB_PASSWORD: "__defina__" },
        credentials: ["web"],
      }),
    ).toThrow(/MYSQL_WEB_PASSWORD inválida/);
  });

  it("credencial do escritor da projeção de acesso (papel access)", () => {
    const config = loadConfig({
      env: { SPARK_ENV: "development", MYSQL_ACCESS_WRITER_PASSWORD: secret },
      credentials: ["access"],
    });
    expect(config.credentials.access).toBe(secret);
    expect(() =>
      loadConfig({ env: { SPARK_ENV: "development" }, credentials: ["access"] }),
    ).toThrow(/MYSQL_ACCESS_WRITER_PASSWORD ausente/);
  });

  it("segredos de identidade: chave de 32 bytes e senha das sementes com 12+ caracteres", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const config = loadConfig({
      env: {
        SPARK_ENV: "development",
        IDENTITY_SECRET_KEY: key,
        SEED_USER_PASSWORD: "x".repeat(12),
      },
      secrets: ["IDENTITY_SECRET_KEY", "SEED_USER_PASSWORD"],
    });
    expect(config.secrets.IDENTITY_SECRET_KEY).toBe(key);
    expect(config.IDENTITY_SECRET_KEY_VERSION).toBe(1);
    expect(config.PUBLIC_ORIGIN).toBe("http://127.0.0.1:3000");

    let error: unknown;
    try {
      loadConfig({
        env: {
          SPARK_ENV: "development",
          IDENTITY_SECRET_KEY: Buffer.alloc(16).toString("base64"),
          SEED_USER_PASSWORD: "curta",
        },
        secrets: ["IDENTITY_SECRET_KEY", "SEED_USER_PASSWORD"],
      });
    } catch (e) {
      error = e;
    }
    const problems = (error as ConfigError).problems.join("\n");
    expect(problems).toMatch(/IDENTITY_SECRET_KEY inválida \(deve ter 32 bytes/);
    expect(problems).toMatch(/SEED_USER_PASSWORD inválida/);
    // O valor nunca aparece na mensagem.
    expect(problems).not.toMatch(/curta/);
  });

  it("provisionamento (F02): chave das instâncias, endereço entregue aos produtos e tentativas", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const config = loadConfig({
      env: { SPARK_ENV: "development", INSTANCE_SECRET_KEY: key, INSTANCE_DB_PORT: "3308" },
      secrets: ["INSTANCE_SECRET_KEY"],
    });
    expect(config.secrets.INSTANCE_SECRET_KEY).toBe(key);
    expect(config.INSTANCE_SECRET_KEY_VERSION).toBe(1);
    expect(config.INSTANCE_DB_PORT).toBe(3308);
    expect(config.INSTANCE_DB_HOST).toBeUndefined();
    expect(config.PROVISIONING_MAX_ATTEMPTS).toBe(5);

    const short = Buffer.alloc(31, 1).toString("base64");
    let error: unknown;
    try {
      loadConfig({
        env: {
          SPARK_ENV: "development",
          INSTANCE_SECRET_KEY: short,
          PROVISIONING_MAX_ATTEMPTS: "0",
        },
        secrets: ["INSTANCE_SECRET_KEY"],
      });
    } catch (e) {
      error = e;
    }
    const problems = (error as ConfigError).problems.join("\n");
    expect(problems).toMatch(/INSTANCE_SECRET_KEY inválida \(deve ter 32 bytes/);
    expect(problems).toMatch(/PROVISIONING_MAX_ATTEMPTS/);
    expect(problems).not.toContain(short);
    expect(() =>
      loadConfig({ env: { SPARK_ENV: "development" }, secrets: ["INSTANCE_SECRET_KEY"] }),
    ).toThrow(/INSTANCE_SECRET_KEY ausente/);
  });

  it("recusa PUBLIC_ORIGIN com caminho ou esquema inválido", () => {
    expect(() =>
      loadConfig({ env: { SPARK_ENV: "development", PUBLIC_ORIGIN: "ftp://x/y" } }),
    ).toThrow(/PUBLIC_ORIGIN/);
  });

  it("recusa SPARK_ENV fora dos valores permitidos", () => {
    expect(() => loadConfig({ env: { SPARK_ENV: "staging" } })).toThrow(/SPARK_ENV/);
  });
});
