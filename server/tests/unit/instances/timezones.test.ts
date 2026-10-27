import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  isSupportedTimezone,
  SUPPORTED_TIMEZONES,
} from "../../../src/modules/instances/timezones.js";

describe("fusos suportados (D-09)", () => {
  it("padrão America/Sao_Paulo, entre as zonas brasileiras conhecidas pelo runtime", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Sao_Paulo");
    expect(SUPPORTED_TIMEZONES).toContain("America/Sao_Paulo");
    expect(SUPPORTED_TIMEZONES).toContain("America/Manaus");
    expect(SUPPORTED_TIMEZONES).toContain("America/Noronha");
    const known = new Set(Intl.supportedValuesOf("timeZone"));
    for (const zone of SUPPORTED_TIMEZONES) expect(known.has(zone)).toBe(true);
  });

  it("recusa zona inexistente ou fora do Brasil", () => {
    expect(isSupportedTimezone("America/Sao_Paulo")).toBe(true);
    expect(isSupportedTimezone("Europe/Lisbon")).toBe(false);
    expect(isSupportedTimezone("America/Nowhere")).toBe(false);
    expect(isSupportedTimezone("")).toBe(false);
  });
});
