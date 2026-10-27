import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import type { Page } from "../../platform/http/pagination.js";
import { binToUuid, uuidToBin } from "../../platform/ids.js";
import { recordAudit } from "../audit/audit.js";
import { initialInvitationStatus } from "../provisioning/initial-invitation.js";
import { getInstance, type InstanceState } from "./instances.js";

export type TaskStatus =
  "pendente" | "em_execucao" | "aguardando_repeticao" | "concluida" | "falhou";

/** Item de lista de instâncias (contracts/openapi.yaml `InstanceSummary`). */
export interface InstanceSummary {
  id: string;
  contractorId: string;
  contractorName: string;
  productCode: string;
  slug: string;
  displayName: string;
  state: InstanceState;
  synthetic: boolean;
  lastTask: { protocol: string; status: TaskStatus } | null;
  validityExpired: boolean;
  createdAt: string;
}

export interface InstanceFilter {
  id?: string;
  contractorId?: string;
  productCode?: string;
  state?: InstanceState;
  /** Datas civis em America/Sao_Paulo, inclusivas: [createdFrom, createdTo + 1 dia). */
  createdFrom?: string;
  createdTo?: string;
}

export const protocolOf = (seq: number | bigint | string) => `PRV-${String(seq).padStart(6, "0")}`;

/** Data civil de hoje no fuso da instância (`YYYY-MM-DD`). */
export function localToday(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Início de uma data civil de São Paulo em UTC (o painel usa o fuso padrão de D-09). */
function saoPauloStart(date: string, plusDays = 0): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // America/Sao_Paulo não tem horário de verão desde 2019: UTC−3 fixo.
  return new Date(Date.UTC(y, m - 1, d + plusDays, 3));
}

interface SummaryRow {
  id: Buffer;
  contractor_id: Buffer;
  contractor_name: string;
  product_code: string;
  slug: string;
  display_name: string;
  state: InstanceState;
  synthetic: number;
  timezone: string;
  valid_until: Date | string | null;
  created_at: Date;
  task_seq: number | null;
  task_status: TaskStatus | null;
}

function where(filter: InstanceFilter) {
  const conditions = [sql`TRUE`];
  if (filter.id) conditions.push(sql`i.id = ${uuidToBin(filter.id)}`);
  if (filter.contractorId)
    conditions.push(sql`i.contractor_id = ${uuidToBin(filter.contractorId)}`);
  if (filter.productCode) conditions.push(sql`i.product_code = ${filter.productCode}`);
  if (filter.state) conditions.push(sql`i.state = ${filter.state}`);
  if (filter.createdFrom)
    conditions.push(sql`i.created_at >= ${saoPauloStart(filter.createdFrom)}`);
  if (filter.createdTo) conditions.push(sql`i.created_at < ${saoPauloStart(filter.createdTo, 1)}`);
  return sql.join(conditions, sql` AND `);
}

/** Instâncias filtradas e paginadas, com a última tarefa e a pendência de vigência. */
export async function listInstanceSummaries(
  ctx: AppContext,
  filter: InstanceFilter,
  page: Page,
): Promise<{ items: InstanceSummary[]; total: number }> {
  const now = ctx.clock();
  const { rows } = await sql<SummaryRow>`
    SELECT i.id, i.contractor_id, c.display_name AS contractor_name, i.product_code, i.slug,
           i.display_name, i.state, i.synthetic, i.timezone, i.valid_until, i.created_at,
           t.seq AS task_seq, t.status AS task_status
      FROM instance i
      JOIN contractor c ON c.id = i.contractor_id
      LEFT JOIN admin_task t ON t.seq = (SELECT MAX(seq) FROM admin_task WHERE instance_id = i.id)
     WHERE ${where(filter)}
     ORDER BY i.created_at DESC, i.id
     LIMIT ${page.pageSize} OFFSET ${(page.page - 1) * page.pageSize}`.execute(ctx.core);
  const { rows: count } = await sql<{ total: number }>`
    SELECT COUNT(*) AS total FROM instance i WHERE ${where(filter)}`.execute(ctx.core);
  return {
    items: rows.map((row) => {
      const validUntil =
        row.valid_until === null
          ? null
          : typeof row.valid_until === "string"
            ? row.valid_until
            : row.valid_until.toISOString().slice(0, 10);
      return {
        id: binToUuid(row.id),
        contractorId: binToUuid(row.contractor_id),
        contractorName: row.contractor_name,
        productCode: row.product_code,
        slug: row.slug,
        displayName: row.display_name,
        state: row.state,
        synthetic: row.synthetic === 1,
        lastTask:
          row.task_seq !== null && row.task_status !== null
            ? { protocol: protocolOf(row.task_seq), status: row.task_status }
            : null,
        validityExpired: validUntil !== null && validUntil < localToday(row.timezone, now),
        createdAt: row.created_at.toISOString(),
      };
    }),
    total: Number(count[0]?.total ?? 0),
  };
}

export interface InstanceTransitionView {
  from: InstanceState | null;
  to: InstanceState;
  actorKind: "usuario" | "sistema";
  actorName: string;
  reason: string | null;
  at: string;
}

export const instanceNotFound = () => new AppError(404, "NOT_FOUND", "Instância não encontrada.");

const civil = (value: Date | string | null) =>
  value === null ? null : typeof value === "string" ? value : value.toISOString().slice(0, 10);

/** Detalhe da instância (contracts/openapi.yaml `InstanceDetail`): nunca credencial nem senha. */
export async function instanceDetail(ctx: AppContext, id: string) {
  const instance = await getInstance(ctx, id);
  if (!instance) throw instanceNotFound();
  const { items } = await listInstanceSummaries(ctx, { id }, { page: 1, pageSize: 1 });
  const summary = items[0];
  if (!summary) throw instanceNotFound();
  const { rows } = await sql<{
    from_state: InstanceState | null;
    to_state: InstanceState;
    actor_kind: "usuario" | "sistema";
    actor_id: Buffer | null;
    reason: string | null;
    created_at: Date;
  }>`SELECT from_state, to_state, actor_kind, actor_id, reason, created_at
       FROM instance_transition WHERE instance_id = ${uuidToBin(id)}
      ORDER BY created_at, id`.execute(ctx.core);
  const people = [...new Set(rows.flatMap((r) => (r.actor_id ? [binToUuid(r.actor_id)] : [])))];
  const names = new Map<string, string>();
  if (people.length > 0) {
    const { rows: accounts } = await sql<{ id: Buffer; display_name: string }>`
      SELECT id, display_name FROM account
       WHERE id IN (${sql.join(people.map(uuidToBin))})`.execute(ctx.identity);
    for (const account of accounts) names.set(binToUuid(account.id), account.display_name);
  }
  return {
    ...summary,
    timezone: instance.timezone,
    initialAdminEmail: instance.initialAdminEmail ?? "",
    schemaVersion: instance.schemaVersion,
    notes: instance.notes,
    validFrom: instance.validFrom,
    validUntil: instance.validUntil,
    version: instance.version,
    initialInvitation: await initialInvitationStatus(ctx, id),
    transitions: rows.map((row): InstanceTransitionView => ({
      from: row.from_state,
      to: row.to_state,
      actorKind: row.actor_kind,
      actorName:
        row.actor_kind === "sistema"
          ? "Sistema"
          : ((row.actor_id && names.get(binToUuid(row.actor_id))) ?? "Administrador"),
      reason: row.reason,
      at: row.created_at.toISOString(),
    })),
  };
}

export interface InstanceEdit {
  displayName: string;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
  version: number;
}

/**
 * Nome de exibição, anotações e vigência (SC-016, SC-017) com versão otimista (COM-027). Slug,
 * produto e contratante são imutáveis; vigência vencida é só pendência, sem mudar o estado.
 */
export async function updateInstance(
  ctx: AppContext,
  id: string,
  input: InstanceEdit,
  actor: { accountId: string; correlationId: string },
) {
  if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
    throw new AppError(
      422,
      "VALIDATION_FAILED",
      "O fim da vigência não pode ser anterior ao início.",
      { field: "/validUntil" },
    );
  }
  const now = ctx.clock();
  await ctx.core.transaction().execute(async (trx) => {
    const { rows } = await sql<{
      display_name: string;
      notes: string | null;
      valid_from: Date | string | null;
      valid_until: Date | string | null;
      version: number;
    }>`SELECT display_name, notes, valid_from, valid_until, version FROM instance
        WHERE id = ${uuidToBin(id)} FOR UPDATE`.execute(trx);
    const before = rows[0];
    if (!before) throw instanceNotFound();
    if (before.version !== input.version) {
      throw new AppError(
        409,
        "CONFLICT_VERSION",
        "A instância foi alterada por outra pessoa. Recarregue para ver a versão atual.",
      );
    }
    const notes = input.notes?.trim() || null;
    await sql`UPDATE instance
                 SET display_name = ${input.displayName.trim()}, notes = ${notes},
                     valid_from = ${input.validFrom}, valid_until = ${input.validUntil},
                     version = version + 1, updated_at = ${now}
               WHERE id = ${uuidToBin(id)}`.execute(trx);
    await recordAudit(trx, {
      actorKind: "usuario",
      actorId: actor.accountId,
      action: "instancia.editada",
      objectType: "instancia",
      objectId: id,
      changes: {
        displayName: [before.display_name, input.displayName.trim()],
        notes: [before.notes, notes],
        validFrom: [civil(before.valid_from), input.validFrom],
        validUntil: [civil(before.valid_until), input.validUntil],
      },
      correlationId: actor.correlationId,
      at: now,
    });
  });
  return instanceDetail(ctx, id);
}
