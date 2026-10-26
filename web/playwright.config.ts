import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.HTTP_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;
// Local: Edge instalado (como no design system). CI: Chromium do Playwright.
const channel = process.env.CI ? undefined : (process.env.PLAYWRIGHT_CHANNEL ?? "msedge");

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../test-results/e2e",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "../playwright-report" }]]
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
