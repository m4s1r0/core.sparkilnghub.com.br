import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

// Mesma fonte única das portas que o servidor (`loadEnvFile` em server/src/platform/config) e o
// `vite.config.ts`: o `.env` da raiz, sem sobrescrever o que já veio do shell. Sem isto o e2e
// caía no default e apontava para uma porta diferente da que o servidor escuta.
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.HTTP_PORT ?? 5273);
const baseURL = `http://127.0.0.1:${port}`;
// Navegador já instalado na máquina: Edge local (como no design system); na CI, o Google Chrome
// da imagem do runner (PLAYWRIGHT_CHANNEL=chrome), sem baixar navegador.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : "msedge");

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../test-results/e2e",
  // Na CI, o reporter `github` vira anotação de cada falha (legível pela API sem login).
  reporter: process.env.CI
    ? [["list"], ["github"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
    : "list",
  fullyParallel: false,
  retries: 0,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "mobile-360",
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: "desktop-1280",
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  // Servidor de produção (build da interface servido pelo Fastify) e trabalhador.
  webServer: [
    {
      command:
        "npm run -s build -w @sparkcore/web && npm run -s build -w @sparkcore/server && npm run -s start:app -w @sparkcore/server",
      cwd: "..",
      url: `${baseURL}/health/live`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    ...(process.env.E2E_WITHOUT_WORKER
      ? []
      : [
          {
            command: "npm run -s start:worker -w @sparkcore/server",
            cwd: "..",
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
          },
        ]),
  ],
});
