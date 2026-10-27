import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, login, onboardAdmin } from "./support";

// Jornada real contra o servidor (US1, quickstart §1): convite → senha → TOTP → painel → sair →
// entrar em dois passos. Cada projeto (360 e 1280 px) usa a própria conta.
test.describe.configure({ timeout: 180_000 });

test("primeiro acesso, login em dois passos e logout", async ({ page }, testInfo) => {
  const email = `e2e-${testInfo.project.name}-${Date.now()}@example.test`;
  const admin = await onboardAdmin(page, email);

  // Situação real servida pelo SparkCore, agora atrás da sessão.
  await expect(page.getByRole("table")).toBeVisible();
  if (process.env.E2E_EXPECT_HEALTHY === "1") {
    await expect(page.getByText(/Situação atualizada às/)).toBeVisible();
  }
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar no SparkCore" })).toBeVisible();
  // O cookie antigo não autentica mais.
  await page.goto("/");
  await expect(page).toHaveURL(/\/entrar$/);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  await login(page, admin);
  await expect(page.getByRole("heading", { level: 1, name: "Situação do sistema" })).toBeVisible();
});

test("teclado: formulário de entrada navegável e senha errada com mensagem genérica", async ({
  page,
}) => {
  await page.goto("/entrar");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("E-mail")).toBeFocused();
  // E-mail único: falhas acumuladas entre execuções ativariam a limitação (429).
  await page.keyboard.type(`ninguem-${Date.now()}@example.test`);
  await page.keyboard.press("Tab");
  await page.keyboard.type("senha errada qualquer");
  await page.keyboard.press("Enter");
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
  await expectNoSeriousAxe(page);
});

// US2 (quickstart §2): convidar um segundo administrador pelo painel e inativá-lo com motivo.
// "Último administrador" depende de haver um único ativo; no banco compartilhado de
// desenvolvimento isso não é garantido, e a regra fica provada na integração (100 rodadas
// concorrentes) e no teste de componente da página.
test("equipe: convidar segundo administrador e inativar com motivo", async ({
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const ana = await browser.newContext();
  const anaPage = await ana.newPage();
  await onboardAdmin(anaPage, `e2e-ana-${stamp}@example.test`);

  await anaPage.getByRole("link", { name: "Administradores" }).click();
  await expect(
    anaPage.getByRole("heading", { name: "Administradores da plataforma" }),
  ).toBeVisible();
  await anaPage.getByRole("button", { name: "Convidar administrador" }).click();
  const brunoEmail = `e2e-bruno-${stamp}@example.test`;
  await anaPage.getByRole("dialog").getByLabel("E-mail").fill(brunoEmail);
  await anaPage.getByRole("button", { name: "Gerar convite" }).click();
  const link = await anaPage.getByLabel("Link de uso único").inputValue();
  expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
  await anaPage.getByRole("button", { name: "Concluir" }).click();
  await anaPage.getByRole("button", { name: "Fechar sem copiar" }).click();
  await expectNoHorizontalScroll(anaPage);
  await expectNoSeriousAxe(anaPage);

  const bruno = await browser.newContext();
  const brunoPage = await bruno.newPage();
  await onboardAdmin(brunoPage, brunoEmail, link.slice(link.lastIndexOf("/") + 1));

  await anaPage.reload();
  await anaPage
    .getByRole("row")
    .filter({ hasText: brunoEmail })
    .getByRole("button", { name: /Ações para/ })
    .click();
  await anaPage.getByRole("menuitem", { name: "Inativar" }).click();
  await anaPage.getByLabel("Motivo").fill("teste E2E de inativação");
  await anaPage.getByRole("button", { name: /Inativar acesso de/ }).click();
  await expect(anaPage.getByText(/inativado\.$/)).toBeVisible();

  // A sessão do administrador inativado deixa de valer.
  await brunoPage.goto("/");
  await expect(brunoPage).toHaveURL(/\/entrar$/);
  await ana.close();
  await bruno.close();
});
