import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = `http://${process.env.HTTP_HOST ?? "127.0.0.1"}:${process.env.HTTP_PORT ?? "3000"}`;

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Em desenvolvimento a interface lê os contratos direto do código-fonte.
      "@sparkcore/contracts": fileURLToPath(
        new URL("../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: { "/api": apiTarget, "/health": apiTarget },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
