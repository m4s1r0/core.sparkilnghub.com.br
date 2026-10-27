import type { LightMyRequestResponse } from "fastify";
import { bootstrapAdmin } from "../../src/modules/identity/bootstrap.js";
import { base32Decode, totpCode } from "../../src/modules/identity/totp.js";
import type { F01TestEnv } from "./f01.js";
import type { F01App } from "./f01-app.js";

export const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

/** Valor do cookie de sessão definido pela resposta, ou `undefined`. */
export function sessionCookieOf(response: LightMyRequestResponse): string | undefined {
  const header = response.headers["set-cookie"];
  const all = Array.isArray(header) ? header : header ? [header] : [];
  for (const line of all) {
    const match = /^sparkcore_session=([^;]*)/.exec(line);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export interface Admin {
  email: string;
  password: string;
  secret: Buffer;
  cookie: string;
  recoveryCodes: string[];
}

/**
 * Fluxo HTTP de autenticação contra o app de teste. O relógio do ambiente governa o TOTP: cada
 * código usa o passo atual, e um passo já usado é recusado (anti-reuso).
 */
export class AuthFlow {
  constructor(
    readonly env: F01TestEnv,
    readonly app: F01App,
  ) {}

  request(
    method: "GET" | "POST" | "PUT",
    url: string,
    options: {
      cookie?: string | undefined;
      payload?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) {
    return this.app.app.inject({
      method,
      url,
      headers: {
        ...SAME_ORIGIN,
        ...(options.cookie ? { cookie: `sparkcore_session=${options.cookie}` } : {}),
        ...options.headers,
      },
      ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    });
  }

  code(secret: Buffer): string {
    return totpCode(secret, this.env.clock.now().getTime());
  }

  /** Avança para o próximo passo de 30 s (o código anterior não serve mais). */
  nextStep(): void {
    this.env.clock.advance(30_000);
  }

  async bootstrapToken(email: string): Promise<string> {
    const { link } = await bootstrapAdmin(this.env.ctx, email);
    return link.slice(link.lastIndexOf("/") + 1);
  }

  async acceptNew(token: string, password: string, displayName = "[SINTÉTICO] Administrador") {
    return this.request("POST", `/api/v1/invitations/${token}/accept`, {
      payload: { displayName, password },
    });
  }

  /** Cadastra o TOTP com a sessão (pré-MFA) e devolve segredo e códigos de recuperação. */
  async enroll(cookie: string): Promise<{ secret: Buffer; recoveryCodes: string[] }> {
    const start = await this.request("POST", "/api/v1/account/mfa/enrollment", { cookie });
    if (start.statusCode !== 201) throw new Error(`enrollment ${start.statusCode} ${start.body}`);
    const secret = base32Decode(start.json<{ secret: string }>().secret);
    const confirm = await this.request("POST", "/api/v1/account/mfa/enrollment/confirm", {
      cookie,
      payload: { code: this.code(secret) },
    });
    if (confirm.statusCode !== 200)
      throw new Error(`confirm ${confirm.statusCode} ${confirm.body}`);
    return { secret, recoveryCodes: confirm.json<{ codes: string[] }>().codes };
  }

  async login(email: string, password: string) {
    const response = await this.request("POST", "/api/v1/auth/login", {
      payload: { email, password },
    });
    return { response, cookie: sessionCookieOf(response) };
  }

  async mfa(cookie: string, payload: { code: string } | { recoveryCode: string }) {
    return this.request("POST", "/api/v1/auth/mfa", { cookie, payload });
  }

  /** Administrador completo: bootstrap ou convite, aceite, TOTP e sessão plena. */
  async admin(email: string, token?: string): Promise<Admin> {
    const password = `senha forte de ${email}`;
    const accepted = await this.acceptNew(token ?? (await this.bootstrapToken(email)), password);
    const firstCookie = sessionCookieOf(accepted);
    if (accepted.statusCode !== 200 || !firstCookie) {
      throw new Error(`aceite ${accepted.statusCode} ${accepted.body}`);
    }
    const { secret, recoveryCodes } = await this.enroll(firstCookie);
    this.nextStep();
    const { cookie } = await this.login(email, password);
    if (!cookie) throw new Error("login sem cookie");
    const second = await this.mfa(cookie, { code: this.code(secret) });
    if (second.statusCode !== 200) throw new Error(`mfa ${second.statusCode} ${second.body}`);
    return { email, password, secret, cookie, recoveryCodes };
  }

  /** Reconfirma o TOTP (ações sensíveis exigem confirmação nos últimos 5 min). */
  async reauth(admin: Admin) {
    this.nextStep();
    return this.request("POST", "/api/v1/auth/reauth", {
      cookie: admin.cookie,
      payload: { code: this.code(admin.secret) },
    });
  }
}
