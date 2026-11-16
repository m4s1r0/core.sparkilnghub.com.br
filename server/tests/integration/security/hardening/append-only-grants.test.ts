import type { Connection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getInstance, type Instance } from "../../../../src/modules/instances/instances.js";
import { getResource, resourceSecret } from "../../../../src/modules/provisioning/resources.js";
import { syncAllOperationalGrants } from "../../../../src/modules/provisioning/grants-sync.js";
import { instanceAccount } from "../../../../src/platform/db/grants.js";
import { grantDatabaseName, instanceUserName } from "../../../../src/platform/ids.js";
import { F01TestEnv } from "../../../support/f01.js";
import {
  artifactVariant,
  requester,
  requestViaService,
  runProvisioning,
} from "../../../support/f02.js";

/**
 * SEC-12 / SEC-BASE-12: o artefato declara tabelas só-inserção; a credencial operacional da
 * instância só lê e insere nelas, lê as tabelas internas `_spark_*` e escreve nas demais.
 */
let env: F01TestEnv;
let instance: Instance;
let operational: Connection;
let admin: Connection;
const registry = artifactVariant(
  {
    "0003_ref_trilha":
      "CREATE TABLE ref_trilha (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, msg VARCHAR(40) NOT NULL);\n",
  },
  { appendOnlyTables: ["ref_trilha"] },
);

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy((error) =>
    /ACCESS_DENIED|ER_TABLEACCESS_DENIED/.test(String((error as { code?: string }).code)),
  );

async function connectOperational(): Promise<Connection> {
  const user = await getResource(env.ctx.core, instance.id, "usuario_mysql");
  if (!user) throw new Error("credencial operacional");
  return env.mysql.connectAs(
    user.identifier,
    resourceSecret(env.ctx, instance.id, user),
    instance.databaseName,
  );
}

beforeAll(async () => {
  env = await F01TestEnv.create();
  const { instanceId, taskId } = await requestViaService(
    env,
    await requester(env),
    {},
    crypto.randomUUID(),
    registry,
  );
  expect(await runProvisioning(env, taskId, { registry })).toBe("concluida");
  const found = await getInstance(env.ctx, instanceId);
  if (!found) throw new Error("instância");
  instance = found;
  operational = await connectOperational();
  admin = await env.mysql.connect("provisioner", instance.databaseName);
});
afterAll(async () => {
  await operational?.end();
  await admin?.end();
  await env?.cleanup();
});

describe("SEC-12 — tabelas só-inserção e internas", () => {
  it("só-inserção: INSERT e SELECT funcionam; UPDATE e DELETE → erro de privilégio", async () => {
    await operational.query("INSERT INTO ref_trilha (msg) VALUES ('criado')");
    const [rows] = await operational.query("SELECT msg FROM ref_trilha");
    expect(rows).toEqual([{ msg: "criado" }]);
    await denied(operational.query("UPDATE ref_trilha SET msg = 'adulterado'"));
    await denied(operational.query("DELETE FROM ref_trilha"));
  });

  it("tabelas internas _spark_* são só leitura; tabela comum continua com DML", async () => {
    await operational.query("SELECT * FROM _spark_instance");
    await denied(operational.query("UPDATE _spark_instance SET synthetic = synthetic"));
    await denied(operational.query("DELETE FROM _spark_schema_history"));
    await operational.query("UPDATE ref_item SET id = id WHERE 1 = 0");
    await operational.query("DELETE FROM ref_item WHERE 1 = 0");
  });

  it("instância antiga (DML no banco inteiro) é corrigida pela sincronização; tabela nova recebe DML", async () => {
    const user = instanceUserName(instance.id);
    const account = instanceAccount(user);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${grantDatabaseName(instance.databaseName)}\`.* TO ${account}`,
    );
    await admin.query("CREATE TABLE ref_nova (id INT)");
    // Mesmo caminho da CLI `instances:sync-grants`.
    const report = await syncAllOperationalGrants(env.ctx, env.mysql.config, registry);
    expect(report.unreachable).toEqual([]);
    expect(report.updated).toEqual([{ slug: instance.slug, appendOnly: ["ref_trilha"] }]);
    // Privilégios valem para conexões abertas depois da mudança.
    const fresh = await connectOperational();
    try {
      await denied(fresh.query("UPDATE ref_trilha SET msg = 'adulterado'"));
      await denied(fresh.query("UPDATE _spark_instance SET synthetic = synthetic"));
      await fresh.query("INSERT INTO ref_nova VALUES (1)");
      await fresh.query("DELETE FROM ref_nova");
    } finally {
      await fresh.end();
    }
  });
});
