/**
 * Neutraliza fórmulas em células CSV: prefixa com `'` valores que começam com `=`, `+`, `-` ou
 * `@` para prevenir CSV Injection (OWASP, SC-041). O cabeçalho nunca começa com esses caracteres.
 */
export function sanitizeCsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/** Converte um array de objetos em string CSV com cabeçalho. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  meta: { generated_at: string; filters?: string },
): string {
  const lines: string[] = [];
  lines.push(`# Gerado em: ${meta.generated_at}`);
  if (meta.filters) lines.push(`# Filtros: ${meta.filters}`);
  lines.push(columns.map((c) => csvQuote(c.label)).join(","));
  for (const row of rows) {
    lines.push(
      columns.map((c) => csvQuote(sanitizeCsvCell(row[c.key] as string | null))).join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function csvQuote(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}
