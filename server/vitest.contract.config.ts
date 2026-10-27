import { serverProject } from "./vitest.shared.js";

export default serverProject({
  name: "contract",
  include: ["tests/contract/**/*.test.ts"],
  fileParallelism: false,
  testTimeout: 30_000,
  // Testes de F01 sobem bancos t_<run>_* migrados e instâncias sintéticas.
  hookTimeout: 60_000,
});
