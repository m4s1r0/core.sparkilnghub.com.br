import { type ExecutorOptions, runNextTask } from "../../modules/provisioning/executor.js";

/** Tarefas por rodada: uma de cada vez, para não segurar o trabalhador indefinidamente. */
const MAX_PER_ROUND = 3;

/**
 * Provisionamento (F02, research.md R-03): pega tarefas vencidas com lease e as executa. Outro
 * trabalhador só assume uma tarefa depois que o lease vence (SC-022).
 */
export async function processDueProvisioning(options: ExecutorOptions): Promise<number> {
  let processed = 0;
  while (processed < MAX_PER_ROUND) {
    const outcome = await runNextTask(options);
    if (outcome === null) break;
    processed += 1;
  }
  return processed;
}
