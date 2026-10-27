// Processo filho dos testes de queda (R-19, NFR-014): o mesmo executor do trabalhador, apontado
// para os bancos isolados do teste (t_<run>_*). Pausa depois do efeito da etapa indicada em
// PAUSE_AFTER e avisa no stdout, para o teste encerrá-lo com SIGKILL nesse ponto.
import { setTimeout as sleep } from "node:timers/promises";
import { runNextTask } from "../../src/modules/provisioning/executor.js";
import { loadConfig } from "../../src/platform/config/load.js";
import { createAppContext } from "../../src/platform/context.js";
import { PoolRegistry } from "../../src/platform/db/pools.js";
import { newId } from "../../src/platform/ids.js";
import { createLogger } from "../../src/platform/logging/logger.js";

const coreDatabase = process.env.TEST_CORE_DB ?? "";
const identityDatabase = process.env.TEST_IDENTITY_DB ?? "";
const pauseAfter = process.env.PAUSE_AFTER ?? "";
const taskId = process.env.TASK_ID ?? "";

const config = loadConfig({
  credentials: ["provisioner", "access", "test"],
  secrets: ["INSTANCE_SECRET_KEY"],
});
const pools = new PoolRegistry(config);
const ctx = createAppContext(config, pools, {
  coreDatabase,
  identityDatabase,
  role: "test",
  logger: createLogger({ name: "worker-filho", level: "silent" }),
});

const outcome = await runNextTask(
  {
    ctx,
    config,
    workerId: newId(),
    afterEffect: async (step) => {
      if (step !== pauseAfter) return;
      process.stdout.write(`pausa:${step}\n`);
      await sleep(60_000);
    },
  },
  taskId,
);
process.stdout.write(`fim:${outcome}\n`);
await pools.closeAll();
