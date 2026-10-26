import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { repoRoot } from "../../src/platform/paths.js";
import { contractApp, fixedStatusService, healthyStatus, testConfig } from "../support/app.js";

// Contrato publicado na raiz (contracts/openapi.yaml) — fonte validada pela CI (FR-014).
const openapi = parse(readFileSync(join(repoRoot, "contracts", "openapi.yaml"), "utf8")) as {
  components: Record<string, unknown>;
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema({ $id: "openapi", components: openapi.components });

function validate(schema: string, body: unknown) {
  const validator = ajv.getSchema(`openapi#/components/schemas/${schema}`);
  if (!validator) throw new Error(`Esquema ${schema} ausente do contrato`);
  const valid = validator(body);
  return { valid, errors: ajv.errorsText(validator.errors) };
}

let healthy: Awaited<ReturnType<typeof contractApp>>;
let unreachable: Awaited<ReturnType<typeof contractApp>>;

beforeAll(async () => {
  healthy = await contractApp({ statusService: fixedStatusService(healthyStatus()) });
  unreachable = await contractApp({ config: testConfig({ MYSQL_PORT: 1 }) });
});
afterAll(async () => {
  await healthy?.close();
  await unreachable?.close();
});

describe("respostas reais × contracts/openapi.yaml", () => {
  it("GET /health/live → 200 conforme contrato", async () => {
    const response = await healthy.app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.headers["x-correlation-id"]).toBeDefined();
  });

  it("GET /api/v1/system/status → 200 válido contra SystemStatus", async () => {
    const response = await healthy.app.inject({ method: "GET", url: "/api/v1/system/status" });
    expect(response.statusCode).toBe(200);
    const result = validate("SystemStatus", response.json());
    expect(result.errors).toBe("No errors");
    expect(result.valid).toBe(true);
  });

  it("GET /api/v1/system/status → 503 válido contra SystemStatus, com Retry-After", async () => {
    const response = await unreachable.app.inject({ method: "GET", url: "/api/v1/system/status" });
    expect(response.statusCode).toBe(503);
    expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    const result = validate("SystemStatus", response.json());
    expect(result.errors).toBe("No errors");
  });

  it("500 forçado → ErrorEnvelope", async () => {
    const response = await healthy.app.inject({ method: "GET", url: "/__test/boom" });
    expect(response.statusCode).toBe(500);
    expect(validate("ErrorEnvelope", response.json()).errors).toBe("No errors");
  });

  it("422 forçado (tipo inválido e campo desconhecido) → ErrorEnvelope com details", async () => {
    const response = await healthy.app.inject({
      method: "POST",
      url: "/__test/echo",
      payload: { name: 1, extra: true },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json<{
      error: { code: string; details: { field: string; code: string }[] };
    }>();
    expect(validate("ErrorEnvelope", body).errors).toBe("No errors");
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "/name" }),
        expect.objectContaining({ field: "/extra", code: "VALIDATION_UNKNOWN_FIELD" }),
      ]),
    );
  });

  it("corpo malformado → 400 ErrorEnvelope", async () => {
    const response = await healthy.app.inject({
      method: "POST",
      url: "/__test/echo",
      headers: { "content-type": "application/json" },
      payload: "{nao-json",
    });
    expect(response.statusCode).toBe(400);
    expect(validate("ErrorEnvelope", response.json()).errors).toBe("No errors");
  });

  it("rota inexistente → 404 ErrorEnvelope", async () => {
    const response = await healthy.app.inject({ method: "GET", url: "/api/v1/nao-existe" });
    expect(response.statusCode).toBe(404);
    expect(validate("ErrorEnvelope", response.json()).errors).toBe("No errors");
  });
});
