import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect } from "vitest";
import { parse } from "yaml";
import { repoRoot } from "../../src/platform/paths.js";

interface Operation {
  responses: Record<
    string,
    { content?: { "application/json"?: { schema?: Record<string, unknown> } } }
  >;
}

const openapi = parse(readFileSync(join(repoRoot, "contracts", "openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, { operationId: string } & Operation>>;
  components: Record<string, unknown>;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
ajv.addSchema({ $id: "openapi", components: openapi.components });

const operations = new Map<string, Operation>();
for (const methods of Object.values(openapi.paths)) {
  for (const operation of Object.values(methods)) operations.set(operation.operationId, operation);
}

/** Referências locais (`#/components/...`) passam a apontar para o documento registrado. */
function rebase(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(rebase);
  if (schema && typeof schema === "object") {
    return Object.fromEntries(
      Object.entries(schema).map(([key, value]) => [
        key,
        key === "$ref" && typeof value === "string" && value.startsWith("#/")
          ? `openapi${value}`
          : rebase(value),
      ]),
    );
  }
  return schema;
}

const cache = new Map<string, ValidateFunction>();
function validator(key: string, schema: unknown): ValidateFunction {
  let compiled = cache.get(key);
  if (!compiled) {
    compiled = ajv.compile(rebase(schema) as object);
    cache.set(key, compiled);
  }
  return compiled;
}

/**
 * Confere uma resposta real contra `contracts/openapi.yaml`: a operação e o status precisam
 * estar declarados; o corpo valida contra o esquema declarado ou, em erros sem esquema próprio,
 * contra o envelope de erro (conventions.md §4). 204 não tem corpo.
 */
export function expectMatchesContract(operationId: string, status: number, body: unknown): void {
  const operation = operations.get(operationId);
  expect(operation, `operação ${operationId} ausente do contrato`).toBeDefined();
  const response = operation?.responses[String(status)];
  expect(response, `${operationId}: status ${status} não declarado no contrato`).toBeDefined();
  if (status === 204) {
    expect(body === undefined || body === "" || body === null).toBe(true);
    return;
  }
  const schema =
    response?.content?.["application/json"]?.schema ??
    (status >= 400 ? { $ref: "#/components/schemas/ErrorEnvelope" } : undefined);
  if (!schema) return;
  const validate = validator(`${operationId}:${status}`, schema);
  const valid = validate(body);
  expect(valid, `${operationId} ${status}: ${ajv.errorsText(validate.errors)}`).toBe(true);
}

/** Corpo JSON de uma resposta do `inject`, ou `undefined` quando vazia. */
export function bodyOf(response: { body: string }): unknown {
  return response.body === "" ? undefined : (JSON.parse(response.body) as unknown);
}
