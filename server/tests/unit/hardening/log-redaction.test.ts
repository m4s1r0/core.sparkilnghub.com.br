import { Writable } from "node:stream";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/app/build-app.js";
import { randomToken } from "../../../src/platform/crypto/index.js";
import { loggerOptions, redactUrl } from "../../../src/platform/logging/logger.js";
import { testConfig } from "../../support/app.js";

/** SEC-16 / SEC-BASE-16: tokens de convite e de recuperação nunca chegam ao log da requisição. */
const TOKEN = randomToken();
const raw: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      raw.push(chunk.toString());
      callback();
    },
  });
  app = await buildApp({
    config: testConfig(),
    logger: pino({ ...loggerOptions, level: "info" }, stream),
    register: (instance) => {
      instance.get("/convite/:token", () => ({ ok: true }));
      instance.post("/api/v1/invitations/:token/accept", () => ({ ok: true }));
      instance.get("/api/v1/password-resets/:token", () => {
        throw new Error("falha qualquer");
      });
    },
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
});

describe("SEC-16 — mascaramento de tokens na URL do log", () => {
  it("redactUrl mascara os segmentos de token e o parâmetro token", () => {
    expect(redactUrl(`/convite/${TOKEN}`)).toBe("/convite/[REDACTED]");
    expect(redactUrl(`/api/v1/invitations/${TOKEN}/accept`)).toBe(
      "/api/v1/invitations/[REDACTED]/accept",
    );
    expect(redactUrl(`/api/v1/password-resets/${TOKEN}?x=1`)).toBe(
      "/api/v1/password-resets/[REDACTED]?x=1",
    );
    expect(redactUrl(`/qualquer?token=${TOKEN}&a=b`)).toBe("/qualquer?token=[REDACTED]&a=b");
    expect(redactUrl("/api/v1/instances")).toBe("/api/v1/instances");
  });

  it("nenhuma linha de log das requisições contém o token", async () => {
    await app.inject({ method: "GET", url: `/convite/${TOKEN}` });
    await app.inject({ method: "POST", url: `/api/v1/invitations/${TOKEN}/accept`, payload: {} });
    await app.inject({ method: "GET", url: `/api/v1/password-resets/${TOKEN}` });
    await app.inject({ method: "GET", url: `/convite/${TOKEN}?token=${TOKEN}` });
    const log = raw.join("");
    expect(log).toContain("/convite/[REDACTED]");
    expect(log).not.toContain(TOKEN);
  });
});
