import Type, { type Static } from "typebox";

/** Envelope de erro — contracts/conventions.md §4 e openapi.yaml `ErrorEnvelope`. */
export const ErrorDetail = Type.Object(
  {
    field: Type.String(),
    code: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: false },
);

export const ErrorBody = Type.Object(
  {
    code: Type.String({ pattern: "^[A-Z][A-Z0-9_]+$" }),
    message: Type.String({ minLength: 1 }),
    field: Type.Union([Type.String(), Type.Null()]),
    retryable: Type.Boolean(),
    correlationId: Type.String({ format: "uuid" }),
    details: Type.Optional(Type.Array(ErrorDetail)),
  },
  { additionalProperties: false },
);

export const ErrorEnvelope = Type.Object({ error: ErrorBody }, { additionalProperties: false });

export type ErrorEnvelope = Static<typeof ErrorEnvelope>;
export type ErrorBody = Static<typeof ErrorBody>;
