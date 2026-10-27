// npm run dev:reset — recria os bancos de desenvolvimento vazios, migra e semeia. Ferramenta de
// desenvolvimento fora do artefato de produção: remove apenas spark_core/spark_identity marcados
// como development e bancos sparkref_* com marcador sintético, com seus bancos de acesso
// <banco>_acc (constituição IV, v1.1.1; F01 R-07).
import { assertEnvironment, EnvGuardError } from "../server/src/platform/config/env-guard.js";
import { loadConfig } from "../server/src/platform/config/load.js";
import { openAdminConnection } from "../server/src/platform/db/pools.js";
import { binToUuid, instanceUserName } from "../server/src/platform/ids.js";
import { createLogger } from "../server/src/platform/logging/logger.js";
import { accessDatabaseName } from "../server/src/platform/migrations/apply-artifact.js";
import { run } from "./lib/dev.js";

async function syntheticInstanceDatabases(config: ReturnType<typeof loadConfig>) {
  const provisioner = await openAdminConnection(config, "provisioner");
  try {
    const [schemas] = await provisioner.query(
      "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'sparkref\\_%'",
    );
    const found: { database: string; user: string }[] = [];
    for (const { name } of schemas as { name: string }[]) {
      try {
        const [rows] = await provisioner.query(
          `SELECT instance_uuid FROM \`${name}\`._spark_instance WHERE synthetic = TRUE`,
        );
        const row = (rows as { instance_uuid: Buffer }[])[0];
        if (row)
          found.push({ database: name, user: instanceUserName(binToUuid(row.instance_uuid)) });
      } catch {
        // sem marcador sintético: não é removido
      }
    }
    return found;
  } finally {
    await provisioner.end();
  }
}

async function main() {
  const config = loadConfig({ credentials: ["migrator", "provisioner"] });
  const logger = createLogger({ name: "dev-reset" });
  await assertEnvironment(["development"], "dev:reset", { config, logger });

  const instances = await syntheticInstanceDatabases(config);
  const provisioner = await openAdminConnection(config, "provisioner");
  try {
    for (const { database, user } of instances) {
      await provisioner.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await provisioner.query(`DROP DATABASE IF EXISTS \`${accessDatabaseName(database)}\``);
      await provisioner.query(`DROP USER IF EXISTS '${user}'@'%'`);
    }
  } finally {
    await provisioner.end();
  }

  const migrator = await openAdminConnection(config, "migrator");
  try {
    for (const database of ["spark_core", "spark_identity"]) {
      await migrator.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await migrator.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
    }
  } finally {
    await migrator.end();
  }
  console.log(`Bancos recriados; ${instances.length} instância(s) sintética(s) removida(s).`);

  await run("npm", ["run", "-s", "db:migrate"]);
  await run("npm", ["run", "-s", "db:seed"]);
  console.log("dev:reset ok");
}

main().catch((error: unknown) => {
  if (error instanceof EnvGuardError) {
    console.error(`dev:reset recusado: ${error.message}`);
    process.exit(error.exitCode);
  }
  console.error(`dev:reset falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
