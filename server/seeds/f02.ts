import { getInstance } from "../src/modules/instances/instances.js";
import { requestInstance } from "../src/modules/instances/request.js";
import { runNextTask } from "../src/modules/provisioning/executor.js";
import type { Config } from "../src/platform/config/load.js";
import type { AppContext } from "../src/platform/context.js";
import { newId } from "../src/platform/ids.js";
import { SYNTHETIC_PREFIX } from "./f00.js";
import {
  ensureSyntheticCatalog,
  SEED_CONTRACTOR_ID,
  SEED_INSTANCES,
  seedF01,
  type SeedF01Result,
} from "./f01.js";

/** Ator das solicitações das sementes (não há administrador antes do bootstrap). */
export const SEED_ACTOR_ID = "0192f600-0000-7000-8000-0000000000f0";

export interface SeedF02Result extends SeedF01Result {
  provisioned: number;
}

/**
 * Dados sintéticos de F02 (research.md R-18): contratante e produto de referência, instâncias A e
 * B criadas PELO PROVISIONADOR em modo síncrono (UUID fixo, mesmo caminho do painel) e, depois das
 * contas e vínculos de F01, ativadas com administrador ativo. Idempotente: a chave da solicitação
 * é o próprio UUID; instâncias existentes (de F01) são mantidas.
 */
export async function seedF02(
  ctx: AppContext,
  provisionConfig: Config,
  seedPassword: string,
): Promise<SeedF02Result> {
  await ensureSyntheticCatalog(ctx);
  let provisioned = 0;
  for (const seed of SEED_INSTANCES) {
    const existing = await getInstance(ctx, seed.id);
    if (existing && existing.state !== "CADASTRADA" && existing.state !== "PROVISIONANDO") continue;
    const created = await requestInstance(
      ctx,
      {
        contractorId: SEED_CONTRACTOR_ID,
        productCode: "sparkref",
        displayName: `${SYNTHETIC_PREFIX} ${seed.name}`,
        slug: seed.slug,
        initialAdminEmail: "contato@example.test",
      },
      { accountId: SEED_ACTOR_ID, correlationId: newId() },
      seed.id,
      { instanceId: seed.id },
    );
    const outcome = await runNextTask(
      { ctx, config: provisionConfig, workerId: SEED_ACTOR_ID },
      created.task.id,
    );
    if (outcome !== "concluida" && outcome !== null) {
      throw new Error(`Provisionamento da semente ${seed.slug} terminou em ${outcome}`);
    }
    provisioned += 1;
  }
  // Contas, vínculos (ana em A, bruno em B, carla em ambas), ativação e credencial do sparkref.
  const f01 = await seedF01(ctx, provisionConfig, seedPassword);
  return { ...f01, provisioned };
}
