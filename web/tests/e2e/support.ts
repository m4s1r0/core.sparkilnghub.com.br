import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Convite de administrador criado pelo apoio de teste (scripts/e2e-invite.ts). */
export function createAdminInvitation(email: string): string {
  const windows = process.platform === "win32";
  return execFileSync(windows ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-invite.ts", email], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: windows,
  }).trim();
}

function base32Decode(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/\s+/g, "").toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** TOTP RFC 6238 (SHA-1, 6 dígitos, 30 s) calculado no teste. */
export function totp(secret: string, timeMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** Espera o próximo passo de 30 s: o servidor recusa reutilizar o código do passo anterior. */
export async function waitNextStep(page: Page): Promise<void> {
  const remaining = 30_000 - (Date.now() % 30_000);
  await page.waitForTimeout(remaining + 500);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function expectNoSeriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

export interface E2eAdmin {
  email: string;
  password: string;
  secret: string;
}

/** Aceita o convite pela interface e cadastra o TOTP; termina no painel. */
export async function onboardAdmin(page: Page, email: string, token?: string): Promise<E2eAdmin> {
  const password = `senha e2e longa ${Date.now()}`;
  await page.goto(`/convite/${token ?? createAdminInvitation(email)}`);
  await page.getByLabel("Seu nome").fill("[SINTÉTICO] Administrador E2E");
  // O rótulo visível é "Senha *"; o nome acessível do campo é "Senha".
  await page.getByRole("textbox", { name: "Senha", exact: true }).fill(password);
  await page.getByRole("textbox", { name: "Repita a senha" }).fill(password);
  await page.getByRole("button", { name: "Aceitar convite" }).click();

  await expect(
    page.getByRole("heading", { name: "Cadastrar aplicativo autenticador" }),
  ).toBeVisible();
  const secret = (await page.getByLabel("Segredo para digitação manual").textContent()) ?? "";
  await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
  await page.getByRole("button", { name: "Confirmar cadastro" }).click();
  await expect(
    page.getByRole("list", { name: "Códigos de recuperação" }).locator("li"),
  ).toHaveCount(10);
  await page.getByRole("button", { name: "Já guardei" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Situação do sistema" })).toBeVisible();
  return { email, password, secret };
}

/** Login em dois passos pela interface. */
export async function login(page: Page, admin: E2eAdmin): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(admin.email);
  await page.getByRole("textbox", { name: "Senha", exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Confirme o segundo fator" })).toBeVisible();
  await waitNextStep(page);
  await page.getByLabel("Código do aplicativo").fill(totp(admin.secret));
  await page.getByRole("button", { name: "Confirmar" }).click();
}
