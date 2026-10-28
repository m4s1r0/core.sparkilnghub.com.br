import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US1 a US7 (quickstart §1-7): ativar, suspender (com página pública), reativar, manutenção
// (com saúde) e encerrar uma instância do produto de referência, pelo painel.
test.describe.configure({ timeout: 240_000 });

test("ciclo e operação da instância: ativar, suspender, reativar, manutenção e encerrar", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await onboardAdmin(page, `e2e-ciclo-${stamp}@example.test`);

  // Provisiona uma instância nova, até PRONTA.
  await page.goto("/instancias/nova");
  await page
    .getByLabel("Contratante")
    .selectOption({ label: "[SINTÉTICO] Contratante de referência" });
  await page.getByLabel("Produto").selectOption("sparkref");
  await page.getByRole("button", { name: "Continuar" }).click();
  const slug = `Ciclo E2E ${stamp}`;
  await page.getByLabel("Nome de exibição").fill(`[SINTÉTICO] Ciclo ${stamp}`);
  await page.getByLabel("Identificador de acesso").fill(`${slug}!`);
  await page.getByLabel("E-mail do administrador inicial").fill(`ciclo-${stamp}@example.test`);
  await page.getByRole("button", { name: "Revisar" }).click();
  await page.getByRole("button", { name: "Confirmar e solicitar" }).click();
  // "Instância pronta" (título) e "Pronta" (rótulo da etapa concluir) já aparecem no StepsBlock
  // desde o início, sem depender da conclusão real — a checagem que depende de fato da tarefa
  // concluída é o texto do corpo do alerta de sucesso.
  await expect(
    page.getByText("Bancos, credencial, migrações e verificação concluídos."),
  ).toBeVisible({ timeout: 120_000 });
  await page.getByRole("link", { name: "Detalhe da instância" }).click();
  const normalizedSlug = `ciclo-e2e-${stamp.toLowerCase()}`;

  // US1: ativar.
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Ativar" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  // US2: suspender; a página pública some com o motivo.
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Suspender" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("[SINTÉTICO] manutenção simulada no E2E");
  await dialog.getByRole("button", { name: "Suspender", exact: true }).click();
  await expect(page.getByText("Suspensa", { exact: true }).first()).toBeVisible();

  const publicContext = await page.context().browser()!.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`/i/${normalizedSlug}`);
  await expect(publicPage.getByText(/indisponível/i).first()).toBeVisible();
  const publicText = (await publicPage.locator("body").textContent()) ?? "";
  expect(publicText).not.toMatch(/motivo financeiro|fatura|cobrança/i);
  await publicContext.close();

  // US3: reativar.
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Reativar" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reativar", exact: true }).click();
  await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();

  // US4: manutenção, com checagem de saúde na saída.
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Entrar em manutenção" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("[SINTÉTICO] janela de manutenção do E2E");
  await dialog.getByRole("button", { name: "Entrar em manutenção", exact: true }).click();
  await expect(page.getByText("Manutenção", { exact: true }).first()).toBeVisible();

  // US5: painel de saúde — nunca verificada até clicar; depois mostra a instância saudável.
  await page.getByRole("tab", { name: "Saúde" }).click();
  await expect(page.getByText("Nunca verificada").first()).toBeVisible();
  await page.getByRole("button", { name: "Verificar agora" }).click();
  await expect(page.getByText("Saudável").first()).toBeVisible();
  await expectNoSeriousAxe(page);

  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Sair da manutenção" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Sair da manutenção", exact: true }).click();
  await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();

  // US7: suspender de novo e encerrar.
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Suspender" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("[SINTÉTICO] encerramento simulado no E2E");
  await dialog.getByRole("button", { name: "Suspender", exact: true }).click();
  await expect(page.getByText("Suspensa", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Encerrar" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("[SINTÉTICO] fim do ciclo no E2E");
  await dialog.getByLabel("Política de retenção").fill("30 dias (teste E2E)");
  await dialog.getByRole("button", { name: /^Encerrar/ }).click();
  await expect(page.getByText("Encerrada", { exact: true }).first()).toBeVisible();
  // Nenhuma ação de ciclo aparece para uma instância ENCERRADA (SC-031).
  await expect(page.getByRole("button", { name: "Ações" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);
});
