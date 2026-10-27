import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US5 (quickstart §5): pedido em /recuperar, pedido na fila de /contas, link gerado pelo
// administrador, troca de senha, prévia de bloqueio com A e B, bloqueio e desbloqueio. Usa um
// membro novo (as contas das sementes ficam intactas para o quickstart).
test.describe.configure({ timeout: 240_000 });

async function inviteTo(page: Page, instance: string, email: string): Promise<string> {
  await page.goto("/instancias");
  await page.getByRole("link", { name: instance }).click();
  // Desde F02 a lista leva ao detalhe; os vínculos ficam na aba "Vínculos".
  await page.getByRole("tab", { name: "Vínculos" }).click();
  await page.getByRole("link", { name: `Vínculos de ${instance}` }).click();
  await page.getByRole("button", { name: "Convidar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("E-mail").fill(email);
  await dialog.getByRole("button", { name: "Gerar convite" }).click();
  const link = await page.getByLabel("Link de uso único").inputValue();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.getByRole("button", { name: "Fechar sem copiar" }).click();
  return new URL(link).pathname;
}

test("recuperação de senha, bloqueio e desbloqueio", async ({ browser }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await onboardAdmin(admin, `e2e-contas-${stamp}@example.test`);

  // Membro novo com vínculos em A e B.
  const email = `e2e-carla-${stamp}@example.test`;
  const name = `[SINTÉTICO] Carla ${stamp}`;
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(await inviteTo(admin, "[SINTÉTICO] Instância A", email));
  await guest.getByLabel("Seu nome").fill(name);
  await guest.getByRole("textbox", { name: "Senha", exact: true }).fill("senha inicial longa ok");
  await guest.getByRole("textbox", { name: "Repita a senha" }).fill("senha inicial longa ok");
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest.getByText("Acesso liberado")).toBeVisible();
  await guest.goto(await inviteTo(admin, "[SINTÉTICO] Instância B", email));
  await guest.getByLabel("Senha atual").fill("senha inicial longa ok");
  await guest.getByRole("button", { name: "Aceitar convite" }).click();
  await expect(guest.getByText("Acesso liberado")).toBeVisible();

  // Pedido público de recuperação: mensagem neutra.
  await guest.goto("/recuperar");
  await guest.getByLabel("E-mail").fill(email);
  await guest.getByRole("button", { name: "Pedir recuperação" }).click();
  await expect(guest.getByText(/Se houver conta com este e-mail/)).toBeVisible();
  await expectNoHorizontalScroll(guest);
  await expectNoSeriousAxe(guest);

  // Administrador encontra o pedido na fila e gera o link.
  await admin.getByRole("link", { name: "Contas" }).click();
  await admin
    .getByRole("row")
    .filter({ hasText: email })
    .getByRole("link", { name: "Abrir conta" })
    .click();
  await expect(admin.getByRole("heading", { level: 1, name })).toBeVisible();
  await admin.getByRole("button", { name: "Gerar link de recuperação" }).click();
  const resetLink = await admin.getByLabel("Link de uso único").inputValue();
  await admin.getByRole("button", { name: "Concluir" }).click();
  await admin.getByRole("button", { name: "Fechar sem copiar" }).click();

  await guest.goto(new URL(resetLink).pathname);
  await guest
    .getByRole("textbox", { name: "Nova senha", exact: true })
    .fill("senha nova da carla ok");
  await guest.getByRole("textbox", { name: "Repita a nova senha" }).fill("senha nova da carla ok");
  await guest.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(guest.getByText(/todas as sessões abertas foram encerradas/)).toBeVisible();
  await expectNoSeriousAxe(guest);

  // Bloqueio com prévia de A e B; depois desbloqueio.
  await admin.reload();
  await admin.getByRole("button", { name: "Bloquear conta" }).click();
  const affected = admin.getByRole("list", { name: "Instâncias afetadas" });
  await expect(affected.getByRole("listitem")).toHaveCount(2);
  await admin.getByLabel("Motivo").fill("incidente simulado no E2E");
  await admin.getByRole("button", { name: /em todas as instâncias$/ }).click();
  await expect(admin.getByText(`${name} bloqueada.`)).toBeVisible();
  await expectNoHorizontalScroll(admin);
  await expectNoSeriousAxe(admin);

  await admin.getByRole("button", { name: "Desbloquear" }).click();
  await admin.getByLabel("Motivo").fill("incidente encerrado");
  await admin.getByRole("button", { name: `Desbloquear ${name}` }).click();
  await expect(admin.getByText(`${name} desbloqueada.`)).toBeVisible();

  await guestContext.close();
  await adminContext.close();
});
