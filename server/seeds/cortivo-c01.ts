import { sql } from "kysely";
import {
  createAppCredential,
  listAppCredentials,
} from "../src/modules/app-credentials/app-credentials.js";
import { findAccountByEmail } from "../src/modules/identity/accounts.js";
import { hashPassword, PASSWORD_PARAMS_VERSION } from "../src/modules/identity/password.js";
import { getInstance } from "../src/modules/instances/instances.js";
import { activateSyntheticInstance } from "../src/modules/instances/transitions.js";
import { requestInstance } from "../src/modules/instances/request.js";
import { runNextTask } from "../src/modules/provisioning/executor.js";
import type { Config } from "../src/platform/config/load.js";
import type { AppContext } from "../src/platform/context.js";
import { syncToInstances } from "../src/modules/access-projection/sync.js";
import { newId, uuidToBin, binToUuid } from "../src/platform/ids.js";
import { SEED_CONTRACTOR_ID } from "./f01.js";
import { SEED_ACTOR_ID } from "./f02.js";
import { SYNTHETIC_PREFIX } from "./f00.js";

export const CORTIVO_C01_INSTANCES = [
  {
    id: "0192f600-0000-7000-8000-00000000c01a",
    slug: "cortivo-a",
    name: "Cortivo A",
    productCode: "cortivo",
  },
  {
    id: "0192f600-0000-7000-8000-00000000c01b",
    slug: "cortivo-b",
    name: "Cortivo B",
    productCode: "cortivo",
  },
  {
    id: "0192f600-0000-7000-8000-00000000c01c",
    slug: "tuteli-c01",
    name: "Tuteli C01",
    productCode: "sparkpet",
  },
] as const;

type C01InstanceSeed = {
  id: string;
  slug: (typeof CORTIVO_C01_INSTANCES)[number]["slug"];
  name: string;
  productCode: (typeof CORTIVO_C01_INSTANCES)[number]["productCode"];
};

const C01_ACCOUNTS = [
  {
    id: "0192f600-0000-7000-8000-00000000c01d",
    email: "cortivo-admin@example.test",
    name: "Admin Cortivo C01",
    memberships: [
      ["cortivo-a", "administrador"],
      ["cortivo-b", "administrador"],
      ["tuteli-c01", "administrador"],
    ],
  },
  {
    id: "0192f600-0000-7000-8000-00000000c01e",
    email: "cortivo-colaborador@example.test",
    name: "Colaborador Cortivo C01",
    memberships: [["cortivo-a", "colaborador"]],
  },
] as const;

const CREDENTIAL_SCOPES = ["connection", "sessions", "members"] as const;

export interface SeedCortivoC01Result {
  instances: { slug: string; state: string }[];
  accounts: { created: number; existing: number };
  memberships: { created: number; existing: number };
  credentials: { slug: string; value: string | null; created: boolean }[];
}

async function ensureC01Catalog(ctx: AppContext): Promise<void> {
  const now = ctx.clock();
  await sql`INSERT IGNORE INTO contractor
      (id, legal_name, display_name, name_key, person_type, contact_name, email, status, version,
       created_at, updated_at)
    VALUES (${uuidToBin(SEED_CONTRACTOR_ID)}, ${`${SYNTHETIC_PREFIX} Contratante Cortivo C01`},
            ${`${SYNTHETIC_PREFIX} Contratante Cortivo C01`},
            'sintetico contratante cortivo c01', 'juridica', ${`${SYNTHETIC_PREFIX} Contato C01`},
            'contato-c01@example.test', 'ativo', 1, ${now}, ${now})`.execute(ctx.core);

  for (const product of [
    { code: "cortivo", name: "Cortivo" },
    { code: "sparkpet", name: "Tuteli" },
  ]) {
    await sql`INSERT IGNORE INTO product
        (code, name, description, status, reference_only, version, created_at, updated_at)
      VALUES (${product.code}, ${product.name}, ${`${SYNTHETIC_PREFIX} produto de ensaio C01`},
              'ativo', FALSE, 1, ${now}, ${now})`.execute(ctx.core);
  }
}

async function ensureInstances(
  ctx: AppContext,
  provisionConfig: Config,
  seeds: readonly C01InstanceSeed[],
): Promise<Map<string, NonNullable<Awaited<ReturnType<typeof getInstance>>>>> {
  const instances = new Map<string, NonNullable<Awaited<ReturnType<typeof getInstance>>>>();
  for (const seed of seeds) {
    let instance = await getInstance(ctx, seed.id);
    if (!instance || instance.state === "CADASTRADA" || instance.state === "PROVISIONANDO") {
      const request = await requestInstance(
        ctx,
        {
          contractorId: SEED_CONTRACTOR_ID,
          productCode: seed.productCode,
          displayName: `${SYNTHETIC_PREFIX} ${seed.name}`,
          slug: seed.slug,
          initialAdminEmail: "cortivo-admin@example.test",
        },
        { accountId: SEED_ACTOR_ID, correlationId: newId() },
        seed.id,
        { instanceId: seed.id },
      );
      const outcome = await runNextTask(
        { ctx, config: provisionConfig, workerId: SEED_ACTOR_ID },
        request.task.id,
      );
      if (outcome !== "concluida" && outcome !== null) {
        throw new Error(`Provisionamento da semente ${seed.slug} terminou em ${outcome}`);
      }
      instance = await getInstance(ctx, seed.id);
    }
    if (!instance) throw new Error(`Instância sintética ${seed.slug} não foi gravada`);
    if (
      !instance.synthetic ||
      instance.slug !== seed.slug ||
      instance.productCode !== seed.productCode
    ) {
      throw new Error(`Identificador sintético de ${seed.slug} pertence a outra instância`);
    }
    if (instance.state !== "PRONTA" && instance.state !== "ATIVA") {
      throw new Error(
        `Instância sintética ${seed.slug} está em estado inesperado ${instance.state}`,
      );
    }
    instances.set(seed.slug, instance);
  }
  return instances;
}

async function ensureAccount(
  ctx: AppContext,
  seed: (typeof C01_ACCOUNTS)[number],
  passwordHash: string,
  now: Date,
): Promise<{ id: string; created: boolean }> {
  const existing = await findAccountByEmail(ctx.identity, seed.email);
  if (existing) {
    if (existing.id !== seed.id || existing.status !== "ativa") {
      throw new Error(
        `A conta sintética ${seed.email} já existe em estado ou identificador divergente`,
      );
    }
    return { id: existing.id, created: false };
  }
  await sql`INSERT INTO account
      (id, email_normalized, email_display, display_name, status, auth_revision, created_at, updated_at)
    VALUES (${uuidToBin(seed.id)}, ${seed.email}, ${seed.email}, ${`${SYNTHETIC_PREFIX} ${seed.name}`},
            'ativa', 1, ${now}, ${now})`.execute(ctx.identity);
  await sql`INSERT INTO password_credential (account_id, hash, params_version, changed_at)
    VALUES (${uuidToBin(seed.id)}, ${passwordHash}, ${PASSWORD_PARAMS_VERSION}, ${now})`.execute(
    ctx.identity,
  );
  return { id: seed.id, created: true };
}

async function ensureMembership(
  ctx: AppContext,
  accountId: string,
  instance: NonNullable<Awaited<ReturnType<typeof getInstance>>>,
  role: "administrador" | "colaborador",
  fixedId: string,
): Promise<{ id: string; created: boolean }> {
  const { rows } = await sql<{
    id: Buffer;
    status: string;
    role: string;
  }>`SELECT id, status, role FROM membership
      WHERE account_id = ${uuidToBin(accountId)} AND instance_id = ${uuidToBin(instance.id)}`.execute(
    ctx.identity,
  );
  const existing = rows[0];
  if (existing) {
    if (existing.status !== "ativo" || existing.role !== role) {
      throw new Error(`Vínculo sintético de ${instance.slug} existe em estado ou papel divergente`);
    }
    return { id: binToUuid(existing.id), created: false };
  }
  const now = ctx.clock();
  await sql`INSERT INTO membership (id, account_id, instance_id, role, status, version,
              created_at, changed_at, change_reason)
    VALUES (${uuidToBin(fixedId)}, ${uuidToBin(accountId)}, ${uuidToBin(instance.id)}, ${role},
            'ativo', 1, ${now}, ${now}, 'sementes de desenvolvimento C01')`.execute(ctx.identity);
  return { id: fixedId, created: true };
}

async function ensureCredential(
  ctx: AppContext,
  instance: NonNullable<Awaited<ReturnType<typeof getInstance>>>,
): Promise<{ slug: string; value: string | null; created: boolean }> {
  const label = `${SYNTHETIC_PREFIX} Cortivo C01 ${instance.slug}`;
  const candidates = (await listAppCredentials(ctx)).filter(
    (credential) =>
      credential.productCode === "cortivo" && credential.label === label && !credential.revokedAt,
  );
  if (candidates.length > 1) {
    throw new Error(`Mais de uma credencial ativa encontrada para ${instance.slug}`);
  }
  const existing = candidates[0];
  if (existing) {
    if (existing.instanceId !== instance.id) {
      throw new Error(`Credencial sintética de ${instance.slug} vinculada à instância incorreta`);
    }
    const actualScopes = [...existing.scopes].sort();
    const expectedScopes = [...CREDENTIAL_SCOPES].sort();
    if (JSON.stringify(actualScopes) !== JSON.stringify(expectedScopes)) {
      throw new Error(`Credencial sintética de ${instance.slug} tem escopos divergentes dos C01`);
    }
    return { slug: instance.slug, value: null, created: false };
  }
  const created = await createAppCredential(ctx, {
    productCode: "cortivo",
    label,
    scopes: [...CREDENTIAL_SCOPES],
    instanceId: instance.id,
  });
  return { slug: instance.slug, value: created.value, created: true };
}

/** Prepara o ensaio C01; segredos só são devolvidos quando criados nesta execução. */
export async function seedCortivoC01(
  ctx: AppContext,
  provisionConfig: Config,
  seedPassword: string,
  options: { instanceIds?: readonly string[] } = {},
): Promise<SeedCortivoC01Result> {
  if (!seedPassword) throw new Error("Defina SEED_USER_PASSWORD antes de preparar o ensaio C01");
  await ensureC01Catalog(ctx);
  const seeds = CORTIVO_C01_INSTANCES.map((seed, index) => ({
    ...seed,
    id: options.instanceIds?.[index] ?? seed.id,
  }));
  const instances = await ensureInstances(ctx, provisionConfig, seeds);
  const now = ctx.clock();
  const passwordHash = await hashPassword(seedPassword);
  const accounts = { created: 0, existing: 0 };
  const memberships = { created: 0, existing: 0 };

  for (const [accountIndex, seed] of C01_ACCOUNTS.entries()) {
    const account = await ensureAccount(ctx, seed, passwordHash, now);
    accounts[account.created ? "created" : "existing"] += 1;
    for (const [membershipIndex, [slug, role]] of seed.memberships.entries()) {
      const instance = instances.get(slug);
      if (!instance) throw new Error(`Instância sintética ${slug} não encontrada`);
      const membership = await ensureMembership(
        ctx,
        account.id,
        instance,
        role,
        `0192f600-0000-7000-8000-00000000c0${accountIndex + 1}${membershipIndex + 1}`,
      );
      memberships[membership.created ? "created" : "existing"] += 1;
      await syncToInstances(ctx, [instance], {
        kind: "replicar_vinculo",
        payload: { membershipId: membership.id },
      });
    }
  }

  for (const instance of instances.values()) {
    if (instance.state === "PRONTA") {
      await activateSyntheticInstance(ctx, instance.id);
      const active = await getInstance(ctx, instance.id);
      if (!active)
        throw new Error(`Instância sintética ${instance.slug} desapareceu após ativação`);
      instances.set(instance.slug, active);
    }
  }

  const credentials = await ctx.core.transaction().execute(async (transaction) => {
    const transactionContext: AppContext = {
      config: ctx.config,
      pools: ctx.pools,
      identity: ctx.identity,
      core: transaction,
      access: (database) => ctx.access(database),
      get keyRing() {
        return ctx.keyRing;
      },
      get instanceKeyRing() {
        return ctx.instanceKeyRing;
      },
      clock: () => ctx.clock(),
      logger: ctx.logger,
    };
    const created = [];
    for (const seed of seeds.slice(0, 2)) {
      const instance = instances.get(seed.slug);
      if (!instance) throw new Error(`Instância sintética ${seed.slug} não encontrada`);
      created.push(await ensureCredential(transactionContext, instance));
    }
    return created;
  });
  return {
    instances: [...instances.values()].map(({ slug, state }) => ({ slug, state })),
    accounts,
    memberships,
    credentials,
  };
}
