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

  it("recusa SPARK_ENV fora dos valores permitidos", () => {
    expect(() => loadConfig({ env: { SPARK_ENV: "staging" } })).toThrow(/SPARK_ENV/);
  });
});
