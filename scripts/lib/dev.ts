import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { repoRoot } from "./repo.js";

export const isWindows = process.platform === "win32";

/**
 * No Windows, `npm` é um .cmd e precisa de shell; a linha é montada inteira (argumentos são
 * constantes internas, nunca entrada do usuário), evitando o aviso DEP0190 do Node.
 */
export function spawnArgs(command: string, args: string[]): [string, string[], { shell: boolean }] {
  return isWindows
    ? [[command, ...args].join(" "), [], { shell: true }]
    : [command, args, { shell: false }];
}

/** Executa um comando herdando a saída; rejeita com o código de saída. */
export function run(
  command: string,
  args: string[],
  options: { quiet?: boolean } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, argv, shell] = spawnArgs(command, args);
    const child = spawn(cmd, argv, {
      cwd: repoRoot,
      stdio: options.quiet ? "ignore" : "inherit",
      ...shell,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} saiu com ${code}`)),
    );
  });
}

export function output(command: string, args: string[]): string {
  const [cmd, argv, shell] = spawnArgs(command, args);
  const result = spawnSync(cmd, argv, { cwd: repoRoot, encoding: "utf8", ...shell });
  if (result.status !== 0) throw new Error(result.stderr || `${command} falhou`);
  return result.stdout.trim();
}

/** Processo de longa duração com saída prefixada (ex.: `[app]`). */
export function startPrefixed(name: string, command: string, args: string[]): ChildProcess {
  const [cmd, argv, shell] = spawnArgs(command, args);
  const child = spawn(cmd, argv, { cwd: repoRoot, env: process.env, ...shell });
  const prefix = (chunk: Buffer, stream: NodeJS.WriteStream) => {
    for (const line of chunk.toString().split(/\r?\n/))
      if (line) stream.write(`[${name}] ${line}\n`);
  };
  child.stdout?.on("data", (chunk: Buffer) => prefix(chunk, process.stdout));
  child.stderr?.on("data", (chunk: Buffer) => prefix(chunk, process.stderr));
  return child;
}

export function portFree(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

export async function waitFor(
  description: string,
  check: () => Promise<boolean>,
  { timeoutMs = 120_000, intervalMs = 2_000 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await sleep(intervalMs);
  }
  throw new Error(`Tempo esgotado aguardando ${description}`);
}

export function mysqlContainerHealth(): string {
  try {
    const id = output("docker", ["compose", "ps", "-q", "mysql"]);
    if (!id) return "absent";
    return output("docker", ["inspect", "-f", "{{.State.Health.Status}}", id]);
  } catch {
    return "absent";
  }
}

/**
 * Encerra um processo e todos os descendentes. No Windows, matar o `npm` intermediário deixa
 * servidor e Vite órfãos nas portas; `taskkill /T` encerra a árvore.
 */
export function killTree(pid: number): void {
  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // processo já encerrado
  }
}
