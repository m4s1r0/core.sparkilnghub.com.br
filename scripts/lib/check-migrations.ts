import { normalizeSql } from "../../server/src/platform/migrations/manifest.js";

export interface MigrationProblem {
  code: "MIGRATION_CHANGED" | "MIGRATION_REMOVED" | "DROP_DATABASE_IN_APP";
  file: string;
  line?: number;
  message: string;
}

/** Diretórios cujos arquivos, uma vez em `main`, são imutáveis (FR-019). */
export const MIGRATION_ROOTS = ["server/migrations/", "server/reference-product/"];

/**
 * Compara as migrações atuais com as publicadas na branch base (`origin/main` ou a base da PR). Alterar ou remover arquivo
 * publicado falha; acrescentar nova versão passa. Conteúdo comparado já normalizado (LF, sem BOM).
 */
export function checkImmutable(
  current: ReadonlyMap<string, string>,
  base: ReadonlyMap<string, string>,
): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  for (const [file, content] of base) {
    if (!file.endsWith(".sql") || !MIGRATION_ROOTS.some((root) => file.startsWith(root))) continue;
    const now = current.get(file);
    if (now === undefined) {
      problems.push({
        code: "MIGRATION_REMOVED",
        file,
        message: "Migração publicada foi removida",
      });
    } else if (normalizeSql(Buffer.from(now)) !== normalizeSql(Buffer.from(content))) {
      problems.push({
        code: "MIGRATION_CHANGED",
        file,
        message: "Migração publicada foi alterada; crie uma nova versão",
      });
    }
  }
  return problems;
}

/**
 * Único arquivo de server/src autorizado a conter o texto, como lista do que o validador de
 * artefatos recusa (constituição IV, v1.1.1).
 */
export const ALLOWED_DROP_FILE = "server/src/platform/migrations/artifact-validator.ts";

const DROP_DATABASE = /\bDROP\s+(?:DATABASE|SCHEMA)\b/i;

/** A aplicação (server/src) nunca contém DROP DATABASE (constituição IV, v1.1.1). */
export function checkNoDropDatabase(
  files: { path: string; content: string }[],
): MigrationProblem[] {
  const problems: MigrationProblem[] = [];
  for (const { path, content } of files) {
    if (!path.startsWith("server/src/") || path === ALLOWED_DROP_FILE) continue;
    content.split(/\r?\n/).forEach((text, index) => {
      if (DROP_DATABASE.test(text)) {
        problems.push({
          code: "DROP_DATABASE_IN_APP",
          file: path,
          line: index + 1,
          message: "DROP DATABASE não é permitido no código da aplicação",
        });
      }
    });
  }
  return problems;
}
