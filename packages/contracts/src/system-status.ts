import Type, { type Static } from "typebox";
import { literals } from "./literals.js";

/** openapi.yaml `HealthState`, `ComponentStatus`, `SystemStatus` (FR-012). */
export const HEALTH_STATES = ["SAUDAVEL", "DEGRADADA", "INDISPONIVEL", "DESCONHECIDA"] as const;
export const HealthState = literals(HEALTH_STATES);
export type HealthState = (typeof HEALTH_STATES)[number];

export const COMPONENT_NAMES = ["server", "worker", "spark_core", "spark_identity"] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

export const STATUS_REASONS = [
  "DB_UNREACHABLE",
  "SCHEMA_BEHIND",
  "SCHEMA_FAILED",
  "SCHEMA_CHECKSUM_MISMATCH",
  "SCHEMA_UNKNOWN_VERSION",
  "WORKER_STALE",
  "WORKER_ABSENT",
] as const;
export type StatusReason = (typeof STATUS_REASONS)[number];

const nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) =>
  Type.Union([schema, Type.Null()]);

export const ComponentStatus = Type.Object(
  {
    name: literals(COMPONENT_NAMES),
    status: HealthState,
    schemaVersion: Type.Optional(nullable(Type.Integer({ minimum: 0 }))),
    expectedSchemaVersion: Type.Optional(nullable(Type.Integer({ minimum: 0 }))),
    reason: Type.Optional(nullable(literals(STATUS_REASONS))),
    checkedAt: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);
export type ComponentStatus = Static<typeof ComponentStatus>;

export const SystemStatus = Type.Object(
  {
    service: Type.Literal("sparkcore"),
    version: Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" }),
    environment: Type.Union([
      Type.Literal("development"),
      Type.Literal("homologation"),
      Type.Literal("production"),
    ]),
    status: HealthState,
    checkedAt: Type.String({ format: "date-time" }),
    components: Type.Array(ComponentStatus, { minItems: 4, maxItems: 4 }),
  },
  { additionalProperties: false },
);
export type SystemStatus = Static<typeof SystemStatus>;

export const Liveness = Type.Object(
  { status: Type.Literal("ok") },
  { additionalProperties: false },
);
export type Liveness = Static<typeof Liveness>;
