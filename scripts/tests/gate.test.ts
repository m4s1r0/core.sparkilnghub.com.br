import { describe, expect, it } from "vitest";
import { checkAllSlices, checkSlice, type Slice } from "../lib/gate.js";

const decisions = new Map([
  ["D-01", "confirmada"],
  ["D-04", "proposta"],
] as const);

const slice = (status: Slice["status"], requires: string[]): Slice => ({
  id: "F01",
  status,
  requires,
});

describe("checkSlice (npm run gate -- <fatia>)", () => {
  it("bloqueia (saída 3) e lista as decisões não confirmadas", () => {
    const result = checkSlice(slice("especificando", ["D-01", "D-04"]), decisions);
    expect(result.exitCode).toBe(3);
    expect(result.pending).toEqual(["D-04"]);
  });

  it("trata decisão inexistente como pendente", () => {
    expect(checkSlice(slice("especificando", ["D-77"]), decisions).pending).toEqual(["D-77"]);
  });

  it("libera (saída 0) quando todas estão confirmadas", () => {
    expect(checkSlice(slice("especificando", ["D-01"]), decisions).exitCode).toBe(0);
  });
});

describe("checkAllSlices (verificação global)", () => {
  it.each(["pronta", "em-implementacao", "concluida"] as const)(
    "falha (saída 3) para fatia %s com decisão pendente",
    (status) => {
      const result = checkAllSlices([slice(status, ["D-04"])], decisions);
      expect(result.exitCode).toBe(3);
      expect(result.violations).toEqual([{ slice: "F01", status, pending: ["D-04"] }]);
    },
  );

  it("passa (saída 0) para fatia especificando com decisão pendente", () => {
    expect(checkAllSlices([slice("especificando", ["D-04"])], decisions).exitCode).toBe(0);
  });
});
