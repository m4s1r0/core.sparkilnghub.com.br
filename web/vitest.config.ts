import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineProject } from "vitest/config";

export default defineProject({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@sparkcore/contracts": fileURLToPath(
        new URL("../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "component",
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/component/**/*.test.tsx"],
    css: false,
  },
});
