import { sql, type Kysely } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { binToUuid, newId, uuidToBin } from "../../platform/ids.js";
import { type AuditChanges, recordAudit } from "../audit/audit.js";
import type { Page } from "../../platform/http/pagination.js";
import { type InstanceSummary, listInstanceSummaries } from "../instances/query.js";
import {
  type DocumentType,
  normalizeDocument,
  type PersonType,
  validateDocument,
} from "./document.js";
import { nameKey } from "./name-key.js";

export const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "),
);

export interface Address {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface ContractorInput {
  legalName: string;
  displayName: string;
  personType: PersonType;
  document?: string | null;
  contactName: string;
  email: string;
  phone?: string | null;
  address?: Address | null;
}

export interface Contractor {
  id: string;
  legalName: string;
  displayName: string;
  personType: PersonType;
  document: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  address: Address | null;
  status: "ativo" | "inativo";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Actor {
  accountId: string;
  correlationId: string;
}

interface Row {
  id: Buffer;
  legal_name: string;
  display_name: string;
  person_type: PersonType;
  document_normalized: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  address: Address | null;
  status: "ativo" | "inativo";
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = sql`id, legal_name, display_name, person_type, document_normalized, contact_name,
  email, phone, address, status, version, created_at, updated_at`;

const toContractor = (row: Row): Contractor => ({
  id: binToUuid(row.id),
  legalName: row.legal_name,
  displayName: row.display_name,
  personType: row.person_type,
  document: row.document_normalized,
  contactName: row.contact_name,
  email: row.email,
  phone: row.phone,
  address: row.address,
  status: row.status,
  version: row.version,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const invalid = (field: string, message: string) =>
  new AppError(422, "VALIDATION_FAILED", message, { field });

export const contractorNotFound = () =>
  new AppError(404, "NOT_FOUND", "Contratante não encontrado.");

const versionConflict = () =>
  new AppError(
    409,
    "CONFLICT_VERSION",
    "O cadastro foi alterado por outra pessoa. Recarregue para ver a versão atual.",
  );

interface Normalized {
  legalName: string;
  displayName: string;
  personType: PersonType;
  documentType: DocumentType | null;
  document: string | null;
  contactName: string;
  email: string;
  phone: string | null;
  address: Address | null;
}

/** Validação autoritativa do servidor (SC-003, SC-004, research.md R-13). */
function normalize(input: ContractorInput): Normalized {
  let documentType: DocumentType | null = null;
  let document: string | null = null;
  if (input.document && input.document.trim() !== "") {
    const valid = validateDocument(input.personType, input.document);
    if (!valid) {
      throw invalid(
        "/document",
        input.personType === "fisica"
          ? "CPF inválido. Confira os dígitos."
          : "CNPJ inválido. Confira os dígitos e o formato.",
      );
    }
    documentType = valid.type;
    document = valid.normalized;
  }
  let phone: string | null = null;
  if (input.phone && input.phone.trim() !== "") {
    phone = input.phone.replace(/\D/g, "");
    if (phone.length < 10 || phone.length > 13) {
      throw invalid("/phone", "Telefone deve ter de 10 a 13 dígitos, com DDD.");
    }
  }
  let address: Address | null = null;
  if (input.address) {
    const uf = input.address.uf?.toUpperCase();
    if (uf !== undefined && !UFS.has(uf)) throw invalid("/address/uf", "UF inexistente.");
    const entries = Object.entries({ ...input.address, ...(uf ? { uf } : {}) }).filter(
      ([, value]) => typeof value === "string" && value.trim() !== "",
    );
    address = entries.length > 0 ? Object.fromEntries(entries) : null;
  }
  return {
    legalName: input.legalName.trim(),
    displayName: input.displayName.trim(),
    personType: input.personType,
    documentType,
    document,
    contactName: input.contactName.trim(),
    email: input.email.trim(),
    phone,
    address,
  };
}

async function findRow(db: Kysely<unknown>, id: string, lock = false): Promise<Row | null> {
  const { rows } = await sql<Row>`SELECT ${COLUMNS} FROM contractor WHERE id = ${uuidToBin(id)}
     ${lock ? sql`FOR UPDATE` : sql``}`.execute(db);
  return rows[0] ?? null;
}

/** Documento já usado → 409 apontando o contratante existente (sem fundir, SC-005). */
async function documentConflict(ctx: AppContext, data: Normalized): Promise<AppError> {
  const { rows } = await sql<{ id: Buffer; display_name: string }>`
    SELECT id, display_name FROM contractor
     WHERE document_type = ${data.documentType} AND document_normalized = ${data.document}`.execute(
    ctx.core,
  );
  const existing = rows[0];
  return new AppError(
    409,
    "CONFLICT_DOCUMENT_TAKEN",
    "Este documento já pertence a outro contratante.",
    {
      field: "/document",
      ...(existing
        ? {
            details: [
              { field: "/document", code: binToUuid(existing.id), message: existing.display_name },
            ],
          }
        : {}),
    },
  );
}

const isDuplicate = (error: unknown) => (error as { code?: string }).code === "ER_DUP_ENTRY";

export async function createContractor(
  ctx: AppContext,
  input: ContractorInput,
  actor: Actor,
): Promise<Contractor> {
  const data = normalize(input);
  const id = newId();
  const now = ctx.clock();
  try {
    await ctx.core.transaction().execute(async (trx) => {
      await sql`INSERT INTO contractor (id, legal_name, display_name, name_key, person_type,
                  document_type, document_normalized, contact_name, email, phone, address, status,
                  version, created_by, updated_by, created_at, updated_at)
                VALUES (${uuidToBin(id)}, ${data.legalName}, ${data.displayName},
                        ${nameKey(data.legalName)}, ${data.personType}, ${data.documentType},
                        ${data.document}, ${data.contactName}, ${data.email}, ${data.phone},
                        ${data.address ? JSON.stringify(data.address) : null}, 'ativo', 1,
                        ${uuidToBin(actor.accountId)}, ${uuidToBin(actor.accountId)}, ${now},
                        ${now})`.execute(trx);
      await recordAudit(trx, {
        actorKind: "usuario",
        actorId: actor.accountId,
        action: "contratante.criado",
        objectType: "contratante",
        objectId: id,
        changes: { legalName: [null, data.legalName], document: [null, data.document] },
        correlationId: actor.correlationId,
        at: now,
      });
    });
  } catch (error) {
    if (isDuplicate(error)) throw await documentConflict(ctx, data);
    throw error;
  }
  const row = await findRow(ctx.core, id);
  if (!row) throw new Error("Contratante não gravado");
  return toContractor(row);
}

export async function getContractor(
  ctx: AppContext,
  id: string,
): Promise<Contractor & { instances: InstanceSummary[] }> {
  const row = await findRow(ctx.core, id);
  if (!row) throw contractorNotFound();
  const { items } = await listInstanceSummaries(
    ctx,
    { contractorId: id },
    { page: 1, pageSize: 100 },
  );
  return { ...toContractor(row), instances: items };
}

export interface ContractorSummary {
  id: string;
  displayName: string;
  legalName: string;
  personType: PersonType;
  document: string | null;
  status: "ativo" | "inativo";
  products: string[];
  instanceCount: number;
}

/**
 * Documento de busca: só `[0-9A-Z]` (CPF e CNPJ, inclusive alfanumérico). Qualquer outro texto
 * vira vazio — comparado com a coluna ASCII, um caractere acentuado causaria erro de collation.
 */
const searchableDocument = (value: string) => {
  const normalized = normalizeDocument(value);
  return /^[0-9A-Z]+$/.test(normalized) ? normalized : "";
};

const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Busca por nome, documento e contato, paginada, com produtos e instâncias (SC-005). */
export async function searchContractors(
  ctx: AppContext,
  query: { q?: string; status?: "ativo" | "inativo" },
  page: Page,
): Promise<{ items: ContractorSummary[]; total: number }> {
  const conditions = [sql`TRUE`];
  const q = query.q?.trim();
  if (q) {
    const like = likeTerm(q);
    const document = searchableDocument(q);
    conditions.push(sql`(c.legal_name LIKE ${like} OR c.display_name LIKE ${like}
      OR c.contact_name LIKE ${like} OR c.email LIKE ${like}
      OR c.name_key LIKE ${likeTerm(nameKey(q))}
      OR (${document} <> '' AND c.document_normalized LIKE ${likeTerm(document)}))`);
  }
  if (query.status) conditions.push(sql`c.status = ${query.status}`);
  const filter = sql.join(conditions, sql` AND `);
  const { rows } = await sql<{
    id: Buffer;
    display_name: string;
    legal_name: string;
    person_type: PersonType;
    document_normalized: string | null;
    status: "ativo" | "inativo";
    products: string | null;
    instance_count: number;
  }>`SELECT c.id, c.display_name, c.legal_name, c.person_type, c.document_normalized, c.status,
            (SELECT GROUP_CONCAT(DISTINCT i.product_code ORDER BY i.product_code)
               FROM instance i WHERE i.contractor_id = c.id) AS products,
            (SELECT COUNT(*) FROM instance i WHERE i.contractor_id = c.id) AS instance_count
       FROM contractor c
      WHERE ${filter}
      ORDER BY c.display_name, c.id
      LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`.execute(ctx.core);
  const { rows: count } = await sql<{ total: number }>`
    SELECT COUNT(*) AS total FROM contractor c WHERE ${filter}`.execute(ctx.core);
  return {
    items: rows.map((row) => ({
      id: binToUuid(row.id),
      displayName: row.display_name,
      legalName: row.legal_name,
      personType: row.person_type,
      document: row.document_normalized,
      status: row.status,
      products: row.products ? row.products.split(",") : [],
      instanceCount: Number(row.instance_count),
    })),
    total: Number(count[0]?.total ?? 0),
  };
}

/** Resumo de um contratante (prévia da solicitação de instância). */
export async function searchContractorById(
  ctx: AppContext,
  id: string,
): Promise<ContractorSummary | null> {
  const row = await findRow(ctx.core, id);
  if (!row) return null;
  const { rows } = await sql<{ products: string | null; instance_count: number }>`
    SELECT GROUP_CONCAT(DISTINCT product_code ORDER BY product_code) AS products,
           COUNT(*) AS instance_count
      FROM instance WHERE contractor_id = ${uuidToBin(id)}`.execute(ctx.core);
  return {
    id,
    displayName: row.display_name,
    legalName: row.legal_name,
    personType: row.person_type,
    document: row.document_normalized,
    status: row.status,
    products: rows[0]?.products ? rows[0].products.split(",") : [],
    instanceCount: Number(rows[0]?.instance_count ?? 0),
  };
}

export interface SimilarContractor {
  id: string;
  displayName: string;
  legalName: string;
  document: string | null;
  status: "ativo" | "inativo";
  match: "documento" | "nome";
}

/** Possíveis homônimos antes de criar: mesmo documento, mesma chave ou uma contida na outra. */
export async function similarContractors(
  ctx: AppContext,
  query: { legalName?: string; document?: string },
): Promise<SimilarContractor[]> {
  const key = query.legalName ? nameKey(query.legalName) : "";
  const document = query.document ? searchableDocument(query.document) : "";
  if (!key && !document) return [];
  const { rows } = await sql<{
    id: Buffer;
    display_name: string;
    legal_name: string;
    document_normalized: string | null;
    status: "ativo" | "inativo";
    by_document: number;
  }>`SELECT id, display_name, legal_name, document_normalized, status,
            (${document} <> '' AND document_normalized = ${document}) AS by_document
       FROM contractor
      WHERE (${document} <> '' AND document_normalized = ${document})
         OR (${key} <> '' AND (name_key = ${key} OR name_key LIKE ${likeTerm(key)}
                               OR ${key} LIKE CONCAT('%', name_key, '%')))
      ORDER BY by_document DESC, display_name
      LIMIT 10`.execute(ctx.core);
  return rows.map((row) => ({
    id: binToUuid(row.id),
    displayName: row.display_name,
    legalName: row.legal_name,
    document: row.document_normalized,
    status: row.status,
    match: row.by_document === 1 ? "documento" : "nome",
  }));
}

function diff(before: Row, after: Normalized): AuditChanges {
  const pairs: [string, unknown, unknown][] = [
    ["legalName", before.legal_name, after.legalName],
    ["displayName", before.display_name, after.displayName],
    ["personType", before.person_type, after.personType],
    ["document", before.document_normalized, after.document],
    ["contactName", before.contact_name, after.contactName],
    ["email", before.email, after.email],
    ["phone", before.phone, after.phone],
    ["address", before.address, after.address],
  ];
  return Object.fromEntries(
    pairs
      .filter(([, a, b]) => JSON.stringify(a) !== JSON.stringify(b))
      .map(([field, a, b]) => [field, [a, b] as const]),
  );
}

/** Edição com versão otimista (COM-027); UUID e instâncias nunca mudam (CA-SC-002). */
export async function updateContractor(
  ctx: AppContext,
  id: string,
  input: ContractorInput & { version: number },
  actor: Actor,
): Promise<Contractor> {
  const data = normalize(input);
  const now = ctx.clock();
  try {
    await ctx.core.transaction().execute(async (trx) => {
      const before = await findRow(trx, id, true);
      if (!before) throw contractorNotFound();
      if (before.version !== input.version) throw versionConflict();
      await sql`UPDATE contractor
                   SET legal_name = ${data.legalName}, display_name = ${data.displayName},
                       name_key = ${nameKey(data.legalName)}, person_type = ${data.personType},
                       document_type = ${data.documentType}, document_normalized = ${data.document},
                       contact_name = ${data.contactName}, email = ${data.email},
                       phone = ${data.phone},
                       address = ${data.address ? JSON.stringify(data.address) : null},
                       version = version + 1, updated_by = ${uuidToBin(actor.accountId)},
                       updated_at = ${now}
                 WHERE id = ${uuidToBin(id)}`.execute(trx);
      await recordAudit(trx, {
        actorKind: "usuario",
        actorId: actor.accountId,
        action: "contratante.editado",
        objectType: "contratante",
        objectId: id,
        changes: diff(before, data),
        correlationId: actor.correlationId,
        at: now,
      });
    });
  } catch (error) {
    if (isDuplicate(error)) throw await documentConflict(ctx, data);
    throw error;
  }
  const row = await findRow(ctx.core, id);
  if (!row) throw contractorNotFound();
  return toContractor(row);
}

/**
 * Inativar exige nenhuma instância ATIVA (SC-006, CA-SC-003); as instâncias são travadas na mesma
 * transação para que uma ativação concorrente (F03) não passe entre a verificação e a gravação.
 * Inativar não altera instâncias nem recursos (RN-SC-004).
 */
export async function setContractorStatus(
  ctx: AppContext,
  id: string,
  to: "ativo" | "inativo",
  input: { reason: string; version: number },
  actor: Actor,
): Promise<Contractor> {
  const now = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    const before = await findRow(trx, id, true);
    if (!before) throw contractorNotFound();
    if (before.version !== input.version) throw versionConflict();
    if (to === "inativo") {
      const { rows } = await sql<{ id: Buffer; display_name: string }>`
        SELECT id, display_name FROM instance
         WHERE contractor_id = ${uuidToBin(id)} AND state = 'ATIVA'
         ORDER BY display_name FOR UPDATE`.execute(trx);
      if (rows.length > 0) {
        throw new AppError(
          409,
          "CONFLICT_CONTRACTOR_HAS_ACTIVE_INSTANCES",
          "Há instâncias ativas deste contratante. Suspenda-as antes de inativá-lo.",
          {
            field: "/instances",
            details: rows.map((row) => ({
              field: "/instances",
              code: binToUuid(row.id),
              message: row.display_name,
            })),
          },
        );
      }
    }
    if (before.status === to) return;
    await sql`UPDATE contractor SET status = ${to}, version = version + 1,
                     updated_by = ${uuidToBin(actor.accountId)}, updated_at = ${now}
               WHERE id = ${uuidToBin(id)}`.execute(trx);
    await recordAudit(trx, {
      actorKind: "usuario",
      actorId: actor.accountId,
      action: to === "inativo" ? "contratante.inativado" : "contratante.reativado",
      objectType: "contratante",
      objectId: id,
      changes: { status: [before.status, to] },
      reason: input.reason,
      correlationId: actor.correlationId,
      at: now,
    });
  });
  const row = await findRow(ctx.core, id);
  if (!row) throw contractorNotFound();
  return toContractor(row);
}
