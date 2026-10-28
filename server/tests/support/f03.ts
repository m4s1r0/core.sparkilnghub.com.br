import { sql } from "kysely";
import type { ProvisionerRegistry } from "../../src/modules/catalog/provisioners.js";
import { createProductSession } from "../../src/modules/access-projection/writer.js";
import type { MemberState } from "../../src/modules/access-projection/source.js";
import {
  getInstance,
  type Instance,
  type InstanceState,
} from "../../src/modules/instances/instances.js";
import {
  activateInstance,
  enterMaintenance,
  suspendInstance,
  terminateInstance,
  type TransitionActor,
} from "../../src/modules/instances/transitions.js";
import { newId, uuidToBin } from "../../src/platform/ids.js";
import type { F01TestEnv } from "./f01.js";
import { requester, requestViaService, runProvisioning } from "./f02.js";

export const SYNTHETIC_REASON = "[SINTÉTICO] preparo de teste";

export interface PreparedInstance {
  instance: Instance;
  /** Conta da plataforma que solicitou o provisionamento (não é vínculo da instância). */
  requesterId: string;
  actor: TransitionActor;
}

async function mustGetInstance(env: F01TestEnv, instanceId: string): Promise<Instance> {
  const found = await getInstance(env.ctx, instanceId);
  if (!found) throw new Error("f03 support: instância não encontrada");
  return found;
}

/**
 * Leva uma instância nova do produto de referência até o estado pedido usando sempre as ações
 * reais do ciclo (provisionamento de F02 + transições de F03) — nunca `UPDATE` direto de
 * `instance.state`. A instância chega com um convite inicial pendente (não aceito), o que já a
 * torna elegível para `activateInstance` pela exceção de `SC-024`.
 */
export async function instanceAtState(
  env: F01TestEnv,
  state: InstanceState,
  options: { registry?: ProvisionerRegistry } = {},
): Promise<PreparedInstance> {
  const requesterId = await requester(env);
  const actor: TransitionActor = { kind: "usuario", id: requesterId };
  const { instanceId, taskId } = await requestViaService(
    env,
    requesterId,
    {},
    undefined,
    options.registry,
  );
  await runProvisioning(env, taskId, options.registry ? { registry: options.registry } : {});
  let instance = await mustGetInstance(env, instanceId);
  if (state === "CADASTRADA" || state === "PROVISIONANDO" || state === "PRONTA") {
    return { instance, requesterId, actor };
  }
  instance = await activateInstance(env.ctx, instanceId, actor);
  if (state === "ATIVA") return { instance, requesterId, actor };
  if (state === "MANUTENCAO") {
    instance = await enterMaintenance(env.ctx, instanceId, actor, SYNTHETIC_REASON);
    return { instance, requesterId, actor };
  }
  if (state === "SUSPENSA" || state === "ENCERRADA") {
    instance = await suspendInstance(env.ctx, instanceId, actor, SYNTHETIC_REASON);
    if (state === "SUSPENSA") return { instance, requesterId, actor };
    instance = await terminateInstance(env.ctx, instanceId, actor, {
      reason: SYNTHETIC_REASON,
      exportReference: null,
      retentionPolicy: "30 dias (teste)",
    });
    return { instance, requesterId, actor };
  }
  throw new Error(`f03 support: estado não suportado em teste: ${state}`);
}

/**
 * Sessão de produto real (vínculo administrador ou colaborador) na instância, para os testes de
 * suspensão/reativação que precisam de uma sessão de fato aberta antes da transição.
 */
export async function openSessionFor(
  env: F01TestEnv,
  instance: Instance,
  role: "administrador" | "colaborador" = "administrador",
): Promise<{ token: string; accountId: string; membershipId: string }> {
  const account = await env.insertAccount();
  const membershipId = await env.insertMembership(account.id, instance.id, role);
  const member: MemberState = {
    membershipId,
    accountId: account.id,
    instanceId: instance.id,
    displayName: "[SINTÉTICO] Vínculo de teste",
    role,
    status: "ativo",
    accountStatus: "ativa",
    accountAuthRevision: 1,
    version: 1,
  };
  const { token } = await createProductSession(env.ctx, instance, member);
  return { token, accountId: account.id, membershipId };
}

export async function insertHealthCheck(
  env: F01TestEnv,
  instanceId: string,
  options: {
    healthy?: boolean;
    schemaVersion?: number | null;
    reason?: string | null;
    origin?: "painel" | "saida_manutencao";
    checkedAt?: Date;
  } = {},
): Promise<void> {
  await sql`INSERT INTO instance_health_check
      (id, instance_id, checked_at, healthy, schema_version, reason, origin)
    VALUES (${uuidToBin(newId())}, ${uuidToBin(instanceId)}, ${options.checkedAt ?? env.clock.now()},
            ${options.healthy ?? true}, ${options.schemaVersion ?? null}, ${options.reason ?? null},
            ${options.origin ?? "painel"})`.execute(env.ctx.core);
}

export async function insertBackupRecord(
  env: F01TestEnv,
  instanceId: string,
  options: {
    result?: "sucesso" | "falha";
    origin?: string;
    detail?: string | null;
    takenAt?: Date;
  } = {},
): Promise<void> {
  const now = env.clock.now();
  await sql`INSERT INTO instance_backup_record
      (id, instance_id, taken_at, result, origin, detail, reported_at)
    VALUES (${uuidToBin(newId())}, ${uuidToBin(instanceId)}, ${options.takenAt ?? now},
            ${options.result ?? "sucesso"}, ${options.origin ?? "[SINTÉTICO] teste"},
            ${options.detail ?? null}, ${now})`.execute(env.ctx.core);
}
