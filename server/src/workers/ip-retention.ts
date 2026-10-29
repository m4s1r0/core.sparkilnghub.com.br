import { sql, type Kysely } from "kysely";

const BATCH_SIZE = 1000;
const RETENTION_DAYS = 180;

/**
 * Limpa ip e user_agent de security_event com idade > 180 dias (SC-033, R-03).
 * Executa em loop de LIMIT 1000 até não haver mais registros a limpar (idempotente).
 * Retorna o total de linhas afetadas na execução.
 */
export async function cleanIpRetention(identity: Kysely<unknown>): Promise<{ affected: number }> {
  let total = 0;
  for (;;) {
    const result = await sql`
      UPDATE security_event
         SET ip         = NULL,
             user_agent = NULL
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ${sql.lit(RETENTION_DAYS)} DAY)
         AND (ip IS NOT NULL OR user_agent IS NOT NULL)
       LIMIT ${sql.lit(BATCH_SIZE)}
    `.execute(identity);
    const affected = Number(result.numAffectedRows ?? 0);
    total += affected;
    if (affected === 0) break;
  }
  return { affected: total };
}
