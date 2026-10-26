import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { readAdr } from "./adr.js";

export const SLICE_STATUSES = ["especificando", "pronta", "em-implementacao", "concluida"] as const;
export type SliceStatus = (typeof SLICE_STATUSES)[number];

export interface Slice {
  id: string;
  status: SliceStatus;
  requires: string[];
}

export type Decisions = ReadonlyMap<string, string>;

/** `npm run gate -- <fatia>`: pode a fatia entrar em implementação? Saída 3 se não. */
export function checkSlice(slice: Slice, decisions: Decisions) {
  const pending = slice.requires.filter((id) => decisions.get(id) !== "confirmada");
  return { exitCode: pending.length > 0 ? 3 : 0, pending };
}

/** Verificação global: nenhuma fatia `pronta` ou posterior com decisão pendente (FR-003). */
export function checkAllSlices(slices: Slice[], decisions: Decisions) {
  const violations = slices
    .filter((slice) => slice.status !== "especificando")
    .map((slice) => ({
      slice: slice.id,
      status: slice.status,
      pending: checkSlice(slice, decisions).pending,
    }))
    .filter((violation) => violation.pending.length > 0);
  return { exitCode: violations.length > 0 ? 3 : 0, violations };
}

export function loadSlices(repoRoot: string): Slice[] {
  const data = parse(readFileSync(join(repoRoot, "docs", "slices.yaml"), "utf8")) as {
    slices?: Slice[];
  };
  const slices = data.slices ?? [];
  for (const slice of slices) {
    if (!(SLICE_STATUSES as readonly string[]).includes(slice.status)) {
      throw new Error(`Fatia ${slice.id}: status inválido ${String(slice.status)}`);
    }
    if (!Array.isArray(slice.requires))
      throw new Error(`Fatia ${slice.id}: requires deve ser lista`);
  }
  return slices;
}

export function loadDecisions(repoRoot: string): Map<string, string> {
  const dir = join(repoRoot, "docs", "adr");
  const decisions = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => /^\d{4}-.+\.md$/.test(f))) {
    const adr = readAdr(readFileSync(join(dir, file), "utf8"));
    if (adr?.id) decisions.set(adr.id, adr.status);
  }
  return decisions;
}
