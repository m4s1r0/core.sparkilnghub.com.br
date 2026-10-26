import { Writable } from "node:stream";
import type { SystemStatus } from "@sparkcore/contracts";
import Type from "typebox";
import { pino } from "pino";
import { buildApp } from "../../src/app/build-app.js";
import { SystemStatusService } from "../../src/modules/system/probe.js";
import { registerSystemRoutes } from "../../src/modules/system/routes.js";
import { type Config, loadConfig } from "../../src/platform/config/load.js";
import { PoolRegistry } from "../../src/platform/db/pools.js";
import { loggerOptions } from "../../src/platform/logging/logger.js";

/** Captura as linhas JSON do logger para inspeção nos testes. */
export function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        raw.push(line);
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      callback();
    },
  });
  return { logger: pino({ ...loggerOptions, level: "info" }, stream), lines, raw };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({
      env: { SPARK_ENV: "development", MYSQL_WEB_PASSWORD: "senha-de-teste" },
      credentials: ["web"],
    }),
    ...overrides,
  };
}

/** Serviço de status com resposta fixa, para exercitar serialização e contrato sem banco. */
export function fixedStatusService(status: SystemStatus): SystemStatusService {
  return { check: () => Promise.resolve(status) } as unknown as SystemStatusService;
}

export function healthyStatus(): SystemStatus {
  const checkedAt = new Date().toISOString();
  return {
    service: "sparkcore",
    version: "0.1.0",
    environment: "development",
    status: "SAUDAVEL",
    checkedAt,
    components: [
      { name: "server", status: "SAUDAVEL", reason: null, checkedAt },
      { name: "worker", status: "SAUDAVEL", reason: null, checkedAt },
      {
        name: "spark_core",
        status: "SAUDAVEL",
        schemaVersion: 2,
        expectedSchemaVersion: 2,
        reason: null,
        checkedAt,
      },
      {
        name: "spark_identity",
        status: "SAUDAVEL",
        schemaVersion: 1,
        expectedSchemaVersion: 1,
        reason: null,
        checkedAt,
      },
    ],
  };
}

const TestBody = Type.Object({ name: Type.String() }, { additionalProperties: false });

export class SqlLikeError extends Error {
  code = "ER_DUP_ENTRY";
  errno = 1062;
  sqlState = "23000";
  sql = "INSERT INTO conta (email, password) VALUES ('ana@example.test', 'segredo123')";
  sqlMessage = "Duplicate entry 'ana@example.test' for key 'conta.email'";
  constructor() {
    super("Duplicate entry 'ana@example.test' for key 'conta.email'");
  }
}

/**
 * App com as rotas reais de sistema e rotas de teste que forçam 422 e 500. `statusService`
 * ausente usa a sonda real com `config` (ex.: porta fechada → 503).
 */
export async function contractApp(
  options: { config?: Config; statusService?: SystemStatusService } = {},
) {
  const config = options.config ?? testConfig();
  const capture = captureLogger();
  const pools = new PoolRegistry(config);
  const app = await buildApp({
    config,
    logger: capture.logger,
    register: (instance) => {
      registerSystemRoutes(
        instance,
        options.statusService ?? new SystemStatusService(config, pools),
      );
      instance.post("/__test/echo", { schema: { body: TestBody } }, (request) => request.body);
      instance.get("/__test/boom", () => {
        throw new SqlLikeError();
      });
    },
  });
  await app.ready();
  return {
    app,
    ...capture,
    close: async () => {
      await app.close();
      await pools.closeAll();
    },
  };
}
