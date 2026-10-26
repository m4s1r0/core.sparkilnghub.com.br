import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAdr, validateTransition } from "../lib/adr.js";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "fixtures", "adr", name), "utf8");

const SECTIONS = "## Contexto\n\n## Decisão\n\n## Alternativas rejeitadas\n\n## Consequências\n";
const adr = (frontmatter: string, body = SECTIONS) => `---\n${frontmatter}\n---\n\n${body}`;

const codes = (content: string) => validateAdr(content, "teste.md").map((p) => p.code);

describe("validateAdr", () => {
  it("aceita ADR confirmada completa", () => {
    expect(validateAdr(fixture("valida-confirmada.md"), "valida-confirmada.md")).toEqual([]);
  });

  it("recusa frontmatter sem campo obrigatório", () => {
    expect(codes(adr("id: D-92\nstatus: proposta\nrequirements: [COM-001]"))).toContain(
      "ADR_FIELD_MISSING",
    );
  });

  it("recusa status fora de proposta|confirmada|substituída", () => {
    expect(codes(adr("id: D-93\ntitle: x\nstatus: aprovada\nrequirements: []"))).toContain(
      "ADR_STATUS_INVALID",
    );
  });

  it("recusa confirmada sem owner", () => {
    expect(validateAdr(fixture("sem-owner.md"), "sem-owner.md").map((p) => p.code)).toContain(
      "ADR_CONFIRMED_INCOMPLETE",
    );
  });

  it("recusa confirmada sem date", () => {
    expect(
      codes(adr("id: D-94\ntitle: x\nstatus: confirmada\nowner: alguém\nrequirements: []")),
    ).toContain("ADR_CONFIRMED_INCOMPLETE");
  });

  it("recusa substituída sem superseded_by ou sem impacts", () => {
    expect(
      codes(adr("id: D-95\ntitle: x\nstatus: substituída\nrequirements: []\nimpacts: [COM-1]")),
    ).toContain("ADR_SUPERSEDED_INCOMPLETE");
    expect(
      codes(adr("id: D-96\ntitle: x\nstatus: substituída\nrequirements: []\nsuperseded_by: D-97")),
    ).toContain("ADR_SUPERSEDED_INCOMPLETE");
  });

  it("recusa o campo blocks (fonte única é docs/slices.yaml)", () => {
    expect(
      codes(adr("id: D-98\ntitle: x\nstatus: proposta\nrequirements: []\nblocks: [F01]")),
    ).toContain("ADR_FIELD_FORBIDDEN");
  });

  it("recusa seção obrigatória ausente", () => {
    expect(
      codes(adr("id: D-99\ntitle: x\nstatus: proposta\nrequirements: []", "## Contexto\n")),
    ).toContain("ADR_SECTION_MISSING");
  });
});

describe("validateTransition", () => {
  it.each([
    ["proposta", "confirmada"],
    ["proposta", "substituída"],
    ["confirmada", "substituída"],
    ["confirmada", "confirmada"],
  ] as const)("permite %s → %s", (from, to) => {
    expect(validateTransition(from, to)).toBeNull();
  });

  it.each([
    ["confirmada", "proposta"],
    ["substituída", "confirmada"],
    ["substituída", "proposta"],
  ] as const)("recusa %s → %s em relação à versão de main", (from, to) => {
    expect(validateTransition(from, to)?.code).toBe("ADR_TRANSITION_INVALID");
  });
});
