import { sql } from "kysely";
import { createProductSession } from "../src/modules/access-projection/writer.js";
import { syncToInstances } from "../src/modules/access-projection/sync.js";
import { findAccountByEmail, insertAccount } from "../src/modules/identity/accounts.js";
import { hashPassword } from "../src/modules/identity/password.js";
import { getInstance, type Instance } from "../src/modules/instances/instances.js";
import {
  activateInstance,
  suspendInstance,
  type TransitionActor,
} from "../src/modules/instances/transitions.js";
import { requestInstance } from "../src/modules/instances/request.js";
import { runNextTask } from "../src/modules/provisioning/executor.js";
import type { Config } from "../src/platform/config/load.js";
import type { AppContext } from "../src/platform/context.js";
import { newId, uuidToBin } from "../src/platform/ids.js";
import { SYNTHETIC_PREFIX } from "./f00.js";
import { SEED_ACTOR_ID } from "./f02.js";
import { SEED_CONTRACTOR_ID, ensureSyntheticCatalog } from "./f01.js";

/** Instância sintética dedicada ao ciclo de F03 — nunca A/B, usadas pelos quickstarts de F01/F02. */
export const SEED_INSTANCE_C_ID = "0192f600-0000-7000-8000-00000000000c";
const SLUG = "ref-c";
const ACCOUNT_EMAIL = "diana@example.test";

export interface SeedF03Result {
  instance: "criada" | "existente";
  state: Instance["state"];
}

/**
 * Dados sintéticos de F03 (quickstart §0): uma terceira instância do produto de referência
 * (`ref-c`), levada a `SUSPENSA` pelas próprias ações do ciclo (nunca `UPDATE` direto), com uma
 * sessão de produto aberta antes da suspensão (e revogada por ela) e uma amostra de saúde/backup
 * para o painel. Idempotente.
 */
export async function seedF03(
  ctx: AppContext,
  provisionConfig: Config,
  seedPassword: string,
): Promise<SeedF03Result> {
  await ensureSyntheticCatalog(ctx);
  const actor: TransitionActor = { kind: "usuario", id: SEED_ACTOR_ID };
  let instance = await getInstance(ctx, SEED_INSTANCE_C_ID);
  let created = false;
  if (!instance) {
    const result = await requestInstance(
      ctx,
      {
        contractorId: SEED_CONTRACTOR_ID,
        productCode: "sparkref",
        displayName: `${SYNTHETIC_PREFIX} Instância C`,
        slug: SLUG,
        initialAdminEmail: ACCOUNT_EMAIL,
      },
      { accountId: SEED_ACTOR_ID, correlationId: newId() },
      SEED_INSTANCE_C_ID,
      { instanceId: SEED_INSTANCE_C_ID },
    );
    const outcome = await runNextTask(
      { ctx, config: provisionConfig, workerId: SEED_ACTOR_ID },
      result.task.id,
    );
    if (outcome !== "concluida" && outcome !== null) {
      throw new Error(`Provisionamento da semente ${SLUG} terminou em ${outcome}`);
    }
    instance = await getInstance(ctx, SEED_INSTANCE_C_ID);
    created = true;
  }
  if (!instance) throw new Error(`Semente ${SLUG} não gravada`);

  if (instance.state === "PRONTA" || instance.state === "ATIVA") {
    // Vínculo real (diana), com sessão aberta antes da suspensão (demonstra CA-SC-009).
    const now = ctx.clock();
    const passwordHash = await hashPassword(seedPassword);
    let account = await findAccountByEmail(ctx.identity, ACCOUNT_EMAIL);
    if (!account) {
      account = await insertAccount(ctx.identity, now, {
        email: ACCOUNT_EMAIL,
        displayName: `${SYNTHETIC_PREFIX} Diana`,
        passwordHash,
      });
    }
    const { rows } = await sql<{ id: Buffer }>`SELECT id FROM membership
       WHERE account_id = ${uuidToBin(account.id)} AND instance_id = ${uuidToBin(instance.id)}
         AND status = 'ativo'`.execute(ctx.identity);
    let membershipId = rows[0] ? rows[0].id.toString("hex") : null;
    if (!membershipId) {
      membershipId = newId();
      await sql`INSERT INTO membership (id, account_id, instance_id, role, status, version,
                  created_at, changed_at, change_reason)
                VALUES (${uuidToBin(membershipId)}, ${uuidToBin(account.id)},
                        ${uuidToBin(instance.id)}, 'administrador', 'ativo', 1, ${now}, ${now},
                        'sementes de desenvolvimento')`.execute(ctx.identity);
    }
    await syncToInstances(ctx, [instance], {
      kind: "replicar_vinculo",
      payload: { membershipId },
    });

    if (instance.state === "PRONTA") {
      instance = await activateInstance(ctx, instance.id, actor, "sementes_f03");
    }
    await createProductSession(ctx, instance, {
      membershipId,
      accountId: account.id,
      instanceId: instance.id,
      displayName: `${SYNTHETIC_PREFIX} Diana`,
      role: "administrador",
      status: "ativo",
      accountStatus: "ativa",
      accountAuthRevision: 1,
      version: 1,
    });
    instance = await suspendInstance(ctx, instance.id, actor, "sementes_f03");
  }

  // Amostra de saúde e backup para o painel (só uma vez: não cresce a cada `db:seed`).
  const { rows: healthRows } = await sql<{ n: number }>`SELECT COUNT(*) AS n
     FROM instance_health_check WHERE instance_id = ${uuidToBin(instance.id)}`.execute(ctx.core);
  if (Number(healthRows[0]?.n ?? 0) === 0) {
    await sql`INSERT INTO instance_health_check
        (id, instance_id, checked_at, healthy, schema_version, reason, origin)
      VALUES (${uuidToBin(newId())}, ${uuidToBin(instance.id)}, ${ctx.clock()}, TRUE,
              ${instance.schemaVersion}, NULL, 'painel')`.execute(ctx.core);
  }
  const { rows: backupRows } = await sql<{ n: number }>`SELECT COUNT(*) AS n
     FROM instance_backup_record WHERE instance_id = ${uuidToBin(instance.id)}`.execute(ctx.core);
  if (Number(backupRows[0]?.n ?? 0) === 0) {
    await sql`INSERT INTO instance_backup_record
        (id, instance_id, taken_at, result, origin, detail, reported_at)
      VALUES (${uuidToBin(newId())}, ${uuidToBin(instance.id)}, ${ctx.clock()}, 'sucesso',
              ${`${SYNTHETIC_PREFIX} sementes de desenvolvimento`}, NULL, ${ctx.clock()})`.execute(
      ctx.core,
    );
  }

  return { instance: created ? "criada" : "existente", state: instance.state };
}
