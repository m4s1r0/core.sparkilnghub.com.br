import { createConnection } from "mysql2/promise";
import { createAppCredential } from "../../src/modules/app-credentials/app-credentials.js";
import type { AppScope } from "../../src/platform/http/app-credential.js";
import { ReferenceProductClient } from "../../reference-product/client.js";
import type { F01TestEnv, TestInstance } from "./f01.js";
import type { F01App } from "./f01-app.js";

/** Credencial de aplicação do produto de referência (ou de outro produto, para negativos). */
export async function appCredential(
  env: F01TestEnv,
  productCode = "sparkref",
  scopes: AppScope[] = ["sessions", "members"],
): Promise<string> {
  return (await createAppCredential(env.ctx, { productCode, label: "teste", scopes })).value;
}

/**
 * Produto de referência ligado a UMA instância: banco de acesso com o usuário `inst_*` da
 * instância e chamadas ao Core pelo `inject` do app de teste.
 */
export async function productFor(
  env: F01TestEnv,
  app: F01App,
  instance: TestInstance,
  credential: string,
): Promise<ReferenceProductClient> {
  const connection = await createConnection({
    host: env.mysql.config.MYSQL_HOST,
    port: env.mysql.config.MYSQL_PORT,
    user: instance.user,
    password: instance.password,
    database: instance.accessDatabaseName,
    timezone: "Z",
  });
  env.trackConnection(connection);
  return new ReferenceProductClient({
    slug: instance.slug,
    credential,
    access: connection,
    http: async (request) => {
      const response = await app.app.inject({
        method: request.method,
        url: request.url,
        headers: request.headers,
        ...(request.body !== undefined ? { payload: request.body as object } : {}),
      });
      return {
        status: response.statusCode,
        body: response.body === "" ? undefined : (JSON.parse(response.body) as unknown),
        headers: response.headers as Record<string, string | string[] | undefined>,
      };
    },
  });
}
