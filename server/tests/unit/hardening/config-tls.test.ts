import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, trustedProxies } from "../../../src/platform/config/load.js";
import { PoolRegistry, sslOptions } from "../../../src/platform/db/pools.js";

/** SEC-15 / SEC-13: configuração recusa MySQL sem TLS e host aberto fora do desenvolvimento. */
const problems = (env: Record<string, string>): string[] => {
  try {
    loadConfig({ env });
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
};

describe("SEC-15 — TLS e host das credenciais MySQL", () => {
  it("homologação/produção sem TLS ou com host '%' → erro de configuração", () => {
    for (const SPARK_ENV of ["homologation", "production"]) {
      const found = problems({ SPARK_ENV });
      expect(found.some((p) => p.startsWith("MYSQL_TLS=off"))).toBe(true);
      expect(found.some((p) => p.startsWith("INSTANCE_DB_USER_HOST"))).toBe(true);
      expect(
        problems({ SPARK_ENV, MYSQL_TLS: "required", INSTANCE_DB_USER_HOST: "10.0.%" }),
      ).toEqual([]);
    }
  });

  it("desenvolvimento aceita os padrões; verify exige a CA", () => {
    expect(problems({ SPARK_ENV: "development" })).toEqual([]);
    expect(problems({ SPARK_ENV: "development", MYSQL_TLS: "verify" })).toContain(
      "MYSQL_TLS_CA ausente (obrigatória com MYSQL_TLS=verify)",
    );
  });

  it("pools recebem ssl conforme MYSQL_TLS", () => {
    expect(sslOptions({ MYSQL_TLS: "off" })).toBeUndefined();
    expect(sslOptions({ MYSQL_TLS: "required" })).toEqual({ rejectUnauthorized: false });
    expect(PoolRegistry).toBeDefined();
  });
});

describe("SEC-13 — lista de proxies confiáveis", () => {
  it("aceita IP e CIDR; recusa outra coisa", () => {
    expect(trustedProxies({ TRUSTED_PROXIES: " 10.0.0.1, 10.0.0.0/8,,2001:db8::/32 " })).toEqual([
      "10.0.0.1",
      "10.0.0.0/8",
      "2001:db8::/32",
    ]);
    expect(problems({ SPARK_ENV: "development", TRUSTED_PROXIES: "10.0.0.0/8" })).toEqual([]);
    expect(problems({ SPARK_ENV: "development", TRUSTED_PROXIES: "proxy.local" })).toEqual([
      'TRUSTED_PROXIES: "proxy.local" não é IP nem CIDR',
    ]);
    expect(problems({ SPARK_ENV: "development", TRUSTED_PROXIES: "10.0.0.0/33" })).toHaveLength(1);
  });
});
