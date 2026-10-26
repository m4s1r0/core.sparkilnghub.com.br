import { serverProject } from "./vitest.shared.js";

export default serverProject({ name: "unit", include: ["tests/unit/**/*.test.ts"] });
