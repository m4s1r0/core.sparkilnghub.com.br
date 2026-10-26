import { describe, expect, it, vi } from "vitest";
import { assertEnvironment, EnvGuardError } from "../../../src/platform/config/env-guard.js";
import { loadConfig } from "../../../src/platform/config/load.js";
import type { Env } from "../../../src/platform/config/schema.js";
import { createLogger } from "../../../src/platform/logging/logger.js";

const config = (env: Env) => loadConfig({ env: { SPARK_ENV: env } });
const logger = createLogger({ level: "silent" });

describe("assertEnvironment (FR-011, FR-028; constituição IV)", () => {
  it("recusa SPARK_ENV não permitido sem consultar o banco", async () => {
    const readMarker = vi.fn();
    await expect(
      assertEnvironment(["development"], "dev:reset", {
        config: config("production"),
        logger,
        readMarker,
      }),
    ).rejects.toSatisfy((e) => e instanceof EnvGuardError && e.exitCode === 2);
    expect(readMarker).not.toHaveBeenCalled();
  });

  it("recusa marcador divergente de SPARK_ENV", async () => {
    await expect(
      assertEnvironment(["development", "homologation"], "db:seed", {
        config: config("development"),
        logger,
        readMarker: () => Promise.resolve("production"),
      }),
    ).rejects.toBeInstanceOf(EnvGuardError);
  });

  it("permite com marcador ausente (antes da primeira migração) ou coerente", async () => {
    for (const marker of [null, "development"] as const) {
      await expect(
        assertEnvironment(["development"], "dev:reset", {
          config: config("development"),
          logger,
          readMarker: () => Promise.resolve(marker),
        }),
      ).resolves.toBeUndefined();
    }
  });

  it("registra env_guard_refused com comando, SPARK_ENV e marcador", async () => {
    const warn = vi.fn();
    await expect(
      assertEnvironment(["development"], "db:seed", {
        config: config("homologation"),
        logger: { warn } as unknown as typeof logger,
      }),
    ).rejects.toBeInstanceOf(EnvGuardError);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "env_guard_refused",
        command: "db:seed",
        sparkEnv: "homologation",
      }),
      expect.any(String),
    );
  });
});
