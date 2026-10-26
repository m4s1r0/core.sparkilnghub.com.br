import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractApp, fixedStatusService, healthyStatus } from "../support/app.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let ctx: Awaited<ReturnType<typeof contractApp>>;

beforeAll(async () => {
  ctx = await contractApp({ statusService: fixedStatusService(healthyStatus()) });
});
afterAll(async () => ctx?.close());

describe("X-Correlation-Id (conventions.md §3, FR-015)", () => {
  it("sem cabeçalho: gera UUID e devolve", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/health/live" });
    expect(response.headers["x-correlation-id"]).toMatch(UUID);
  });

  it("UUID válido: reutiliza", async () => {
    const id = "0192f6b0-7c1e-7a3b-9d2e-5f8a1c3b4d6e";
    const response = await ctx.app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-correlation-id": id },
    });
    expect(response.headers["x-correlation-id"]).toBe(id);
  });

  it("valor inválido: substitui, sem levar o valor ao log", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/health/live",
      headers: { "x-correlation-id": "abc injected" },
    });
    const id = response.headers["x-correlation-id"] as string;
    expect(id).toMatch(UUID);
    expect(ctx.raw.join("\n")).not.toContain("injected");
  });

  it("mesmo correlationId no corpo de erro, no cabeçalho e na linha de log", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/__test/boom" });
    const id = response.headers["x-correlation-id"] as string;
    expect(response.json<{ error: { correlationId: string } }>().error.correlationId).toBe(id);
    const errorLine = ctx.lines.find((line) => line.level === 50 && line.correlationId === id);
    expect(errorLine).toBeDefined();
    expect(errorLine?.product).toBe("sparkcore");
  });
});
