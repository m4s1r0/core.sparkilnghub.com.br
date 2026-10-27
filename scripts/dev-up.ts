// npm run dev:up — sobe MySQL, aplica migrações e sementes e inicia servidor, trabalhador e
// interface (contracts/commands.md). Só em development.
import type { ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../server/src/platform/config/load.js";
import { SystemStatusService } from "../server/src/modules/system/probe.js";
import { openAdminConnection, PoolRegistry } from "../server/src/platform/db/pools.js";
import {
  killTree,
  mysqlContainerHealth,
  portFree,
  run,
  startPrefixed,
  waitFor,
} from "./lib/dev.js";
import { repoRoot } from "./lib/repo.js";

const EXPECTED_MYSQL = /^8\.4\./;

async function main() {
  const config = loadConfig({ credentials: ["migrator", "web", "worker", "provisioner"] });
  if (config.SPARK_ENV !== "development") {
    console.error(`dev:up recusado: SPARK_ENV=${config.SPARK_ENV} (permitido: development)`);
    process.exit(2);
  }
  const webPort = Number(process.env.WEB_PORT ?? 5173);

  for (const [port, variable] of [
    [config.HTTP_PORT, "HTTP_PORT"],
    [webPort, "WEB_PORT"],
  ] as const) {
    if (!(await portFree(port))) {
      console.error(`Porta ${port} ocupada. Libere-a ou altere ${variable} no .env.`);
      process.exit(1);
    }
  }
  if (mysqlContainerHealth() === "absent" && !(await portFree(config.MYSQL_PORT))) {
    console.error(
      `Porta ${config.MYSQL_PORT} ocupada por outro processo. Altere MYSQL_PORT no .env.`,
    );
    process.exit(1);
  }

  console.log("Subindo MySQL (docker compose)…");
  await run("docker", ["compose", "up", "-d", "mysql"]);
  await waitFor("MySQL saudável", () => Promise.resolve(mysqlContainerHealth() === "healthy"));
  // O entrypoint só roda o init com volume vazio; reaplicá-lo (idempotente) cria usuários e
  // privilégios acrescentados em fatias posteriores, como o escritor da projeção de F01.
  await run("docker", [
    "compose",
    "exec",
    "-T",
    "mysql",
    "bash",
    "/docker-entrypoint-initdb.d/01-databases-and-users.sh",
  ]);

  const connection = await openAdminConnection(config, "migrator");
  const [rows] = await connection.query("SELECT VERSION() AS version");
  await connection.end();
  const version = (rows as { version: string }[])[0]?.version ?? "?";
  if (!EXPECTED_MYSQL.test(version)) {
    console.error(`MySQL ${version} encontrado; a versão adotada é 8.4.x (research.md R-05).`);
    process.exit(1);
  }

  await run("npm", ["run", "-s", "build:contracts"]);
  await run("npm", ["run", "-s", "db:migrate"]);
  await run("npm", ["run", "-s", "instances:migrate-access"]);
  await run("npm", ["run", "-s", "db:seed"]);

  const children: ChildProcess[] = [
    startPrefixed("app", "npm", ["run", "-s", "dev:app", "-w", "@sparkcore/server"]),
    startPrefixed("worker", "npm", ["run", "-s", "dev:worker", "-w", "@sparkcore/server"]),
    startPrefixed("web", "npm", ["run", "-s", "dev", "-w", "@sparkcore/web"]),
  ];
  writeFileSync(
    join(repoRoot, ".sparkcore-dev.json"),
    JSON.stringify({ pids: children.map((c) => c.pid).filter(Boolean) }),
  );
  const stop = () => {
    for (const child of children) if (child.pid) killTree(child.pid);
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  for (const child of children) {
    child.once("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`Processo encerrou com código ${code}; parando os demais.`);
        stop();
      }
    });
  }

  // Desde F01 /api/v1/system/status exige sessão de administrador: o processo responde em
  // /health/live e a situação é conferida com a mesma sonda, em processo.
  const liveUrl = `http://${config.HTTP_HOST}:${config.HTTP_PORT}/health/live`;
  await waitFor("servidor em /health/live", async () => (await fetch(liveUrl)).ok);
  const pools = new PoolRegistry(config);
  try {
    const probe = new SystemStatusService(config, pools);
    await waitFor("situação SAUDAVEL", async () => (await probe.check()).status === "SAUDAVEL");
  } finally {
    await pools.closeAll();
  }
  console.log("\nSparkCore saudável");
  console.log(`  Interface: http://127.0.0.1:${webPort}/`);
  console.log(`  API:       http://${config.HTTP_HOST}:${config.HTTP_PORT}/health/live`);
  console.log("  Primeiro acesso: npm run bootstrap:admin -- <seu-email>");
  console.log("  Ctrl+C para encerrar; `npm run dev:down` para parar o MySQL.\n");
}

main().catch((error: unknown) => {
  console.error(`dev:up falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
