import { sql } from "kysely";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";

/**
 * Referência mínima de instância (R-08): o necessário para vínculos e para a projeção de acesso.
 * Contratante, estado e máquina de estados chegam em F02/F03.
 */
export interface InstanceRef {
  id: string;
  productCode: string;
  slug: string;
  displayName: string;
  databaseName: string;
  accessDatabaseName: string;
  authorizationRevision: number;
  synthetic: boolean;
}

interface Row {
  id: Buffer;
  product_code: string;
  slug: string;
  display_name: string;
  database_name: string;
  access_database_name: string;
  authorization_revision: number;
  synthetic: number;
}

const COLUMNS = sql`id, product_code, slug, display_name, database_name, access_database_name,
                    authorization_revision, synthetic`;

const toRef = (row: Row): InstanceRef => ({
  id: binToUuid(row.id),
  productCode: row.product_code,
  slug: row.slug,
  displayName: row.display_name,
  databaseName: row.database_name,
  accessDatabaseName: row.access_database_name,
  authorizationRevision: row.authorization_revision,
  synthetic: row.synthetic === 1,
});

/** Registra a instância provisionada; idempotente pelo UUID. */
export async function registerInstanceRef(
  ctx: AppContext,
  ref: Omit<InstanceRef, "authorizationRevision">,
): Promise<InstanceRef> {
  await sql`INSERT INTO instance_ref
      (id, product_code, slug, display_name, database_name, access_database_name,
       authorization_revision, synthetic, created_at)
    VALUES (${uuidToBin(ref.id)}, ${ref.productCode}, ${ref.slug}, ${ref.displayName},
            ${ref.databaseName}, ${ref.accessDatabaseName}, 1, ${ref.synthetic}, ${ctx.clock()})
    ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`.execute(ctx.core);
  const found = await getInstance(ctx, ref.id);
  if (!found) throw new Error("Referência de instância não gravada");
  return found;
}

export async function getInstance(ctx: AppContext, id: string): Promise<InstanceRef | null> {
  const { rows } =
    await sql<Row>`SELECT ${COLUMNS} FROM instance_ref WHERE id = ${uuidToBin(id)}`.execute(
      ctx.core,
    );
  return rows[0] ? toRef(rows[0]) : null;
}

/** Instância pelo produto da credencial e pelo slug da rota; outro produto = inexistente. */
export async function findInstanceBySlug(
  ctx: AppContext,
  productCode: string,
  slug: string,
): Promise<InstanceRef | null> {
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM instance_ref
     WHERE product_code = ${productCode} AND slug = ${slug}`.execute(ctx.core);
  return rows[0] ? toRef(rows[0]) : null;
}

export async function getInstances(
  ctx: AppContext,
  ids: readonly string[],
): Promise<InstanceRef[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM instance_ref
     WHERE id IN (${sql.join(ids.map(uuidToBin))}) ORDER BY display_name`.execute(ctx.core);
  return rows.map(toRef);
}

export async function listInstances(ctx: AppContext): Promise<InstanceRef[]> {
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM instance_ref
     ORDER BY display_name`.execute(ctx.core);
  return rows.map(toRef);
}
