import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";

const CORRELATION = "0192f6b0-7c1e-7a3b-9d2e-5f8a1c3b4d6e";
const STATUS_URL = "**/api/v1/system/status";

function body(status: "SAUDAVEL" | "INDISPONIVEL" = "SAUDAVEL") {
  const checkedAt = new Date().toISOString();
  const db = status === "SAUDAVEL" ? "SAUDAVEL" : "INDISPONIVEL";
  return {
    service: "sparkcore",
    version: "0.1.0",
    environment: "development",
    status,
    checkedAt,
    components: [
      { name: "server", status: "SAUDAVEL", reason: null, checkedAt },
      { name: "worker", status: "SAUDAVEL", reason: null, checkedAt },
      {
        name: "spark_core",
        status: db,
        schemaVersion: 2,
        expectedSchemaVersion: 2,
        reason: db === "SAUDAVEL" ? null : "DB_UNREACHABLE",
        checkedAt,
      },
      {
        name: "spark_identity",
        status: db,
        schemaVersion: 1,
        expectedSchemaVersion: 1,
        reason: db === "SAUDAVEL" ? null : "DB_UNREACHABLE",
        checkedAt,
      },
    ],
  };
}

const fulfill = (route: Route, status: number, json: unknown) =>
  route.fulfill({ status, json, headers: { "x-correlation-id": CORRELATION } });

// Desde F01 a página exige sessão; aqui a sessão é simulada e só a apresentação é testada. A
// situação real, com login de verdade, está em auth.spec.ts.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/session", (route) =>
    fulfill(route, 200, {
      account: { id: CORRELATION, displayName: "[SINTÉTICO] Ana", email: "ana@example.test" },
      mfa: { enrolled: true, confirmed: true, reauthValidUntil: null },
      platformRole: "administrador",
    }),
  );
});

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("carregando: texto e região ocupada, sem números", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(STATUS_URL, async (route) => {
    await gate;
    await fulfill(route, 200, body());
  });
  await page.goto("/");
  const region = page.getByTestId("status-region");
  await expect(page.getByText("Consultando situação…")).toBeVisible();
  await expect(region).toHaveAttribute("aria-busy", "true");
  expect(await region.textContent()).not.toMatch(/\d/);
  release();
  await expect(page.getByRole("table")).toBeVisible();
});

test("sucesso, teclado e foco visível", async ({ page }) => {
  await page.route(STATUS_URL, (route) => fulfill(route, 200, body()));
  await page.goto("/");
  await expect(page.getByRole("table")).toBeVisible();
  // Navegação do painel e "Sair" vêm antes no cabeçalho (F01); segue por Tab até o botão.
  const refresh = page.getByRole("button", { name: "Atualizar situação" });
  for (let i = 0; i < 10 && !(await refresh.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(refresh).toBeFocused();
  const outline = await refresh.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Situação atualizada às/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("503: aviso e tabela com o corpo recebido", async ({ page }) => {
  await page.route(STATUS_URL, (route) => fulfill(route, 503, body("INDISPONIVEL")));
  await page.goto("/");
  await expect(page.getByText("Um ou mais componentes estão indisponíveis")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Banco inacessível");
  await expectNoHorizontalScroll(page);
});

test("erro 500 e falha de rede: mensagem segura e Tentar novamente", async ({ page }) => {
  let calls = 0;
  await page.route(STATUS_URL, (route) => {
    calls += 1;
    if (calls === 1) {
      return fulfill(route, 500, {
        error: {
          code: "INTERNAL_ERROR",
          message: "Ocorreu uma falha inesperada.",
          field: null,
          retryable: false,
          correlationId: CORRELATION,
        },
      });
    }
    return route.abort("failed");
  });
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Ocorreu uma falha inesperada.");
  await expect(alert).toContainText(CORRELATION);
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(alert).toContainText("Não foi possível consultar a situação");
  await expectNoHorizontalScroll(page);
});

test("acessibilidade (axe, sinal adicional — sem alegar conformidade)", async ({ page }) => {
  await page.route(STATUS_URL, (route) => fulfill(route, 200, body()));
  await page.goto("/");
  await expect(page.getByRole("table")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
