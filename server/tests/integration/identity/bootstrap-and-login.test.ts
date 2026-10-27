import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BootstrapRefused, bootstrapAdmin } from "../../../src/modules/identity/bootstrap.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { type Admin, AuthFlow, sessionCookieOf } from "../../support/auth-flow.js";

let env: F01TestEnv;
let app: F01App;
let flow: AuthFlow;
let admin: Admin;
const MIN = 60_000;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  flow = new AuthFlow(env, app);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("US1 — bootstrap e primeiro acesso (FR-005 a FR-007)", () => {
  let token: string;

  it("bootstrap gera um convite de 48 h; segundo bootstrap com convite pendente é recusado", async () => {
    const result = await bootstrapAdmin(env.ctx, "Admin@Example.test");
    expect(result.link).toMatch(/\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt.getTime() - env.clock.now().getTime()).toBe(48 * 3600_000);
    token = result.link.slice(result.link.lastIndexOf("/") + 1);
    await expect(bootstrapAdmin(env.ctx, "outro@example.test")).rejects.toBeInstanceOf(
      BootstrapRefused,
    );
    const { rows } = await sql<{ token_hash: string }>`SELECT token_hash FROM invitation`.execute(
      env.ctx.identity,
    );
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("convite é inspecionável sem revelar o e-mail inteiro", async () => {
    const response = await flow.request("GET", `/api/v1/invitations/${token}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      target: "plataforma",
      emailMasked: "a***@example.test",
      accountExists: false,
    });
    const invalid = await flow.request("GET", `/api/v1/invitations/${"x".repeat(43)}`);
    expect(invalid.statusCode).toBe(404);
  });

  it("aceite exige a política de senha", async () => {
    const weak = await flow.acceptNew(token, "curta");
    expect(weak.statusCode).toBe(422);
    const common = await flow.acceptNew(token, "unbelievable");
    expect(common.json()).toMatchObject({ error: { code: "PASSWORD_POLICY_REJECTED" } });
  });

  it("aceite cria a conta e exige cadastrar o TOTP antes de concluir", async () => {
    const accepted = await flow.acceptNew(token, "cavalo bateria grampo azul");
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ next: "mfa_enrollment" });
    const cookie = sessionCookieOf(accepted);
    expect(cookie).toBeDefined();
    // Sessão pré-MFA não acessa o painel.
    const status = await flow.request("GET", "/api/v1/system/status", { cookie });
    expect(status.statusCode).toBe(401);
    // Convite não serve duas vezes.
    expect((await flow.acceptNew(token, "cavalo bateria grampo azul")).statusCode).toBe(404);

    const { recoveryCodes } = await flow.enroll(cookie ?? "");
    expect(recoveryCodes).toHaveLength(10);
    const session = await flow.request("GET", "/api/v1/session", { cookie });
    expect(session.json()).toMatchObject({
      // O convite guarda o e-mail normalizado; a conta nasce com ele.
      account: { email: "admin@example.test" },
      mfa: { enrolled: true, confirmed: true },
      platformRole: "administrador",
    });
    // Códigos exibidos uma única vez: novo cadastro com fator confirmado é recusado.
    const again = await flow.request("POST", "/api/v1/account/mfa/enrollment", { cookie });
    expect(again.statusCode).toBe(409);
    expect((await flow.request("GET", "/api/v1/system/status", { cookie })).statusCode).toBe(200);
  });

  it("bootstrap com administrador ativo é recusado", async () => {
    await expect(bootstrapAdmin(env.ctx, "terceiro@example.test")).rejects.toBeInstanceOf(
      BootstrapRefused,
    );
  });
});

describe("US1 — login em dois passos, limitação e expiração (FR-004, FR-006, FR-013)", () => {
  beforeAll(async () => {
    flow.nextStep();
    admin = await flow.admin("segundo@example.test", await invite("segundo@example.test"));
  });

  async function invite(email: string): Promise<string> {
    // Convite de plataforma direto pelo serviço (o fluxo do painel é testado na US2).
    const { createPlatformInvitation } =
      await import("../../../src/modules/identity/invitations.js");
    const created = await createPlatformInvitation(env.ctx, { email, createdBy: null });
    return created.token;
  }

  it("senha certa → next=mfa e sessão pré-MFA; código válido → sessão plena", async () => {
    flow.nextStep();
    const { response, cookie } = await flow.login(admin.email, admin.password);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ next: "mfa" });
    const pre = await flow.request("GET", "/api/v1/system/status", { cookie });
    expect(pre.statusCode).toBe(401);
    expect(pre.json()).toMatchObject({ error: { code: "AUTH_MFA_REQUIRED" } });
    const wrong = await flow.mfa(cookie ?? "", { code: "000000" });
    expect(wrong.statusCode).toBe(401);
    const ok = await flow.mfa(cookie ?? "", { code: flow.code(admin.secret) });
    expect(ok.json()).toEqual({ next: "done" });
    // Mesmo código de novo (mesmo passo) é recusado.
    const reuse = await flow.mfa(cookie ?? "", { code: flow.code(admin.secret) });
    expect(reuse.statusCode).toBe(401);
    expect((await flow.request("GET", "/api/v1/system/status", { cookie })).statusCode).toBe(200);
  });

  it("senha errada e e-mail inexistente recebem a mesma resposta", async () => {
    const wrong = await flow.login(admin.email, "senha errada qualquer");
    const unknown = await flow.login("ninguem@example.test", "senha errada qualquer");
    expect(wrong.response.statusCode).toBe(401);
    expect(unknown.response.statusCode).toBe(401);
    const strip = (body: string) => ({
      ...(JSON.parse(body) as { error: object }).error,
      correlationId: null,
    });
    expect(strip(wrong.response.body)).toEqual(strip(unknown.response.body));
    expect(wrong.response.json()).toMatchObject({ error: { code: "AUTH_INVALID_CREDENTIALS" } });
  });

  it("11ª tentativa após 10 falhas → 429 com Retry-After, exista a conta ou não", async () => {
    for (const email of [admin.email, "fantasma@example.test"]) {
      for (let i = 0; i < 10; i += 1) await flow.login(email, "senha errada qualquer");
      const limited = await flow.login(email, admin.password);
      expect(limited.response.statusCode).toBe(429);
      expect(Number(limited.response.headers["retry-after"])).toBeGreaterThan(0);
      expect(limited.response.json()).toMatchObject({ error: { code: "AUTH_THROTTLED" } });
    }
    env.clock.advance(15 * MIN);
  });

  it("inatividade de 30 min e prazo absoluto de 8 h encerram a sessão", async () => {
    flow.nextStep();
    const { cookie } = await flow.login(admin.email, admin.password);
    await flow.mfa(cookie ?? "", { code: flow.code(admin.secret) });
    env.clock.advance(31 * MIN);
    const idle = await flow.request("GET", "/api/v1/session", { cookie });
    expect(idle.statusCode).toBe(401);

    flow.nextStep();
    const second = await flow.login(admin.email, admin.password);
    await flow.mfa(second.cookie ?? "", { code: flow.code(admin.secret) });
    // 16 × 29 min = 7 h 44 min com atividade; mais 29 min passa das 8 h absolutas.
    for (let i = 0; i < 16; i += 1) {
      env.clock.advance(29 * MIN);
      expect(
        (await flow.request("GET", "/api/v1/session", { cookie: second.cookie })).statusCode,
      ).toBe(200);
    }
    env.clock.advance(29 * MIN);
    expect(
      (await flow.request("GET", "/api/v1/session", { cookie: second.cookie })).statusCode,
    ).toBe(401);
  });

  it("logout invalida o cookie no servidor", async () => {
    flow.nextStep();
    const { cookie } = await flow.login(admin.email, admin.password);
    await flow.mfa(cookie ?? "", { code: flow.code(admin.secret) });
    const out = await flow.request("POST", "/api/v1/auth/logout", { cookie });
    expect(out.statusCode).toBe(204);
    expect((await flow.request("GET", "/api/v1/session", { cookie })).statusCode).toBe(401);
  });

  it("código de recuperação entra uma vez e exige recadastrar o TOTP", async () => {
    const [first] = admin.recoveryCodes;
    const { cookie } = await flow.login(admin.email, admin.password);
    const used = await flow.mfa(cookie ?? "", { recoveryCode: first ?? "" });
    expect(used.json()).toEqual({ next: "mfa_enrollment" });
    expect((await flow.request("GET", "/api/v1/system/status", { cookie })).statusCode).toBe(401);
    const enrolled = await flow.enroll(cookie ?? "");
    admin.secret = enrolled.secret;
    admin.recoveryCodes = enrolled.recoveryCodes;
    expect((await flow.request("GET", "/api/v1/system/status", { cookie })).statusCode).toBe(200);

    flow.nextStep();
    const again = await flow.login(admin.email, admin.password);
    expect((await flow.mfa(again.cookie ?? "", { recoveryCode: first ?? "" })).statusCode).toBe(
      401,
    );
  });

  it("eventos de segurança registrados sem senha nem código", async () => {
    const { rows } = await sql<{ type: string; result: string; detail: unknown }>`
      SELECT type, result, detail FROM security_event`.execute(env.ctx.identity);
    const types = new Set(rows.map((r) => `${r.type}:${r.result}`));
    for (const expected of [
      "bootstrap:sucesso",
      "convite_aceito:sucesso",
      "mfa_cadastrado:sucesso",
      "login:sucesso",
      "login:falha",
      "login_mfa:sucesso",
      "login_mfa:falha",
      "logout:sucesso",
      "sessao_expirada:sucesso",
      "codigo_recuperacao_usado:sucesso",
    ]) {
      expect(types, expected).toContain(expected);
    }
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(admin.password);
    for (const code of admin.recoveryCodes) expect(dump).not.toContain(code);
  });
});

describe("convites simultâneos", () => {
  it("convites criados ao mesmo tempo não falham por deadlock (todos gravados)", async () => {
    const { createPlatformInvitation } =
      await import("../../../src/modules/identity/invitations.js");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        createPlatformInvitation(env.ctx, {
          email: `simultaneo-${i}@example.test`,
          createdBy: null,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
  });
});

describe("cadastros simultâneos", () => {
  it("dois administradores confirmam o TOTP ao mesmo tempo sem erro", async () => {
    const { createPlatformInvitation } =
      await import("../../../src/modules/identity/invitations.js");
    const accepted = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const { token } = await createPlatformInvitation(env.ctx, {
          email: `paralelo-${i}@example.test`,
          createdBy: null,
        });
        const response = await flow.acceptNew(token, `senha paralela ${i} longa`);
        return sessionCookieOf(response) ?? "";
      }),
    );
    const enrolled = await Promise.allSettled(accepted.map((cookie) => flow.enroll(cookie)));
    expect(enrolled.filter((r) => r.status === "rejected").map((r) => String(r.reason))).toEqual(
      [],
    );
  });
});
