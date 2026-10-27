import { setTimeout as sleep } from "node:timers/promises";

/** ER_LOCK_DEADLOCK: o InnoDB desfez a transação inteira; repetir é seguro. */
export function isDeadlock(error: unknown): boolean {
  return (error as { errno?: unknown }).errno === 1213;
}

/**
 * Repete uma transação desfeita por deadlock. `SELECT … FOR UPDATE` sobre faixa vazia toma trava
 * de intervalo; duas transações que depois inserem na mesma faixa (ex.: dois convites ao mesmo
 * tempo) fazem o InnoDB desfazer uma delas. A função recebida deve abrir a própria transação.
 */
export async function retryOnDeadlock<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isDeadlock(error)) throw error;
      await sleep(10 + Math.floor(Math.random() * 40) * attempt);
    }
  }
}
