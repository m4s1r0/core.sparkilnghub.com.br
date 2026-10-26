// npm run dev:down — encerra processos iniciados pelo dev:up e para o contêiner MySQL, preservando o
// volume de dados.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { killTree, run } from "./lib/dev.js";
import { repoRoot } from "./lib/repo.js";

const pidFile = join(repoRoot, ".sparkcore-dev.json");
if (existsSync(pidFile)) {
  const { pids } = JSON.parse(readFileSync(pidFile, "utf8")) as { pids: number[] };
  for (const pid of pids) killTree(pid);
  rmSync(pidFile);
}

run("docker", ["compose", "stop", "mysql"]).then(
  () => console.log("dev:down ok: processos encerrados e MySQL parado (volume preservado)"),
  (error: unknown) => {
    console.error(`dev:down falhou: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
