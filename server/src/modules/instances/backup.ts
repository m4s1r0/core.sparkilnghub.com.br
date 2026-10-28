import { sql } from "kysely";
import { AppError } from "../../app/errors.js";
import type { AppContext } from "../../platform/context.js";
import { newId, uuidToBin } from "../../platform/ids.js";
import { getInstance } from "./instances.js";

export type BackupResult = "sucesso" | "falha";

export interface RecordBackupInput {
  instanceId: string;
  result: BackupResult;
  origin: string;
  detail: string | null;
  takenAt: Date;
}

/**
 * Grava um resultado de backup relatado pela ferramenta que de fato o executou (research.md
 * R-05). Só inclusão; nenhuma rota HTTP chama esta função — só o comando
 * `instances:report-backup`.
 */
export async function recordBackupResult(ctx: AppContext, input: RecordBackupInput): Promise<void> {
  const instance = await getInstance(ctx, input.instanceId);
  if (!instance) throw new AppError(404, "NOT_FOUND", "Instância não encontrada.");
  await sql`INSERT INTO instance_backup_record
      (id, instance_id, taken_at, result, origin, detail, reported_at)
    VALUES (${uuidToBin(newId())}, ${uuidToBin(input.instanceId)}, ${input.takenAt},
            ${input.result}, ${input.origin}, ${input.detail}, ${ctx.clock()})`.execute(ctx.core);
}

export interface BackupStatus {
  lastSuccessfulAt: Date | null;
  lastResult: BackupResult | null;
  origin: string | null;
}

/**
 * Último backup bem-sucedido conhecido; sua ausência é o estado padrão (nunca sucesso
 * implícito, `SC-042`). `lastResult`/`origin` refletem sempre a linha mais recente, mesmo
 * quando ela é uma falha — só `lastSuccessfulAt` exige `result = 'sucesso'`.
 */
export async function latestBackup(ctx: AppContext, instanceId: string): Promise<BackupStatus> {
  const { rows } = await sql<{
    taken_at: Date;
    result: BackupResult;
    origin: string;
  }>`SELECT taken_at, result, origin FROM instance_backup_record
      WHERE instance_id = ${uuidToBin(instanceId)} ORDER BY taken_at DESC LIMIT 1`.execute(
    ctx.core,
  );
  const latest = rows[0];
  if (!latest) return { lastSuccessfulAt: null, lastResult: null, origin: null };
  if (latest.result === "sucesso") {
    return { lastSuccessfulAt: latest.taken_at, lastResult: latest.result, origin: latest.origin };
  }
  const { rows: successRows } = await sql<{ taken_at: Date }>`
    SELECT taken_at FROM instance_backup_record
     WHERE instance_id = ${uuidToBin(instanceId)} AND result = 'sucesso'
     ORDER BY taken_at DESC LIMIT 1`.execute(ctx.core);
  return {
    lastSuccessfulAt: successRows[0]?.taken_at ?? null,
    lastResult: latest.result,
    origin: latest.origin,
  };
}

/** Existe backup bem-sucedido registrado depois do instante informado (executor de migração). */
export async function hasBackupSince(
  ctx: AppContext,
  instanceId: string,
  since: Date,
): Promise<boolean> {
  const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM instance_backup_record
     WHERE instance_id = ${uuidToBin(instanceId)} AND result = 'sucesso'
       AND taken_at >= ${since}`.execute(ctx.core);
  return Number(rows[0]?.n ?? 0) > 0;
}
