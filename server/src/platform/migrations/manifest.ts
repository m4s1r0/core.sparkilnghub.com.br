import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import Type, { type Static } from "typebox";
import Value from "typebox/value";

export type MigrationErrorCode =
  | "MANIFEST_INVALID"
  | "MANIFEST_FORMAT_UNSUPPORTED"
  | "MANIFEST_VERSION_SEQUENCE"
  | "MANIFEST_FILE_MISSING"
  | "MANIFEST_CHECKSUM_MISMATCH"
  | "ARTIFACT_FORBIDDEN_CONSTRUCT"
  | "SCHEMA_UNKNOWN_VERSION"
  | "SCHEMA_CHECKSUM_MISMATCH"
  | "SCHEMA_FAILED"
  | "SCHEMA_SEQUENCE"
  | "MIGRATION_FAILED";

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    readonly version?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}

const Entry = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120, pattern: "^[0-9]{4}_[a-z0-9_]+$" }),
    file: Type.String({ pattern: "^migrations/[0-9]{4}_[a-z0-9_]+\\.sql$" }),
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);

const ManifestSchema = Type.Object(
  {
    formatVersion: Type.Integer(),
    artifact: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    productCode: Type.Optional(Type.String()),
    databasePrefix: Type.Optional(Type.String()),
    migrations: Type.Array(Entry, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type Manifest = Static<typeof ManifestSchema>;

export interface LoadedMigration {
  version: number;
  name: string;
  sha256: string;
  sql: string;
}

export interface LoadedManifest {
  dir: string;
  /** `artifact` (bancos do Core) ou `productCode` (artefatos de produto). */
  artifact: string;
  manifest: Manifest;
  migrations: LoadedMigration[];
}

/** Remove BOM e converte CRLF/CR em LF, para checksum estável entre sistemas. */
export function normalizeSql(content: Buffer): string {
  let text = content.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, "\n");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Lê e valida `manifest.json` e seus arquivos (contracts/migration-artifact.md). */
export async function loadManifest(dir: string): Promise<LoadedManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  } catch (error) {
    throw new MigrationError("MANIFEST_INVALID", "manifest.json ausente ou ilegível", undefined, {
      cause: error,
    });
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { formatVersion?: unknown }).formatVersion !== 1
  ) {
    throw new MigrationError("MANIFEST_FORMAT_UNSUPPORTED", "formatVersion suportado: 1");
  }
  if (!Value.Check(ManifestSchema, parsed)) {
    const first = [...Value.Errors(ManifestSchema, parsed)][0];
    throw new MigrationError(
      "MANIFEST_INVALID",
      `manifest.json inválido em ${first?.instancePath || "/"}: ${first?.message ?? "formato"}`,
    );
  }
  const manifest = parsed;
  const artifact = manifest.productCode ?? manifest.artifact;
  if (!artifact)
    throw new MigrationError("MANIFEST_INVALID", "artifact ou productCode obrigatório");

  const root = resolve(dir);
  const migrations: LoadedMigration[] = [];
  for (const [index, entry] of manifest.migrations.entries()) {
    if (entry.version !== index + 1) {
      throw new MigrationError(
        "MANIFEST_VERSION_SEQUENCE",
        `Versões devem ser contíguas a partir de 1; encontrada ${entry.version} na posição ${index + 1}`,
        entry.version,
      );
    }
    const path = resolve(root, entry.file);
    if (!path.startsWith(root + sep)) {
      throw new MigrationError("MANIFEST_INVALID", `Arquivo fora do artefato: ${entry.file}`);
    }
    let content: Buffer;
    try {
      content = await readFile(path);
    } catch (error) {
      throw new MigrationError(
        "MANIFEST_FILE_MISSING",
        `Arquivo ausente: ${entry.file}`,
        entry.version,
        { cause: error },
      );
    }
    const sql = normalizeSql(content);
    if (sha256(sql) !== entry.sha256) {
      throw new MigrationError(
        "MANIFEST_CHECKSUM_MISMATCH",
        `Checksum divergente em ${entry.file}`,
        entry.version,
      );
    }
    migrations.push({ version: entry.version, name: entry.name, sha256: entry.sha256, sql });
  }
  return { dir: root, artifact, manifest, migrations };
}
