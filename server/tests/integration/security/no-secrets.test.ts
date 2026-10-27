import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Encode } from "../../../src/modules/identity/totp.js";
import { AuthFlow } from "../../support/auth-flow.js";
import { F01TestEnv } from "../../support/f01.js";
import { buildF01App, type F01App } from "../../support/f01-app.js";
import { appCredential, productFor } from "../../support/product.js";

let env: F01TestEnv;
let app: F01App;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

describe("nenhum segredo em logs, eventos ou respostas (CS-008, SC-033)", () => {
  it("fluxos completos de F01 não vazam senha, TOTP, códigos, tokens nem credenciais", async () => {
    const flow = new AuthFlow(env, app);
    const secrets: string[] = [];
    /** Respostas que não são de exibição única: nenhum segredo pode aparecer nelas. */
    const ordinary: string[] = [];

    // Bootstrap, aceite, cadastro de TOTP, login em dois passos (US1).
    const inviteToken = await flow.bootstrapToken("admin@example.test");
    const admin = await flow.admin("admin@example.test", inviteToken);
    secrets.push(inviteToken, admin.password, base32Encode(admin.secret), ...admin.recoveryCodes);
    secrets.push(admin.cookie);
    ordinary.push((await flow.request("GET", "/api/v1/session", { cookie: admin.cookie })).body);
    ordinary.push(
      (await flow.request("GET", "/api/v1/platform-admins", { cookie: admin.cookie })).body,
    );

    // Credencial de aplicação e login de produto (US3).
    const a = await env.createInstance("ref-a");
    const credential = await appCredential(env);
    secrets.push(credential.split(".")[1] ?? credential);
    const member = await env.insertAccount({ email: "carla@example.test" });
    await env.insertMembership(member.id, a.id, "colaborador");
    secrets.push(member.password);
    const product = await productFor(env, app, a, credential);
    const login = await product.login(member.email, member.password, "198.51.100.60");
    const instanceToken = (login.body as { token: string }).token;
    secrets.push(instanceToken);
    await product.touch(instanceToken);
    await product.login(member.email, "senha errada qualquer", "198.51.100.60");

    // Troca de senha pelo link de recuperação (US5).
    await flow.reauth(admin);
    const issued = await flow.request("POST", `/api/v1/accounts/${member.id}/password-reset`, {
      cookie: admin.cookie,
    });
    const resetToken = issued.json<{ link: string }>().link.split("/").pop() ?? "";
    secrets.push(resetToken, "nova senha da carla longa");
    ordinary.push(
      (
        await flow.request("POST", `/api/v1/password-resets/${resetToken}`, {
          payload: { password: "nova senha da carla longa" },
        })
      ).body,
    );
    ordinary.push(
      (await flow.request("GET", `/api/v1/accounts/${member.id}`, { cookie: admin.cookie })).body,
    );
    // Tentativa com token inválido também passa pelo log de requisição.
    await flow.request("GET", `/api/v1/invitations/${inviteToken}`);

    const { rows } = await sql`SELECT * FROM security_event`.execute(env.ctx.identity);
    const sources = {
      logs: app.raw.join("\n"),
      eventos: JSON.stringify(rows),
      respostas: ordinary.join("\n"),
    };
    const leaks: string[] = [];
    for (const [where, text] of Object.entries(sources)) {
      for (const secret of secrets) {
        if (secret && text.includes(secret)) leaks.push(`${where}: ${secret.slice(0, 6)}…`);
      }
    }
    expect(leaks).toEqual([]);
    expect(app.raw.length).toBeGreaterThan(0);
  });
});
