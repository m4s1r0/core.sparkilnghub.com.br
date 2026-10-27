import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reconcileInstance } from "../../../src/modules/access-projection/reconcile.js";
import { getInstance } from "../../../src/modules/instances/instances.js";
import { initialInvitationStatus } from "../../../src/modules/provisioning/initial-invitation.js";
import { uuidToBin } from "../../../src/platform/ids.js";
import { type Admin, AuthFlow } from "../../support/auth-flow.js";
import { bodyOf, expectMatchesContract } from "../../support/contract.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { requester, requestViaService, runProvisioning, stepRuns } from "../../support/f02.js";
import { appCredential } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
let accountId: string;
const HOUR = 3600_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
  admin = await flow.admin("admin-convite-inicial@example.test");
  accountId = await requester(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const issue = (instanceId: string, key: string = crypto.randomUUID()) =>
  flow.request("POST", `/api/v1/instances/${instanceId}/initial-invitation/issue`, {
    cookie: admin.cookie,
    headers: { "idempotency-key": key },
  });

/** A sessão do Core dura no máximo 8 h: depois de avançar o relógio, entra de novo. */
async function relogin() {
  flow.nextStep();
  const { cookie } = await flow.login(admin.email, admin.password);
  if (!cookie) throw new Error("login");
  flow.nextStep();
  const mfa = await flow.mfa(cookie, { code: flow.code(admin.secret) });
  if (mfa.statusCode !== 200) throw new Error(`mfa ${mfa.statusCode}`);
  admin = { ...admin, cookie };
}

const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);

async function readyInstance(email = `dona-${crypto.randomUUID().slice(0, 8)}@example.test`) {
  const { instanceId, taskId } = await requestViaService(env, accountId, {
    initialAdminEmail: email,
  });
  expect(await runProvisioning(env, taskId)).toBe("concluida");
  return { instanceId, taskId, email };
}

describe("convite inicial preparado e emissão do link (US5, SC-024, FR-034 a FR-036, D-07)", () => {
  it("aguardando emissão após o provisionamento; emitir exige TOTP recente e PRONTA", async () => {
    const { instanceId } = await readyInstance();
    expect(await initialInvitationStatus(env.ctx, instanceId)).toEqual({
      status: "aguardando_emissao",
      expiresAt: null,
    });

    env.clock.advance(6 * 60_000);
    const stale = await issue(instanceId);
    expect(stale.statusCode).toBe(403);
    expect((await flow.reauth(admin)).statusCode).toBe(200);

    const pending = await requestViaService(env, accountId);
    const notReady = await issue(pending.instanceId);
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json<{ error: { code: string } }>().error.code).toBe("CONFLICT_STATE");
  });

  it("emissão exibe o link uma vez (48 h); reemitir invalida o anterior sem tocar em recursos", async () => {
    const { instanceId, taskId } = await readyInstance();
    const runsBefore = (await stepRuns(env, taskId)).length;
    const { rows: resourcesBefore } = await sql<{ status: string; updated_at: Date }>`
      SELECT status, updated_at FROM instance_resource WHERE instance_id = ${uuidToBin(instanceId)}
       ORDER BY kind`.execute(env.ctx.core);

    const key = crypto.randomUUID();
    const first = await issue(instanceId, key);
    expectMatchesContract("issueInitialInvitation", first.statusCode, bodyOf(first));
    expect(first.statusCode).toBe(201);
    const link = first.json<{ link: string; expiresAt: string }>();
    expect(new Date(link.expiresAt).getTime() - env.clock.now().getTime()).toBe(48 * HOUR);
    const replay = await issue(instanceId, key);
    expect(replay.body).toBe(first.body);
    expect(await initialInvitationStatus(env.ctx, instanceId)).toMatchObject({ status: "emitido" });

    const second = await issue(instanceId);
    const secondLink = second.json<{ link: string }>().link;
    expect(secondLink).not.toBe(link.link);
    const old = await flow.request("GET", `/api/v1/invitations/${tokenOf(link.link)}`);
    expect(old.statusCode).toBe(404);

    expect((await stepRuns(env, taskId)).length).toBe(runsBefore);
    const { rows: resourcesAfter } = await sql<{ status: string; updated_at: Date }>`
      SELECT status, updated_at FROM instance_resource WHERE instance_id = ${uuidToBin(instanceId)}
       ORDER BY kind`.execute(env.ctx.core);
    expect(resourcesAfter).toEqual(resourcesBefore);
    const { rows: audit } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM core_audit_event
       WHERE object_id = ${instanceId} AND action = 'convite_inicial.emitido'`.execute(
      env.ctx.core,
    );
    expect(Number(audit[0]?.n)).toBe(2);

    // Depois de 48 h, expirado; reemitir volta a valer.
    env.clock.advance(48 * HOUR + 1);
    expect(await initialInvitationStatus(env.ctx, instanceId)).toMatchObject({
      status: "expirado",
    });
    await relogin();
    const renewed = await issue(instanceId);
    expect(renewed.statusCode).toBe(201);
    expect(await initialInvitationStatus(env.ctx, instanceId)).toMatchObject({ status: "emitido" });
  });

  it("aceite antes da ativação: vínculo administrador replicado; login de produto segue negado", async () => {
    const { instanceId, email } = await readyInstance();
    await flow.reauth(admin);
    const response = await issue(instanceId);
    const token = tokenOf(response.json<{ link: string }>().link);
    const accepted = await flow.acceptNew(token, "senha da dona da loja longa");
    expect(accepted.statusCode).toBe(200);
    expect(await initialInvitationStatus(env.ctx, instanceId)).toMatchObject({ status: "aceito" });
    expect((await getInstance(env.ctx, instanceId))?.state).toBe("PRONTA");

    const { rows } = await sql<{ role: string; status: string }>`SELECT m.role, m.status
       FROM membership m JOIN account a ON a.id = m.account_id
      WHERE m.instance_id = ${uuidToBin(instanceId)} AND a.email_normalized = ${email}`.execute(
      env.ctx.identity,
    );
    expect(rows).toEqual([{ role: "administrador", status: "ativo" }]);

    const instance = await getInstance(env.ctx, instanceId);
    if (!instance) throw new Error("instância");
    const { rows: replica } = await sql<{ role: string }>`SELECT role FROM access_member`.execute(
      env.ctx.access(instance.accessDatabaseName),
    );
    expect(replica).toEqual([{ role: "administrador" }]);
    expect((await reconcileInstance(env.ctx, instance)).divergences).toBe(0);

    const credential = await appCredential(env);
    const login = await app.app.inject({
      method: "POST",
      url: `/internal/v1/instances/${instance.slug}/sessions`,
      headers: { authorization: `Bearer ${credential}` },
      payload: { email, password: "senha da dona da loja longa", clientIp: "198.51.100.9" },
    });
    expect(login.statusCode).toBe(401);

    await flow.reauth(admin);
    const afterAccept = await issue(instanceId);
    expect(afterAccept.statusCode).toBe(409);
    expect(afterAccept.json<{ error: { code: string } }>().error.code).toBe(
      "CONFLICT_INITIAL_INVITATION_ACCEPTED",
    );
  });

  it("convites criados por pessoas (F01) têm o link marcado como emitido", async () => {
    const { rows } = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM invitation
       WHERE link_issued_at IS NULL AND is_initial = FALSE`.execute(env.ctx.identity);
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
