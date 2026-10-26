import { type LoadedManifest, MigrationError } from "./manifest.js";

export type ForbiddenCode =
  | "USE"
  | "QUALIFIED_DATABASE"
  | "CREATE_DATABASE"
  | "CREATE_USER"
  | "GRANT"
  | "DROP_DATABASE"
  | "SET_GLOBAL"
  | "LOAD_DATA"
  | "INTO_OUTFILE";

const IDENT = "(?:`[^`]+`|[A-Za-z_][\\w$]*)";

/**
 * Construções que um artefato de produto não pode conter (contracts/migration-artifact.md).
 * Este é o único arquivo de server/src em que o texto dessas instruções aparece: é a lista do que
 * o validador recusa, nunca executada (constituição IV, v1.1.1; scripts/check-migrations.ts).
 */
const FORBIDDEN: { code: ForbiddenCode; pattern: RegExp }[] = [
  { code: "USE", pattern: /(^|;)\s*USE\s+/im },
  {
    code: "QUALIFIED_DATABASE",
    pattern: new RegExp(
      `\\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES|EXISTS|VIEW|TRIGGER|ON)\\s+${IDENT}\\s*\\.\\s*(?:${IDENT}|\\*)`,
      "i",
    ),
  },
  { code: "CREATE_DATABASE", pattern: /\bCREATE\s+(?:DATABASE|SCHEMA)\b/i },
  { code: "CREATE_USER", pattern: /\b(?:CREATE|ALTER|DROP|RENAME)\s+USER\b/i },
  { code: "GRANT", pattern: /\b(?:GRANT|REVOKE)\b/i },
  { code: "DROP_DATABASE", pattern: /\bDROP\s+(?:DATABASE|SCHEMA)\b/i },
  { code: "SET_GLOBAL", pattern: /\bSET\s+(?:GLOBAL|PERSIST|PERSIST_ONLY)\b|@@GLOBAL\./i },
  { code: "LOAD_DATA", pattern: /\bLOAD\s+(?:DATA|XML)\b/i },
  { code: "INTO_OUTFILE", pattern: /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i },
];

/** Remove comentários e literais de texto antes da análise. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(--\s|#).*$/gm, " ")
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

export function findForbiddenConstructs(sql: string): { code: ForbiddenCode }[] {
  const clean = stripCommentsAndStrings(sql);
  return FORBIDDEN.filter(({ pattern }) => pattern.test(clean)).map(({ code }) => ({ code }));
}

export type ManifestProblem = "ARTIFACT_PRODUCT_CODE_INVALID" | "ARTIFACT_PREFIX_MISMATCH";

const PRODUCT_CODE = /^[a-z][a-z0-9]{2,15}$/;

export function validateArtifactManifest(manifest: {
  productCode?: string | undefined;
  databasePrefix?: string | undefined;
}): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  if (!manifest.productCode || !PRODUCT_CODE.test(manifest.productCode)) {
    problems.push("ARTIFACT_PRODUCT_CODE_INVALID");
  } else if (manifest.databasePrefix !== `${manifest.productCode}_`) {
    problems.push("ARTIFACT_PREFIX_MISMATCH");
  }
  return problems;
}

/** Valida um artefato de produto já carregado; lança MigrationError no primeiro problema. */
export function validateArtifact(loaded: LoadedManifest): void {
  const [problem] = validateArtifactManifest(loaded.manifest);
  if (problem) {
    throw new MigrationError(
      "MANIFEST_INVALID",
      `${problem}: productCode/databasePrefix inválidos`,
    );
  }
  for (const migration of loaded.migrations) {
    const found = findForbiddenConstructs(migration.sql);
    if (found.length > 0) {
      throw new MigrationError(
        "ARTIFACT_FORBIDDEN_CONSTRUCT",
        `${migration.name}: construções proibidas (${found.map((f) => f.code).join(", ")})`,
        migration.version,
      );
    }
  }
}
