import { recordBackupResult } from "../modules/instances/backup.js";
import { loadConfig } from "../platform/config/load.js";
import { createAppContext } from "../platform/context.js";
import { PoolRegistry } from "../platform/db/pools.js";
import { isUuid } from "../platform/ids.js";
import { createLogger } from "../platform/logging/logger.js";
import { runCli } from "./run.js";

// npm run instances:report-backup -- <instanceId> <ok|falhou> [--origin <nome>] [--detail <texto>]
//   [--takenAt <ISO>]
// Comando chamado pela infraestrutura/ferramenta de backup depois de cada cópia (F03,
// research.md R-05, contracts/commands-f03.md). Nenhuma rota HTTP escreve
// `instance_backup_record`; só este comando. Saídas: 0 ok; 1 instância inexistente; 2 argumento
// inválido.
const USAGE =
  "Uso: npm run instances:report-backup -- <instanceId> <ok|falhou> [--origin <nome>] " +
  "[--detail <texto>] [--takenAt <ISO>]";

function parseFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

runCli("instances:report-backup", async () => {
  const args = process.argv.slice(2);
  const [instanceId, outcome] = args;
  if (!instanceId || !isUuid(instanceId)) {
    console.error(USAGE);
    process.exit(2);
    return;
  }
  if (outcome !== "ok" && outcome !== "falhou") {
    console.error(USAGE);
    process.exit(2);
    return;
  }
  const takenAtRaw = parseFlag(args, "--takenAt");
  const takenAt = takenAtRaw ? new Date(takenAtRaw) : new Date();
  if (Number.isNaN(takenAt.getTime())) {
    console.error(`--takenAt inválido: ${takenAtRaw}`);
    process.exit(2);
    return;
  }
  const detail = parseFlag(args, "--detail") ?? null;
  const origin = parseFlag(args, "--origin") ?? "ferramenta externa de backup";

  const config = loadConfig({ credentials: ["migrator"] });
  const pools = new PoolRegistry(config);
  try {
    const ctx = createAppContext(config, pools, {
      role: "migrator",
      logger: createLogger({ name: "instances-report-backup" }),
    });
    try {
      await recordBackupResult(ctx, {
        instanceId,
        result: outcome === "ok" ? "sucesso" : "falha",
        origin: origin.slice(0, 80),
        detail: detail ? detail.slice(0, 300) : null,
        takenAt,
      });
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) {
        console.error(`Instância ${instanceId} não encontrada.`);
        process.exit(1);
        return;
      }
      throw error;
    }
    console.log(`instances:report-backup: ${instanceId} registrado (${outcome}).`);
  } finally {
    await pools.closeAll();
  }
});
