import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, expectNoSeriousAxe, onboardAdmin } from "./support";

// US1 (quickstart §1): cadastrar pessoa jurídica com CNPJ, ver alerta de homônimo, buscar, editar
// e tentar inativar o contratante sintético das sementes (recusado com ref-a e ref-b).
test.describe.configure({ timeout: 180_000 });

/** CNPJ numérico válido e único por execução (o banco de desenvolvimento persiste). */
function randomCnpj(): string {
  const base = Array.from({ length: 12 }, (_, i) =>
    i < 8 ? Math.floor(Math.random() * 10) : i === 11 ? 1 : 0,
  );
  const digit = (body: number[], weights: number[]) => {
    const rest = body.reduce((sum, value, i) => sum + value * (weights[i] ?? 0), 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = digit([...base, first], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, first, second].join("");
}

test("contratantes: cadastro, homônimo, busca, edição e inativação recusada", async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name}-${Date.now()}`;
  await onboardAdmin(page, `e2e-contratantes-${stamp}@example.test`);

  await page.getByRole("link", { name: "Contratantes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contratantes" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);

  const name = `Pet E2E ${stamp}`;
  const cnpj = randomCnpj();
  await page.getByRole("button", { name: "Novo contratante" }).first().click();
  await page.getByLabel("Razão social").fill(`${name} Comércio Ltda`);
  await page.getByLabel("Nome de exibição").fill(name);
  await page.getByLabel(/CNPJ/).fill(cnpj);
  await page.getByLabel("Contato responsável").fill("[SINTÉTICO] Contato");
  await page.getByLabel(/^E-mail/).fill("contato@example.test");
  await expectNoHorizontalScroll(page);
  await expectNoSeriousAxe(page);
  await page.getByRole("button", { name: "Cadastrar contratante" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // Nome parecido: o alerta aparece antes de criar.
  await page.goto("/contratantes/novo");
  await page.getByLabel("Razão social").fill(`${name.toUpperCase()} COMÉRCIO`);
  await page.getByLabel("Nome de exibição").fill(`${name} Filial`);
  await page.getByLabel("Contato responsável").fill("[SINTÉTICO] Contato");
  await page.getByLabel(/^E-mail/).fill("contato@example.test");
  await page.getByRole("button", { name: "Cadastrar contratante" }).click();
  await expect(page.getByText("Possíveis contratantes já cadastrados")).toBeVisible();
  await expect(page.getByRole("link", { name })).toBeVisible();
  await page.getByRole("button", { name: "Revisar dados" }).click();

  // Busca pelo documento e edição.
  await page.goto("/contratantes");
  await page.getByLabel("Buscar por nome, documento ou contato").fill(cnpj);
  await page.getByRole("button", { name: "Buscar" }).click();
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  await page.getByLabel("Nome de exibição").fill(`${name} Matriz`);
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `${name} Matriz` })).toBeVisible();

  // Contratante sintético das sementes tem ref-a e ref-b ativas: inativação recusada.
  await page.goto("/contratantes?q=Contratante%20de%20refer%C3%AAncia");
  await page.getByRole("link", { name: "[SINTÉTICO] Contratante de referência" }).click();
  await page.getByRole("button", { name: "Ações" }).click();
  await page.getByRole("menuitem", { name: "Inativar" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Motivo").fill("teste e2e");
  await dialog.getByRole("button", { name: /^Inativar/ }).click();
  await expect(page.getByText("Inativação recusada: há instâncias ativas")).toBeVisible();
  const blocked = page.getByRole("status").filter({ hasText: "Inativação recusada" });
  await expect(blocked.getByRole("link", { name: "[SINTÉTICO] Instância A" })).toBeVisible();
  await expect(blocked.getByRole("link", { name: "[SINTÉTICO] Instância B" })).toBeVisible();
  await expectNoSeriousAxe(page);
});
