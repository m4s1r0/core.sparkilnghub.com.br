import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bindAppCredential,
  createAppCredential,
  issueAppCredential,
  listAppCredentials,
} from "../../../../src/modules/app-credentials/app-credentials.js";
import { F01TestEnv, type TestInstance } from "../../../support/f01.js";
import { buildF01App, type F01App } from "../../../support/f01-app.js";

/**
 * SEC-01 — operação: a CLI `app-credential` emite credencial por instância (`--instance`) e migra
 * credenciais por produto sem trocar o segredo (`bind`). Os comandos são finos sobre estas funções.
 */
let env: F01TestEnv;
let app: F01App;
let a: TestInstance;
let b: TestInstance;

beforeAll(async () => {
  env = await F01TestEnv.create();
  app = await buildF01App(env);
  a = await env.createInstance("cli-a");
  b = await env.createInstance("cli-b");
});
afterAll(async () => {
  await app?.close();
  await env?.cleanup();
});

const touch = (slug: string, credential: string) =>
  app.app.inject({
    method: "POST",
    url: `/internal/v1/instances/${slug}/sessions/touch`,
    headers: { authorization: `Bearer ${credential}`, "x-instance-session": "x".repeat(43) },
  });

describe("SEC-01 — CLI de credenciais por instância", () => {
  it("escopos de instância exigem --instance; instância de outro produto ou inexistente é recusada", async () => {
    await expect(
      issueAppCredential(env.ctx, { productCode: "sparkref", label: "t", scopes: ["sessions"] }),
    ).rejects.toThrow(/--instance/);
    await expect(
      issueAppCredential(env.ctx, {
        productCode: "outroproduto",
        label: "t",
        scopes: ["connection"],
        instanceRef: a.slug,
      }),
    ).rejects.toThrow(/inexistente/);
    await expect(
      issueAppCredential(env.ctx, {
        productCode: "outroproduto",
        label: "t",
        scopes: ["connection"],
        instanceRef: a.id,
      }),
    ).rejects.toThrow(/inexistente/);
  });

  it("--instance por slug ou UUID vincula; a credencial serve só àquela instância", async () => {
    const bySlug = await issueAppCredential(env.ctx, {
      productCode: "sparkref",
      label: "t",
      scopes: ["sessions"],
      instanceRef: a.slug,
    });
    const byId = await issueAppCredential(env.ctx, {
      productCode: "sparkref",
      label: "t",
      scopes: ["sessions"],
      instanceRef: b.id.toUpperCase(),
    });
    expect(bySlug.instance?.id).toBe(a.id);
    expect(byId.instance?.id).toBe(b.id);
    // Sessão inválida (401 AUTH_SESSION_INVALID) prova que a credencial passou; credencial errada
    // daria a mesma resposta pela instância — por isso conferimos o vínculo pela listagem.
    const listed = await listAppCredentials(env.ctx);
    expect(listed.find((c) => c.id === bySlug.id)).toMatchObject({
      instanceId: a.id,
      instanceSlug: a.slug,
    });
  });

  it("bind migra credencial por produto sem trocar o segredo e não troca de instância", async () => {
    const legacy = await createAppCredential(env.ctx, {
      productCode: "sparkref",
      label: "legada",
      scopes: ["sessions"],
    });
    const before = await touch(a.slug, legacy.value);
    expect(before.json<{ error: { code: string } }>().error.code).toBe(
      "AUTH_APP_CREDENTIAL_INVALID",
    );
    expect((await listAppCredentials(env.ctx)).find((c) => c.id === legacy.id)?.instanceId).toBe(
      null,
    );

    await bindAppCredential(env.ctx, legacy.id, a.slug);
    const after = await touch(a.slug, legacy.value);
    expect(after.json<{ error: { code: string } }>().error.code).toBe("AUTH_SESSION_INVALID");
    await expect(bindAppCredential(env.ctx, legacy.id, b.slug)).rejects.toThrow(/outra instância/);
    // Repetir o mesmo vínculo é idempotente.
    expect((await bindAppCredential(env.ctx, legacy.id, a.id)).id).toBe(a.id);
  });
});
