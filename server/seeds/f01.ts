import { sql } from "kysely";
import { syncToInstances } from "../src/modules/access-projection/sync.js";
import {
  createAppCredential,
  listAppCredentials,
} from "../src/modules/app-credentials/app-credentials.js";
import { findAccountByEmail, insertAccount } from "../src/modules/identity/accounts.js";
import { hashPassword } from "../src/modules/identity/password.js";
import { type InstanceRef, registerInstanceRef } from "../src/modules/instances/instance-ref.js";
import type { Config } from "../src/platform/config/load.js";
import type { AppContext } from "../src/platform/context.js";
import { binToUuid, newId, uuidToBin } from "../src/platform/ids.js";
import { applyArtifact } from "../src/platform/migrations/apply-artifact.js";
import { loadManifest } from "../src/platform/migrations/manifest.js";
import { referenceProductDir } from "../src/platform/paths.js";
import { SYNTHETIC_PREFIX } from "./f00.js";

/** Instâncias sintéticas A e B do produto de referência, com UUID fixo (idempotência). */
export const SEED_INSTANCES = [
  { id: "0192f600-0000-7000-8000-00000000000a", slug: "ref-a", name: "Instância A" },
  { id: "0192f600-0000-7000-8000-00000000000b", slug: "ref-b", name: "Instância B" },
] as const;

/** Contas sintéticas (contracts/commands-f01.md); senha de SEED_USER_PASSWORD. */
export const SEED_ACCOUNTS = [
  { email: "ana@example.test", name: "Ana", memberships: [["ref-a", "administrador"]] },
  { email: "bruno@example.test", name: "Bruno", memberships: [["ref-b", "administrador"]] },
  {
    email: "carla@example.test",
    name: "Carla",
    memberships: [
      ["ref-a", "colaborador"],
      ["ref-b", "colaborador"],
    ],
  },
] as const;

const CREDENTIAL_LABEL = `${SYNTHETIC_PREFIX} sparkref (sementes)`;

export interface SeedF01Result {
  instances: number;
  accounts: { created: number; existing: number };
  memberships: { created: number; existing: number };
  /** `<id>.<segredo>` só quando a credencial foi criada agora (exibida uma única vez). */
  appCredential: string | null;
}

/**
 * Dados sintéticos de F01: instâncias A e B com bancos operacional e de acesso, credencial de
 * aplicação do sparkref e contas ana, bruno e carla com seus vínculos, replicados na projeção.
 * Idempotente. `provisionConfig` traz a credencial do provisionador.
 */
export async function seedF01(
  ctx: AppContext,
  provisionConfig: Config,
  seedPassword: string,
): Promise<SeedF01Result> {
  const now = ctx.clock();
  const instances = new Map<string, InstanceRef>();
  const manifest = await loadManifest(referenceProductDir);
  for (const seed of SEED_INSTANCES) {
    const applied = await applyArtifact(provisionConfig, manifest, {
      instanceUuid: seed.id,
      synthetic: true,
    });
    instances.set(
      seed.slug,
      await registerInstanceRef(ctx, {
        id: seed.id,
        productCode: "sparkref",
        slug: seed.slug,
        displayName: `${SYNTHETIC_PREFIX} ${seed.name}`,
        databaseName: applied.database,
        accessDatabaseName: applied.accessDatabase,
        synthetic: true,
      }),
    );
  }

  const result: SeedF01Result = {
    instances: instances.size,
    accounts: { created: 0, existing: 0 },
    memberships: { created: 0, existing: 0 },
    appCredential: null,
  };

  const passwordHash = await hashPassword(seedPassword);
  const toReplicate: { instance: InstanceRef; membershipId: string }[] = [];
  for (const seed of SEED_ACCOUNTS) {
    let account = await findAccountByEmail(ctx.identity, seed.email);
    if (account) result.accounts.existing += 1;
    else {
      account = await insertAccount(ctx.identity, now, {
        email: seed.email,
        displayName: `${SYNTHETIC_PREFIX} ${seed.name}`,
        passwordHash,
      });
      result.accounts.created += 1;
    }
    for (const [slug, role] of seed.memberships) {
      const instance = instances.get(slug);
      if (!instance) continue;
      const { rows } = await sql<{ id: Buffer }>`SELECT id FROM membership
         WHERE account_id = ${uuidToBin(account.id)} AND instance_id = ${uuidToBin(instance.id)}
           AND status = 'ativo'`.execute(ctx.identity);
      let membershipId = rows[0] ? binToUuid(rows[0].id) : null;
      if (membershipId) result.memberships.existing += 1;
      else {
        membershipId = newId();
        await sql`INSERT INTO membership (id, account_id, instance_id, role, status, version,
                    created_at, changed_at, change_reason)
                  VALUES (${uuidToBin(membershipId)}, ${uuidToBin(account.id)},
                          ${uuidToBin(instance.id)}, ${role}, 'ativo', 1, ${now}, ${now},
                          'sementes de desenvolvimento')`.execute(ctx.identity);
        result.memberships.created += 1;
      }
      toReplicate.push({ instance, membershipId });
    }
  }
  for (const { instance, membershipId } of toReplicate) {
    await syncToInstances(ctx, [instance], {
      kind: "replicar_vinculo",
      payload: { membershipId },
    });
  }

  const existing = (await listAppCredentials(ctx)).find(
    (c) => c.productCode === "sparkref" && c.label === CREDENTIAL_LABEL && !c.revokedAt,
  );
  if (!existing) {
    const created = await createAppCredential(ctx, {
      productCode: "sparkref",
      label: CREDENTIAL_LABEL,
      scopes: ["sessions", "members"],
    });
    result.appCredential = created.value;
  }
  return result;
}
