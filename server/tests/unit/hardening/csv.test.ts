import { describe, expect, it } from "vitest";
import { sanitizeCsvCell, toCsv } from "../../../src/lib/csv.js";

/** SEC-21 / SEC-BASE-21: TAB e CR iniciais também abrem fórmula em planilhas. */
describe("SEC-21 — neutralização de fórmulas no CSV", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\t=1+1", "\r=1+1", "\t", "\r"])(
    "neutraliza %j",
    (value) => {
      expect(sanitizeCsvCell(value)).toBe(`'${value}`);
    },
  );

  it("valores comuns não mudam", () => {
    expect(sanitizeCsvCell("Ana")).toBe("Ana");
    expect(sanitizeCsvCell(" =1")).toBe(" =1");
    expect(sanitizeCsvCell(null)).toBe("");
  });

  it("toCsv aplica a neutralização com aspas quando há CR", () => {
    const csv = toCsv([{ v: "\r=1+1" }, { v: "\t=2" }], [{ key: "v", label: "V" }], {
      generated_at: "2026-11-15T00:00:00Z",
    });
    expect(csv).toContain(`"'\r=1+1"`);
    expect(csv).toContain(`'\t=2`);
  });
});
