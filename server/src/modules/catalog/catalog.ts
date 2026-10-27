import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { uuidToBin } from "../../platform/ids.js";
import { recordAudit } from "../audit/audit.js";
import {
  type NotProvisionableReason,
  PROVISIONERS,
  type ProvisionerRegistry,
  resolveProvisioner,
} from "./provisioners.js";

/** Produto do catálogo com os campos calculados do código implantado (data-model `product`). */
export interface Product {
  code: string;
  name: string;
  description: string;
  status: "ativo" | "inativo";
  provisioner: string | null;
  deployedVersion: number | null;
  supportedSchemaVersion: number | null;
  provisionable: boolean;
  notProvisionableReason: NotProvisionableReason | null;
  version: number;
}

interface Row {
  code: string;
  name: string;
  description: string;
  status: "ativo" | "inativo";
  reference_only: number;
  version: number;
}

export const productNotFound = () => new AppError(404, "NOT_FOUND", "Produto não encontrado.");

const versionConflict = () =>
  new AppError(
    409,
    "CONFLICT_VERSION",
    "O produto foi alterado por outra pessoa. Recarregue para ver a versão atual.",
  );

/** Produtos de referência não existem no catálogo de produção (constituição III). */
const visible = (ctx: AppContext, row: Row) =>
  !(row.reference_only === 1 && ctx.config.SPARK_ENV === "production");

async function toProduct(
  ctx: AppContext,
  row: Row,
  registry: ProvisionerRegistry,
): Promise<Product> {
  const resolved = await resolveProvisioner(row.code, ctx.config.SPARK_ENV, registry);
  const reason: NotProvisionableReason | null = !resolved.ok
    ? resolved.reason
    : row.status === "inativo"
      ? "PRODUTO_INATIVO"
      : null;
  const version = resolved.ok ? resolved.version : null;
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    provisioner: resolved.ok ? resolved.provisioner.id : null,
    deployedVersion: version,
    supportedSchemaVersion: version,
    provisionable: reason === null,
    notProvisionableReason: reason,
    version: row.version,
  };
}

const COLUMNS = sql`code, name, description, status, reference_only, version`;

export async function listProducts(
  ctx: AppContext,
  registry: ProvisionerRegistry = PROVISIONERS,
): Promise<Product[]> {
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM product ORDER BY name`.execute(ctx.core);
  return Promise.all(
    rows.filter((row) => visible(ctx, row)).map((row) => toProduct(ctx, row, registry)),
  );
}

async function findRow(ctx: AppContext, code: string, lock?: boolean, db = ctx.core) {
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM product WHERE code = ${code}
     ${lock ? sql`FOR UPDATE` : sql``}`.execute(db);
  const row = rows[0];
  return row && visible(ctx, row) ? row : null;
}

export async function getProduct(
  ctx: AppContext,
  code: string,
  registry: ProvisionerRegistry = PROVISIONERS,
): Promise<Product> {
  const row = await findRow(ctx, code);
  if (!row) throw productNotFound();
  return toProduct(ctx, row, registry);
}

export interface Actor {
  accountId: string;
  correlationId: string;
}

/** Só nome e descrição (SC-007); código e provisionador nunca vêm da interface (SC-009). */
export async function updateProduct(
  ctx: AppContext,
  code: string,
  input: { name: string; description: string; version: number },
  actor: Actor,
): Promise<Product> {
  const now = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    const before = await findRow(ctx, code, true, trx);
    if (!before) throw productNotFound();
    if (before.version !== input.version) throw versionConflict();
    await sql`UPDATE product SET name = ${input.name.trim()},
                     description = ${input.description.trim()}, version = version + 1,
                     updated_by = ${uuidToBin(actor.accountId)}, updated_at = ${now}
               WHERE code = ${code}`.execute(trx);
    await recordAudit(trx, {
      actorKind: "usuario",
      actorId: actor.accountId,
      action: "produto.editado",
      objectType: "produto",
      objectId: code,
      changes: {
        name: [before.name, input.name.trim()],
        description: [before.description, input.description.trim()],
      },
      correlationId: actor.correlationId,
      at: now,
    });
  });
  return getProduct(ctx, code);
}

/** Inativar bloqueia novas solicitações; instâncias existentes não mudam (SC-008). */
export async function setProductStatus(
  ctx: AppContext,
  code: string,
  to: "ativo" | "inativo",
  input: { reason: string; version: number },
  actor: Actor,
): Promise<Product> {
  const now = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    const before = await findRow(ctx, code, true, trx);
    if (!before) throw productNotFound();
    if (before.version !== input.version) throw versionConflict();
    if (before.status === to) return;
    await sql`UPDATE product SET status = ${to}, version = version + 1,
                     updated_by = ${uuidToBin(actor.accountId)}, updated_at = ${now}
               WHERE code = ${code}`.execute(trx);
    await recordAudit(trx, {
      actorKind: "usuario",
      actorId: actor.accountId,
      action: to === "inativo" ? "produto.inativado" : "produto.reativado",
      objectType: "produto",
      objectId: code,
      changes: { status: [before.status, to] },
      reason: input.reason,
      correlationId: actor.correlationId,
      at: now,
    });
  });
  return getProduct(ctx, code);
}
