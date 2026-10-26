import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply } from "fastify";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export function hasWebBuild(webRoot: string): boolean {
  return existsSync(join(webRoot, "index.html"));
}

/**
 * Serve a interface construída (`web/dist`) na mesma origem da API (research.md R-07), com CSP
 * restrita a `'self'`. Devolve o fallback de SPA usado pelo tratamento de 404.
 */
export async function registerWeb(app: FastifyInstance, webRoot: string) {
  await app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false,
    index: ["index.html"],
    setHeaders: (res, path) => {
      if (path.endsWith(".html")) {
        void res.header("content-security-policy", CONTENT_SECURITY_POLICY);
        void res.header("cache-control", "no-cache");
      }
    },
  });
  return (_request: unknown, reply: FastifyReply) => {
    void reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
    void reply.header("cache-control", "no-cache");
    return reply.type("text/html; charset=utf-8").sendFile("index.html");
  };
}
