import { loadConfig } from "../platform/config/load.js";
import { migrateCoreDatabases } from "../platform/migrations/core-migrations.js";
import { runCli } from "./run.js";

runCli("db:migrate", async () => {
  const config = loadConfig({ credentials: ["migrator"] });
  const { results, markerCreated } = await migrateCoreDatabases(config);
  for (const { database, applied } of results) {
    console.log(
      applied.length > 0
        ? `${database}: aplicadas as versões ${applied.join(", ")}`
        : `${database}: já atualizado`,
    );
  }
  if (markerCreated) console.log(`environment_marker gravado: ${config.SPARK_ENV}`);
});
