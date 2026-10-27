import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US6 (quickstart §6): filtrar por estado, abrir o detalhe, ver a linha do tempo, editar nome e
// anotações e informar vigência vencida (pendência sem mudar o estado).
test.describe.configure({ timeout: 180_000 });

test("instâncias: filtros, detalhe, linha do tempo e edição", async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await onboardAdmin(page, `e2e-instancias-${stamp}@example.test`);

  await page.getByRole("link", { name: "Instâncias" }).click();
  await page.getByLabel("Estado").selectOption("ATIVA");
  await expect(page).toHaveURL(/state=ATIVA/);
  await expect(page.getByRole("link", { name: "[SINTÉTICO] Instância A" })).toBeVisible();
  await expect(page.getByRole("link", { name: "[SINTÉTICO] Instância B" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  // Cada tamanho de tela edita uma instância (as execuções correm em paralelo).
  const target = `[SINTÉTICO] Instância ${testInfo.project.name === "mobile-360" ? "B" : "A"}`;
  await page.getByRole("link", { name: target }).click();
  await expect(page.getByRole("heading", { level: 1, name: target })).toBeVisible();
  await expect(page.getByText("(não pode ser alterado)")).toBeVisible();

  await page.getByRole("tab", { name: "Linha do tempo" }).click();
  await expect(page.getByText(/→ Ativa/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Resumo" }).click();

  await page.getByLabel("Anotações administrativas").fill(`[SINTÉTICO] Nota ${stamp}`);
  await page.getByLabel("Fim da vigência").fill("2026-01-31");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
  await expect(page.getByText("Vigência vencida")).toBeVisible();
  await expect(page.getByText("Ativa", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  // Restaura a vigência das sementes para não afetar outras execuções.
  await page.getByLabel("Fim da vigência").fill("");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Alterações salvas.")).toBeVisible();
});
