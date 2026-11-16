import { type Connection, createConnection } from "mysql2/promise";
import type { AppContext } from "../../platform/context.js";
import { getResource, resourceSecret } from "../provisioning/resources.js";
import { sslField } from "../../platform/db/pools.js";
import type { Instance } from "./instances.js";

export type OperationalAccess<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Executa `fn` numa conexão curta com a credencial operacional já armazenada da instância
 * (research.md R-04): nunca usa a credencial do provisionador nem DDL. Falhas de credencial e de
 * conexão viram um motivo sanitizado; erros dentro de `fn` são propagados.
 */
export async function withOperationalConnection<T>(
  ctx: AppContext,
  instance: Instance,
  fn: (connection: Connection) => Promise<T>,
): Promise<OperationalAccess<T>> {
  const resource = await getResource(ctx.core, instance.id, "usuario_mysql");
  if (!resource || resource.status !== "verificado") {
    return { ok: false, reason: "sem credencial operacional verificada" };
  }
  let password: string;
  try {
    password = resourceSecret(ctx, instance.id, resource);
  } catch {
    return { ok: false, reason: "credencial operacional inválida" };
  }
  let connection: Connection;
  try {
    connection = await createConnection({
      host: ctx.config.MYSQL_HOST,
      port: ctx.config.MYSQL_PORT,
      user: resource.identifier,
      password,
      database: instance.databaseName,
      timezone: "Z",
      connectTimeout: 5_000,
      // A credencial operacional exige TLS fora do desenvolvimento (SEC-15).
      ...sslField(ctx.config),
    });
  } catch {
    return { ok: false, reason: "conexão recusada" };
  }
  try {
    return { ok: true, value: await fn(connection) };
  } finally {
    await connection.end().catch(() => undefined);
  }
}
