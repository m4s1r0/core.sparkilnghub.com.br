import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { sha256Hex } from "../../platform/crypto/index.js";
import { getProduct, type Product } from "../catalog/catalog.js";
import {
  PROVISIONERS,
  type ProvisionerRegistry,
  resolveProvisioner,
} from "../catalog/provisioners.js";
import { type ContractorSummary, searchContractorById } from "../contractors/contractors.js";
import { normalizeEmail } from "../identity/email.js";
import { createProvisioningRequest, getTask, type RequestActor } from "../provisioning/tasks.js";
import { type InstanceSummary, listInstanceSummaries } from "./query.js";
import { checkSlug } from "./slug.js";
import { DEFAULT_TIMEZONE, isSupportedTimezone } from "./timezones.js";

export interface InstanceRequestBody {
  contractorId: string;
  productCode: string;
  displayName: string;
  slug: string;
  timezone?: string;
  initialAdminEmail: string;
  notes?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
}

const invalid = (field: string, message: string) =>
  new AppError(422, "VALIDATION_FAILED", message, { field });

const SLUG_MESSAGE = {
  TAMANHO: "O identificador de acesso deve ter de 3 a 63 caracteres.",
  FORMATO: "O identificador de acesso deve começar por letra e terminar em letra ou número.",
  RESERVADO: "Este identificador de acesso é reservado. Escolha outro.",
} as const;

interface Checked {
  contractor: ContractorSummary;
  product: Product;
  slug: string;
  slugAvailable: boolean;
  timezone: string;
  email: string;
  displayName: string;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

/** Validação autoritativa da solicitação (FR-008, FR-011 a FR-016); a prévia usa a mesma. */
async function check(
  ctx: AppContext,
  body: InstanceRequestBody,
  registry: ProvisionerRegistry,
): Promise<Checked> {
  const contractor = await searchContractorById(ctx, body.contractorId);
  if (!contractor) throw invalid("/contractorId", "Contratante não encontrado.");
  if (contractor.status !== "ativo") {
    throw new AppError(
      409,
      "CONFLICT_CONTRACTOR_INACTIVE",
      "Contratante inativo não recebe novas instâncias.",
      { field: "/contractorId" },
    );
  }
  let product: Product;
  try {
    product = await getProduct(ctx, body.productCode, registry);
  } catch {
    throw invalid("/productCode", "Produto não encontrado.");
  }
  if (!product.provisionable) {
    throw new AppError(
      409,
      "CONFLICT_PRODUCT_NOT_PROVISIONABLE",
      "Este produto não pode ser provisionado agora.",
      {
        field: "/productCode",
        details: [
          {
            field: "/productCode",
            code: product.notProvisionableReason ?? "SEM_PROVISIONADOR",
            message: product.name,
          },
        ],
      },
    );
  }
  const slug = checkSlug(body.slug);
  if (!slug.ok) throw invalid("/slug", SLUG_MESSAGE[slug.reason]);
  const timezone = body.timezone ?? DEFAULT_TIMEZONE;
  if (!isSupportedTimezone(timezone)) throw invalid("/timezone", "Fuso horário não suportado.");
  const validFrom = body.validFrom ?? null;
  const validUntil = body.validUntil ?? null;
  if (validFrom && validUntil && validUntil < validFrom) {
    throw invalid("/validUntil", "O fim da vigência não pode ser anterior ao início.");
  }
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance
     WHERE product_code = ${product.code} AND slug = ${slug.slug}`.execute(ctx.core);
  return {
    contractor,
    product,
    slug: slug.slug,
    slugAvailable: Number(rows[0]?.n ?? 0) === 0,
    timezone,
    email: normalizeEmail(body.initialAdminEmail),
    displayName: body.displayName.trim(),
    notes: body.notes?.trim() || null,
    validFrom,
    validUntil,
  };
}

/** Prévia sem credenciais e sem reservar nada (US3, cenário 6). */
export async function previewInstance(
  ctx: AppContext,
  body: InstanceRequestBody,
  registry: ProvisionerRegistry = PROVISIONERS,
) {
  const checked = await check(ctx, body, registry);
  return {
    slug: checked.slug,
    slugAvailable: checked.slugAvailable,
    contractor: checked.contractor,
    product: checked.product,
    timezone: checked.timezone,
    initialAdminEmail: checked.email,
  };
}

/** Resumo canônico do corpo: chaves ordenadas (mesma chave + mesmo corpo = mesma solicitação). */
export function requestHash(body: InstanceRequestBody): string {
  const entries = Object.entries(body)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return sha256Hex(JSON.stringify(entries));
}

export interface InstanceCreated {
  instance: InstanceSummary;
  task: { id: string; protocol: string; status: string };
}

/**
 * Solicitação de instância (US3): valida, cria instância `CADASTRADA` e tarefa numa transação e
 * responde sem esperar o provisionamento (SC-020). Repetição com a mesma chave devolve o mesmo.
 */
export async function requestInstance(
  ctx: AppContext,
  body: InstanceRequestBody,
  actor: RequestActor,
  idempotencyKey: string,
  options: { registry?: ProvisionerRegistry; instanceId?: string } = {},
): Promise<InstanceCreated> {
  const registry = options.registry ?? PROVISIONERS;
  const hash = requestHash(body);
  const checked = await check(ctx, body, registry);
  const resolved = await resolveProvisioner(checked.product.code, ctx.config.SPARK_ENV, registry);
  if (!resolved.ok) throw new Error("Produto deixou de ser provisionável");
  const prefix = resolved.manifest.manifest.databasePrefix ?? `${checked.product.code}_`;
  const result = await createProvisioningRequest(
    ctx,
    {
      contractorId: checked.contractor.id,
      productCode: checked.product.code,
      databasePrefix: prefix,
      displayName: checked.displayName,
      slug: checked.slug,
      timezone: checked.timezone,
      initialAdminEmail: checked.email,
      notes: checked.notes,
      validFrom: checked.validFrom,
      validUntil: checked.validUntil,
      artifactVersion: resolved.version,
      manifestSha256: resolved.manifestSha256,
      idempotencyKey: idempotencyKey.toLowerCase(),
      requestHash: hash,
      synthetic: ctx.config.SPARK_ENV !== "production",
      ...(options.instanceId ? { instanceId: options.instanceId } : {}),
    },
    actor,
  );
  return createdView(ctx, result.instanceId, result.taskId);
}

export async function createdView(
  ctx: AppContext,
  instanceId: string,
  taskId: string,
): Promise<InstanceCreated> {
  const { items } = await listInstanceSummaries(ctx, { id: instanceId }, { page: 1, pageSize: 1 });
  const task = await getTask(ctx.core, taskId);
  const instance = items[0];
  if (!instance || !task) throw new Error("Solicitação não encontrada");
  return { instance, task: { id: task.id, protocol: task.protocol, status: task.status } };
}
