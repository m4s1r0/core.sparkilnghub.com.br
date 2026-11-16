import type { FastifyInstance } from "fastify";
import type { Config } from "../../platform/config/load.js";
import { CONTENT_SECURITY_POLICY } from "./web.js";

export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "interest-cohort=()",
].join(", ");

export const HSTS = "max-age=31536000; includeSubDomains";

/**
 * Cabeçalhos de segurança em TODAS as respostas — HTML, JSON, erros e 404 (SEC-22,
 * SEC-BASE-10). HSTS fora do desenvolvimento (homologação e produção são servidas por HTTPS).
 * API e contrato interno nunca vão a cache, salvo rota que já definiu `cache-control`.
 */
export function registerSecurityHeaders(app: FastifyInstance, config: Pick<Config, "SPARK_ENV">) {
  const hsts = config.SPARK_ENV !== "development";
  app.addHook("onSend", async (request, reply, payload) => {
    if (!reply.hasHeader("content-security-policy")) {
      void reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
    }
    void reply.header("x-content-type-options", "nosniff");
    void reply.header("referrer-policy", "no-referrer");
    void reply.header("permissions-policy", PERMISSIONS_POLICY);
    void reply.header("x-frame-options", "DENY");
    if (hsts) void reply.header("strict-transport-security", HSTS);
    const url = request.url;
    if (
      (url.startsWith("/api/") || url.startsWith("/internal/")) &&
      !reply.hasHeader("cache-control")
    ) {
      void reply.header("cache-control", "no-store");
    }
    return payload;
  });
}
