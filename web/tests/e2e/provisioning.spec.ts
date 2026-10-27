import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US3 (quickstart §3): contratante sintético → nova instância do produto de referência →
// protocolo → etapas até PRONTA, com o trabalhador real rodando no ambiente do E2E.
test.describe.configure({ timeout: 240_000 });

test("provisionamento: solicitação guiada até a instância pronta e convite inicial", async ({
  page,
  browser,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await onboardAdmin(page, `e2e-provisionamento-${stamp}@example.test`);

  await page.goto("/instancias/nova");
  await expect(page.getByRole("heading", { level: 1, name: "Nova instância" })).toBeVisible();
  await page
    .getByLabel("Contratante")
    .selectOption({ label: "[SINTÉTICO] Contratante de referência" });
  await expect(page.getByRole("option", { name: /SparkPet —/ })).toBeDisabled();
  await page.getByLabel("Produto").selectOption("sparkref");
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Continuar" }).click();

  const slug = `Loja E2E ${stamp}`;
  await page.getByLabel("Nome de exibição").fill(`[SINTÉTICO] Loja ${stamp}`);
  await page.getByLabel("Identificador de acesso").fill(`${slug}!`);
  await page.getByLabel("E-mail do administrador inicial").fill(`dona-${stamp}@example.test`);
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Revisar" }).click();

  const normalized = `loja-e2e-${stamp.toLowerCase()}`;
  await expect(page.getByText(normalized, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar e solicitar" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: /^Provisionamento PRV-\d{6,}$/ }),
  ).toBeVisible();
  await expect(page.getByText("Instância pronta")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Pronta", { exact: true }).first()).toBeVisible();
  // Nenhuma credencial na página.
  const text = (await page.locator("main").textContent()) ?? "";
  expect(text).not.toMatch(/senha|password|inst_[a-z2-7]{20,}/i);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  // US5 (quickstart §5): emitir o link do convite inicial e aceitar em contexto anônimo.
  await expect(page.getByText("Aguardando emissão do link")).toBeVisible();
  await page.getByRole("button", { name: "Emitir link" }).click();
  const link = await page.getByLabel("Link de uso único").inputValue();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.getByRole("button", { name: "Fechar sem copiar" }).click();
  await expect(page.getByText("Link emitido")).toBeVisible();

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(link).pathname);
  await guestPage.getByLabel("Seu nome").fill(`[SINTÉTICO] Dona ${stamp}`);
  await guestPage
    .getByRole("textbox", { name: "Senha", exact: true })
    .fill("senha da dona da loja e2e");
  await guestPage
    .getByRole("textbox", { name: "Repita a senha" })
    .fill("senha da dona da loja e2e");
  await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guestPage.getByText("Acesso liberado")).toBeVisible();
  await expectNoSeriousAxe(guestPage);
  await guest.close();

  await page.reload();
  await expect(page.getByText("Aceito", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Emitir link|Reemitir link/ })).toHaveCount(0);
});
