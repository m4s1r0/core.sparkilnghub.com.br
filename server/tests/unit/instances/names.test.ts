import { describe, expect, it } from "vitest";
import { instanceDatabaseName, instanceUserName } from "../../../src/platform/ids.js";

describe("nomes derivados do UUID da instância (SC-016, constituição I)", () => {
  it("usuário MySQL distinto para UUIDs que só diferem no fim (regressão: sementes A e B)", () => {
    const a = instanceUserName("0192f600-0000-7000-8000-00000000000a");
    const b = instanceUserName("0192f600-0000-7000-8000-00000000000b");
    expect(a).not.toBe(b);
    for (const name of [a, b]) {
      expect(name.length).toBeLessThanOrEqual(32);
      expect(name).toMatch(/^inst_[a-z2-7]{26}$/);
    }
  });

  it("é determinístico e sem perda: UUIDs diferentes nunca compartilham o usuário", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i += 1) {
      const uuid = crypto.randomUUID();
      const name = instanceUserName(uuid);
      expect(instanceUserName(uuid)).toBe(name);
      expect(seen.has(name)).toBe(false);
      seen.add(name);
    }
  });

  it("banco = prefixo + UUID sem hífens", () => {
    expect(instanceDatabaseName("sparkref_", "0192f600-0000-7000-8000-00000000000a")).toBe(
      "sparkref_0192f60000007000800000000000000a",
    );
  });
});
