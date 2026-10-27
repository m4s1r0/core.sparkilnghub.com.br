import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US4 (quickstart §4): convidar colaborador na instância sintética A (sementes), aceitar em
// contexto anônimo com conta nova, mudar papel, revogar o vínculo e revogar convite pendente.
// A reautenticação não é forçada aqui (exigiria esperar 5 min); o diálogo é coberto pelos testes
// de componente e a regra, pela integração.
test.describe.configure({ timeout: 180_000 });

test("vínculos: convite, aceite, papel e revogações", async ({ browser }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const admin = await browser.newContext();
  const page = await admin.newPage();
  await onboardAdmin(page, `e2e-vinculos-${stamp}@example.test`);

  await page.getByRole("link", { name: "Instâncias" }).click();
  await page.getByRole("link", { name: "[SINTÉTICO] Instância A" }).click();
  // Desde F02 a lista leva ao detalhe; os vínculos ficam na aba "Vínculos".
  await page.getByRole("tab", { name: "Vínculos" }).click();
  await page.getByRole("link", { name: "Vínculos de [SINTÉTICO] Instância A" }).click();
  await expect(
    page.getByRole("heading", { name: "Vínculos de [SINTÉTICO] Instância A" }),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  const invite = async (email: string) => {
    await page.getByRole("button", { name: "Convidar", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("E-mail").fill(email);
    await dialog.getByLabel("Papel").selectOption("colaborador");
    await dialog.getByRole("button", { name: "Gerar convite" }).click();
    const link = await page.getByLabel("Link de uso único").inputValue();
    await page.getByRole("button", { name: "Concluir" }).click();
    await page.getByRole("button", { name: "Fechar sem copiar" }).click();
    return link;
  };

  const memberName = `[SINTÉTICO] Membro ${stamp}`;
  const link = await invite(`e2e-membro-${stamp}@example.test`);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(link).pathname);
  await guestPage.getByLabel("Seu nome").fill(memberName);
  await guestPage
    .getByRole("textbox", { name: "Senha", exact: true })
    .fill("senha do membro e2e longa");
  await guestPage
    .getByRole("textbox", { name: "Repita a senha" })
    .fill("senha do membro e2e longa");
  await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guestPage.getByText("Acesso liberado")).toBeVisible();
  await expectNoSeriousAxe(guestPage);
  await guest.close();

  await page.reload();
  const actions = page.getByRole("button", { name: `Ações para ${memberName}` });
  await actions.click();
  await page.getByRole("menuitem", { name: "Mudar papel" }).click();
  await page.getByLabel("Novo papel").selectOption("administrador");
  await page.getByLabel("Motivo").fill("promoção no teste E2E");
  await page.getByRole("button", { name: `Mudar papel de ${memberName}` }).click();
  await expect(page.getByText(`Papel de ${memberName} alterado.`)).toBeVisible();

  await actions.click();
  await page.getByRole("menuitem", { name: "Revogar acesso" }).click();
  await page.getByLabel("Motivo").fill("fim do teste E2E");
  await page.getByRole("button", { name: /^Revogar acesso de/ }).click();
  await expect(page.getByText(`Acesso de ${memberName} revogado.`)).toBeVisible();

  const pendingEmail = `e2e-pendente-${stamp}@example.test`;
  const pendingLink = await invite(pendingEmail);
  await page
    .getByRole("row")
    .filter({ hasText: "Convite pendente" })
    .filter({ hasText: `e***@example.test` })
    .last()
    .getByRole("button", { name: /Ações para/ })
    .click();
  await page.getByRole("menuitem", { name: "Revogar convite" }).click();
  await page.getByLabel("Motivo").fill("convite de teste");
  await page.getByRole("button", { name: /^Revogar convite de/ }).click();
  await expect(page.getByText(/Convite de .* revogado\./)).toBeVisible();
  await page.goto(new URL(pendingLink).pathname);
  await expect(page.getByText("Convite inválido ou expirado")).toBeVisible();
  await admin.close();
});
