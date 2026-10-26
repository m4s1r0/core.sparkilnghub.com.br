import { fileURLToPath } from "node:url";
import { defineProject, type UserWorkspaceConfig } from "vitest/config";

const contracts = fileURLToPath(new URL("../packages/contracts/src/index.ts", import.meta.url));

/** Base dos projetos de teste do servidor (unit, integration, contract). */
export function serverProject(test: NonNullable<UserWorkspaceConfig["test"]>) {
  return defineProject({
    root: fileURLToPath(new URL(".", import.meta.url)),
    resolve: { alias: { "@sparkcore/contracts": contracts } },
    test,
  });
}
