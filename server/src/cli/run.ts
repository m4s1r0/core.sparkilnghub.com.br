import { EnvGuardError } from "../platform/config/env-guard.js";
import { ConfigError } from "../platform/config/load.js";
import { MigrationError } from "../platform/migrations/manifest.js";

/** Executa um comando de linha de comando com códigos de saída estáveis (contracts/commands.md). */
export function runCli(name: string, main: () => Promise<void>): void {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      if (error instanceof EnvGuardError) {
        console.error(`[${name}] recusado: ${error.message}`);
        process.exit(error.exitCode);
      }
      if (error instanceof ConfigError) {
        console.error(`[${name}] ${error.message}`);
        process.exit(1);
      }
      if (error instanceof MigrationError) {
        console.error(
          `[${name}] ${error.code}${error.version ? ` (versão ${error.version})` : ""}: ${error.message}`,
        );
        process.exit(1);
      }
      const code = (error as { code?: unknown }).code;
      console.error(
        `[${name}] falha${typeof code === "string" ? ` (${code})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    },
  );
}
