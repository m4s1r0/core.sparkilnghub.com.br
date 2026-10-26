import { parse } from "yaml";

export const ADR_STATUSES = ["proposta", "confirmada", "substituída"] as const;
export type AdrStatus = (typeof ADR_STATUSES)[number];

export const REQUIRED_SECTIONS = [
  "Contexto",
  "Decisão",
  "Alternativas rejeitadas",
  "Consequências",
];

export interface Problem {
  file: string;
  code:
    | "ADR_FRONTMATTER_INVALID"
    | "ADR_FIELD_MISSING"
    | "ADR_FIELD_FORBIDDEN"
    | "ADR_STATUS_INVALID"
    | "ADR_CONFIRMED_INCOMPLETE"
    | "ADR_SUPERSEDED_INCOMPLETE"
    | "ADR_DATE_INVALID"
    | "ADR_SECTION_MISSING"
    | "ADR_TRANSITION_INVALID";
  message: string;
}

export interface Adr {
  id: string;
  title: string;
  status: AdrStatus;
  date?: string;
  owner?: string;
  supersedes?: string;
  superseded_by?: string;
  requirements: string[];
  impacts?: string[];
}

/** Separa o frontmatter YAML do corpo Markdown. */
export function splitFrontmatter(content: string): { data: unknown; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return null;
  return { data: parse(match[1] ?? "") as unknown, body: match[2] ?? "" };
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Valida uma ADR conforme data-model.md (Registro de decisão). */
export function validateAdr(content: string, file: string): Problem[] {
  const problems: Problem[] = [];
  const add = (code: Problem["code"], message: string) => problems.push({ file, code, message });

  const parts = splitFrontmatter(content);
  if (!parts || typeof parts.data !== "object" || parts.data === null) {
    add("ADR_FRONTMATTER_INVALID", "Frontmatter YAML ausente ou inválido");
    return problems;
  }
  const data = parts.data as Record<string, unknown>;

  for (const field of ["id", "title", "status"]) {
    if (!isNonEmptyString(data[field]))
      add("ADR_FIELD_MISSING", `Campo obrigatório ausente: ${field}`);
  }
  if (!Array.isArray(data.requirements)) {
    add("ADR_FIELD_MISSING", "Campo obrigatório ausente: requirements (lista)");
  }
  if ("blocks" in data) {
    add(
      "ADR_FIELD_FORBIDDEN",
      "Campo blocks não é permitido: quais fatias exigem a decisão fica em docs/slices.yaml",
    );
  }

  const status = data.status;
  if (isNonEmptyString(status) && !(ADR_STATUSES as readonly string[]).includes(status)) {
    add("ADR_STATUS_INVALID", `Status inválido: ${status} (use ${ADR_STATUSES.join(" | ")})`);
  }
  if (status === "confirmada" && (!isNonEmptyString(data.date) || !isNonEmptyString(data.owner))) {
    add("ADR_CONFIRMED_INCOMPLETE", "Decisão confirmada exige date e owner");
  }
  if (
    status === "substituída" &&
    (!isNonEmptyString(data.superseded_by) ||
      !Array.isArray(data.impacts) ||
      data.impacts.length === 0)
  ) {
    add("ADR_SUPERSEDED_INCOMPLETE", "Decisão substituída exige superseded_by e impacts");
  }
  if (
    data.date !== undefined &&
    !(typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date))
  ) {
    add("ADR_DATE_INVALID", "date deve estar em YYYY-MM-DD");
  }

  for (const section of REQUIRED_SECTIONS) {
    const heading = new RegExp(`^##\\s+${section}\\s*$`, "m");
    if (!heading.test(parts.body))
      add("ADR_SECTION_MISSING", `Seção obrigatória ausente: ${section}`);
  }
  return problems;
}

export function readAdr(content: string): Adr | null {
  const parts = splitFrontmatter(content);
  if (!parts || typeof parts.data !== "object" || parts.data === null) return null;
  return parts.data as Adr;
}

const TRANSITIONS: Record<AdrStatus, readonly AdrStatus[]> = {
  proposta: ["proposta", "confirmada", "substituída"],
  confirmada: ["confirmada", "substituída"],
  substituída: ["substituída"],
};

/** Compara o status atual com o da versão em `main` (data-model.md, Transições). */
export function validateTransition(from: AdrStatus, to: AdrStatus, file = ""): Problem | null {
  if (TRANSITIONS[from]?.includes(to)) return null;
  return { file, code: "ADR_TRANSITION_INVALID", message: `Transição inválida: ${from} → ${to}` };
}
