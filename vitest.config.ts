import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // server/vitest.{unit,integration,contract}.config.ts e web/vitest.config.ts (component),
      // descobertos à medida que existirem.
      "*/vitest*.config.ts",
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/tests/**/*.test.ts"],
        },
      },
    ],
  },
});
