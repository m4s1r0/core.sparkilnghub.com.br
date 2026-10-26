import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contractApp, fixedStatusService, healthyStatus } from "../support/app.js";

let ctx: Awaited<ReturnType<typeof contractApp>>;

beforeAll(async () => {
  ctx = await contractApp({ statusService: fixedStatusService(healthyStatus()) });
});
afterAll(async () => ctx?.close());

describe("erros seguros (FR-016, CS-006)", () => {
  it("500 com mensagem genérica, sem SQL, pilha, caminho ou senha", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/__test/boom" });
    expect(response.statusCode).toBe(500);
    const body = response.body;
    expect(body).not.toMatch(/SELECT|INSERT|Duplicate entry|segredo123|ana@example\.test/);
    expect(body).not.toMatch(/\bat\s|\.ts:|\.js:|[A-Z]:\\|\/src\//);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("INTERNAL_ERROR");
  });

  it("log tem pilha e a mesma correlação, sem senha, token nem valores de parâmetros SQL", async () => {
    ctx.raw.length = 0;
    const response = await ctx.app.inject({ method: "GET", url: "/__test/boom" });
    const id = response.headers["x-correlation-id"] as string;
    const logged = ctx.raw.join("\n");
    expect(logged).toContain(id);
    expect(logged).toMatch(/"stack":/);
    expect(logged).toContain("ER_DUP_ENTRY");
    expect(logged).not.toMatch(/segredo123|ana@example\.test|Duplicate entry|INSERT INTO/);
  });

  it("campos sensíveis em qualquer profundidade são redigidos", () => {
    ctx.raw.length = 0;
    ctx.logger.info(
      {
        request: { headers: { authorization: "Bearer abc", cookie: "s=1" } },
        db: { password: "x", dsn: "mysql://u:p@h" },
      },
      "teste",
    );
    const logged = ctx.raw.join("\n");
    expect(logged).not.toMatch(/Bearer abc|s=1|mysql:\/\/|"password":"x"/);
    expect(logged).toContain("[REDACTED]");
  });
});
