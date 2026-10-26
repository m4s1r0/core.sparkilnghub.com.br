import { serverProject } from "./vitest.shared.js";

export default serverProject({
  name: "contract",
  include: ["tests/contract/**/*.test.ts"],
  fileParallelism: false,
  testTimeout: 30_000,
});
