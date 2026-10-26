import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  grantDatabaseName,
  instanceDatabaseName,
  instanceUserName,
  newId,
} from "../../src/platform/ids.js";
import { MysqlTestContext } from "../support/mysql.js";

let ctx: MysqlTestContext;

const denied = (promise: Promise<unknown>) =>
  expect(promise).rejects.toSatisfy((error) =>
    /ACCESS_DENIED|ER_DBACCESS_DENIED|ER_TABLEACCESS_DENIED|ER_SPECIFIC_ACCESS_DENIED/.test(
      String((error as { code?: string }).code),
    ),
  );

interface Instance {
  database: string;
  user: string;
  password: string;
}

async function createInstance(): Promise<Instance> {
  const uuid = newId();
  const database = instanceDatabaseName("sparkref_", uuid);
  const user = instanceUserName(uuid);
  const password = randomBytes(18).toString("base64url");
  const provisioner = await ctx.connect("provisioner");
  await provisioner.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  ctx.trackInstanceDatabase(database);
  await provisioner.query(`CREATE TABLE \`${database}\`.item (id INT PRIMARY KEY)`);
  await provisioner.query(`CREATE USER '${user}'@'%' IDENTIFIED BY ?`, [password]);
  ctx.trackUser(user);
  await provisioner.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${grantDatabaseName(database)}\`.* TO '${user}'@'%'`,
  );
  return { database, user, password };
}

beforeAll(async () => {
  ctx = await MysqlTestContext.create();
});
afterAll(async () => {
  await ctx?.cleanup();
});

describe("privilégios separados (FR-008, R-06)", () => {
  it.each(["web", "worker"] as const)("%s não cria banco nem altera estrutura", async (role) => {
    const conn = await ctx.connect(role, "spark_core");
    await denied(conn.query("CREATE DATABASE t_nao_permitido"));
    await denied(conn.query("ALTER TABLE worker_heartbeat ADD COLUMN x INT"));
    await denied(conn.query("CREATE TABLE intrusa (id INT)"));
  });

  it("provisionador cria apenas bancos de produto e não altera spark_identity", async () => {
    const instance = await createInstance();
    expect(instance.database).toMatch(/^sparkref_[0-9a-f]{32}$/);
    const provisioner = await ctx.connect("provisioner");
    await denied(provisioner.query("CREATE DATABASE x_qualquer"));
    await denied(provisioner.query("CREATE TABLE spark_identity.intrusa (id INT)"));
    await denied(provisioner.query("DROP TABLE spark_core.worker_heartbeat"));
  });

  it("usuário de instância acessa só o próprio banco e não altera estrutura nele", async () => {
    const a = await createInstance();
    const b = await createInstance();

    const connA = await ctx.connectAs(a.user, a.password, a.database);
    await connA.query("INSERT INTO item VALUES (1)");
    const [rows] = await connA.query("SELECT id FROM item");
    expect(rows).toEqual([{ id: 1 }]);

    // Outro banco de instância: sem acesso algum.
    await denied(connA.query(`SELECT * FROM \`${b.database}\`.item`));
    await denied(connA.query(`CREATE TABLE \`${b.database}\`.intrusa (id INT)`));
    await denied(ctx.connectAs(a.user, a.password, b.database));

    // Próprio banco: só DML.
    await denied(connA.query("CREATE TABLE intrusa (id INT)"));
    await denied(connA.query("ALTER TABLE item ADD COLUMN x INT"));
    await denied(connA.query("DROP TABLE item"));
    await denied(connA.query("CREATE DATABASE t_nao_permitido"));
  });
});
