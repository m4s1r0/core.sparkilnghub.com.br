import { serverProject } from "./vitest.shared.js";

export default serverProject({
  name: "integration",
  include: ["tests/integration/**/*.test.ts"],
  // Testes de banco compartilham o servidor MySQL; executar arquivo a arquivo.
  fileParallelism: false,
  testTimeout: 60_000,
  hookTimeout: 60_000,
});
