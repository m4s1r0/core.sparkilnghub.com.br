import type { FastifyInstance } from "fastify";
import { AppError } from "../../app/errors.js";
import type { Config } from "../config/load.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Proteção contra CSRF (FR-015, R-05): além do cookie SameSite=Strict, todo método inseguro em
 * `/api/` precisa vir da própria origem — `Sec-Fetch-Site: same-origin` ou `Origin` igual a
 * `PUBLIC_ORIGIN`. `/internal/v1` usa credencial de aplicação, nunca cookie, e fica de fora.
 */
export function registerOriginCheck(app: FastifyInstance, config: Config): void {
  app.addHook("onRequest", (request, _reply, done) => {
    if (
      !UNSAFE.has(request.method) ||
      !request.url.startsWith("/api/") ||
      request.headers["sec-fetch-site"] === "same-origin" ||
      request.headers.origin === config.PUBLIC_ORIGIN
    ) {
      done();
      return;
    }
    done(
      new AppError(403, "AUTH_CSRF_REJECTED", "Requisição recusada pela verificação de origem."),
    );
  });
}
