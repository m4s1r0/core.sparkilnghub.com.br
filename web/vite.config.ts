import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// O `.env` da raiz é a fonte única das portas (HTTP_HOST/HTTP_PORT do servidor, WEB_PORT do Vite);
// variáveis do shell têm precedência, igual ao `process.loadEnvFile` da config do servidor. Sem
// isso o proxy caía no fallback e apontava para outra porta que não a do servidor em execução.
const rootEnv = loadEnv("development", fileURLToPath(new URL("..", import.meta.url)), "");
const pick = (name: string, fallback: string) => process.env[name] ?? rootEnv[name] ?? fallback;

const apiTarget = `http://${pick("HTTP_HOST", "127.0.0.1")}:${pick("HTTP_PORT", "5273")}`;

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
    port: Number(pick("WEB_PORT", "5173")),
    strictPort: true,
    proxy: { "/api": apiTarget, "/health": apiTarget },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
