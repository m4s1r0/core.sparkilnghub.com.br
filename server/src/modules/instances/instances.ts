import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";

/** Estados da máquina de estados do escopo (§5); F02 transiciona só os quatro primeiros. */
export const InstanceStates = [
  "CADASTRADA",
  "PROVISIONANDO",
  "FALHA_PROVISIONAMENTO",
  "PRONTA",
  "ATIVA",
  "SUSPENSA",
  "MANUTENCAO",
  "ENCERRADA",
] as const;
export type InstanceState = (typeof InstanceStates)[number];

/**
 * Instância de produto (F02 data-model): amplia a referência mínima de F01. Estado só muda pelo
 * serviço de transições (`transitions.ts`, RN-SC-001).
 */
export interface Instance {
  id: string;
  contractorId: string;
  productCode: string;
  slug: string;
  displayName: string;
  timezone: string;
  initialAdminEmail: string | null;
  state: InstanceState;
  databaseName: string;
  accessDatabaseName: string;
  authorizationRevision: number;
  schemaVersion: number | null;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
  synthetic: boolean;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstanceRow {
  id: Buffer;
  contractor_id: Buffer;
  product_code: string;
  slug: string;
  display_name: string;
  timezone: string;
  initial_admin_email: string | null;
  state: InstanceState;
  database_name: string;
  access_database_name: string;
  authorization_revision: number;
  schema_version: number | null;
  notes: string | null;
  valid_from: Date | string | null;
  valid_until: Date | string | null;
  synthetic: number;
  version: number;
  created_by: Buffer | null;
  created_at: Date;
  updated_at: Date;
}

export const INSTANCE_COLUMNS = sql`id, contractor_id, product_code, slug, display_name, timezone,
  initial_admin_email, state, database_name, access_database_name, authorization_revision,
  schema_version, notes, valid_from, valid_until, synthetic, version, created_by, created_at,
  updated_at`;

/** `DATE` do mysql2 chega como `Date` à meia-noite UTC (timezone "Z"); devolvido `YYYY-MM-DD`. */
const civilDate = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.toISOString().slice(0, 10);

export const toInstance = (row: InstanceRow): Instance => ({
  id: binToUuid(row.id),
  contractorId: binToUuid(row.contractor_id),
  productCode: row.product_code,
  slug: row.slug,
  displayName: row.display_name,
  timezone: row.timezone,
  initialAdminEmail: row.initial_admin_email,
  state: row.state,
  databaseName: row.database_name,
  accessDatabaseName: row.access_database_name,
  authorizationRevision: row.authorization_revision,
  schemaVersion: row.schema_version,
  notes: row.notes,
  validFrom: civilDate(row.valid_from),
  validUntil: civilDate(row.valid_until),
  synthetic: row.synthetic === 1,
  version: row.version,
  createdBy: row.created_by ? binToUuid(row.created_by) : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface RegisterInstance {
  id: string;
  contractorId: string;
  productCode: string;
  slug: string;
  displayName: string;
  databaseName: string;
  accessDatabaseName: string;
  synthetic: boolean;
}

/**
 * Registra, em `PRONTA`, uma instância cujos bancos já foram aplicados fora do provisionador
 * (sementes e apoio de testes de F01). Idempotente pelo UUID. Instâncias do painel nascem pela
 * solicitação de provisionamento (`provisioning/tasks.ts`).
 */
export async function registerInstance(ctx: AppContext, ref: RegisterInstance): Promise<Instance> {
  const now = ctx.clock();
  const id = uuidToBin(ref.id);
  const inserted = await sql`INSERT IGNORE INTO instance
      (id, contractor_id, product_code, slug, display_name, timezone, state, database_name,
       access_database_name, authorization_revision, synthetic, version, created_at, updated_at)
    VALUES (${id}, ${uuidToBin(ref.contractorId)}, ${ref.productCode}, ${ref.slug},
            ${ref.displayName}, 'America/Sao_Paulo', 'PRONTA', ${ref.databaseName},
            ${ref.accessDatabaseName}, 1, ${ref.synthetic}, 1, ${now}, ${now})`.execute(ctx.core);
  if (Number(inserted.numAffectedRows ?? 0) === 1) {
    await sql`INSERT INTO instance_transition (id, instance_id, from_state, to_state, actor_kind,
                reason, created_at)
              VALUES (UNHEX(REPLACE(UUID(), '-', '')), ${id}, NULL, 'PRONTA', 'sistema',
                      'registro_sintetico', ${now})`.execute(ctx.core);
  }
  const found = await getInstance(ctx, ref.id);
  if (!found) throw new Error("Instância não gravada");
  return found;
}

export async function getInstance(ctx: AppContext, id: string): Promise<Instance | null> {
  const { rows } = await sql<InstanceRow>`SELECT ${INSTANCE_COLUMNS} FROM instance
     WHERE id = ${uuidToBin(id)}`.execute(ctx.core);
  return rows[0] ? toInstance(rows[0]) : null;
}

/** Instância pelo produto da credencial e pelo slug da rota; outro produto = inexistente. */
export async function findInstanceBySlug(
  ctx: AppContext,
  productCode: string,
  slug: string,
): Promise<Instance | null> {
  const { rows } = await sql<InstanceRow>`SELECT ${INSTANCE_COLUMNS} FROM instance
     WHERE product_code = ${productCode} AND slug = ${slug}`.execute(ctx.core);
  return rows[0] ? toInstance(rows[0]) : null;
}

export async function getInstances(ctx: AppContext, ids: readonly string[]): Promise<Instance[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql<InstanceRow>`SELECT ${INSTANCE_COLUMNS} FROM instance
     WHERE id IN (${sql.join(ids.map(uuidToBin))}) ORDER BY display_name`.execute(ctx.core);
  return rows.map(toInstance);
}

export async function listInstances(ctx: AppContext): Promise<Instance[]> {
  const { rows } = await sql<InstanceRow>`SELECT ${INSTANCE_COLUMNS} FROM instance
     ORDER BY display_name`.execute(ctx.core);
  return rows.map(toInstance);
}
