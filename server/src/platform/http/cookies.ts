import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config/load.js";

/**
 * Cookie da sessão do painel (R-04): HttpOnly, SameSite=Strict, Path=/, sem Domain (host exato)
 * e Secure fora de development. O prefixo `__Host-` exigiria Secure também no desenvolvimento
 * em http://127.0.0.1 e fica para quando houver HTTPS local.
 */
export const SESSION_COOKIE = "sparkcore_session";

/** Enfileira o plugin (carregado no `ready`); aguardá-lo aqui iniciaria o boot da raiz cedo. */
export function registerCookies(app: FastifyInstance): void {
  void app.register(cookie);
}

const options = (config: Config) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  secure: config.SPARK_ENV !== "development",
});

export function setSessionCookie(reply: FastifyReply, config: Config, token: string): void {
  void reply.setCookie(SESSION_COOKIE, token, options(config));
}

export function clearSessionCookie(reply: FastifyReply, config: Config): void {
  void reply.clearCookie(SESSION_COOKIE, options(config));
}

export function readSessionCookie(request: FastifyRequest): string | undefined {
  return request.cookies[SESSION_COOKIE];
}
