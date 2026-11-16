// npx tsx scripts/tuteli-schema-report.ts [--product <codigo>] — checagem ANTES de migrar.
// Para cada instância já provisionada do produto (padrão `sparkpet`, o código imutável do Tuteli),
// informa a versão do artefato aplicada no banco operacional, as versões pendentes, se o histórico
// divergiu do manifesto e se há backup bem-sucedido registrado.
// Somente leitura: nunca aplica migração, nunca executa DDL, nunca escreve em tabela alguma. A
// aplicação é feita pela tarefa de migração do Core (F03), não por este script.
//
// Códigos de saída:
//   0   todas as instâncias em dia
//   10  há pendentes, nenhuma divergência e nenhuma inacessível
//   20  alguma divergente, alguma inacessível, o artefato não resolveu ou nenhuma instância
//       encontrada para o produto
//   2   argumento inválido
//   1   falha inesperada
// Instâncias sem banco operacional não alteram o código de saída; apenas entram no resumo.
import { sql } from "kysely";
import { resolveProvisioner } from "../server/src/modules/catalog/provisioners.js";
import { latestBackup } from "../server/src/modules/instances/backup.js";
import { loadConfig } from "../server/src/platform/config/load.js";
import { createAppContext } from "../server/src/platform/context.js";
import { openAdminConnection, PoolRegistry } from "../server/src/platform/db/pools.js";
import { binToUuid } from "../server/src/platform/ids.js";
import { createLogger } from "../server/src/platform/logging/logger.js";
import { checkHistory, readHistory } from "../server/src/platform/migrations/migrator.js";

const DEFAULT_PRODUCT = "sparkpet";
/** Estados em que o banco operacional pode ainda não existir. */
const STATES_WITHOUT_DATABASE = new Set(["CADASTRADA", "PROVISIONANDO", "FALHA_PROVISIONAMENTO"]);

const USAGE = `Uso: npx tsx scripts/tuteli-schema-report.ts [--product <codigo>]

Relatório somente leitura do estado do esquema operacional por instância.
  --product <codigo>  código do produto (padrão: ${DEFAULT_PRODUCT})
  --help, -h          mostra este uso

Saídas: 0 em dia; 10 pendentes; 20 divergente/inacessível/artefato inválido/nenhuma instância encontrada; 2 argumento inválido; 1 falha.`;

type ParsedArgs = { kind: "run"; product: string } | { kind: "help" } | { kind: "invalid" };

function parseArgs(argv: string[]): ParsedArgs {
  let product = DEFAULT_PRODUCT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--product") {
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) return { kind: "invalid" };
      product = value;
      i += 1;
    } else {
      return { kind: "invalid" };
    }
  }
  return { kind: "run", product };
}

interface InstanceRow {
  id: Buffer;
  slug: string;
  state: string;
  database_name: string;
  schema_version: number | null;
}

type Classification = "em dia" | "pendente" | "divergente" | "inacessível" | "sem banco";

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.kind === "help") {
    console.log(USAGE);
    return 0;
  }
  if (args.kind === "invalid") {
    console.error(`Argumento inválido.\n${USAGE}`);
    return 2;
  }
  const productCode = args.product;

  const config = loadConfig({ credentials: ["migrator", "provisioner"] });
  const pools = new PoolRegistry(config);
  const ctx = createAppContext(config, pools, {
    role: "migrator",
    logger: createLogger({ name: "tuteli-schema-report" }),
  });
  try {
    const resolved = await resolveProvisioner(productCode, config.SPARK_ENV);
    if (!resolved.ok) {
      console.error(`Artefato de migração não resolvido para "${productCode}": ${resolved.reason}`);
      return 20;
    }

    const { rows } = await sql<InstanceRow>`SELECT id, slug, state, database_name, schema_version
      FROM instance
      WHERE product_code = ${productCode}
      ORDER BY created_at`.execute(ctx.core);

    if (rows.length === 0) {
      console.error(
        `Nenhuma instância encontrada para o produto "${productCode}" no ambiente ${config.SPARK_ENV}. ` +
          'Isso não significa "em dia": não há evidência sobre o esquema.',
      );
      return 20;
    }

    const counts: Record<Classification, number> = {
      "em dia": 0,
      pendente: 0,
      divergente: 0,
      inacessível: 0,
      "sem banco": 0,
    };

    for (const row of rows) {
      const backup = await latestBackup(ctx, binToUuid(row.id));
      let backupText = backup.lastSuccessfulAt
        ? `último backup ${backup.lastSuccessfulAt.toISOString()}`
        : "último backup nenhum";
      if (backup.lastResult === "falha") backupText += " (ATENÇÃO: o backup mais recente falhou)";

      const noDatabase = (): void => {
        counts["sem banco"] += 1;
        console.log(`${row.slug} [${row.state}]: sem banco operacional; ${backupText}`);
      };

      if (STATES_WITHOUT_DATABASE.has(row.state)) {
        noDatabase();
        continue;
      }

      let check;
      try {
        const connection = await openAdminConnection(config, "provisioner", row.database_name);
        try {
          const history = await readHistory(connection);
          check = checkHistory(history, resolved.manifest);
        } finally {
          await connection.end();
        }
      } catch (error) {
        const code = (error as { code?: string }).code ?? "ERRO";
        if (code === "ER_BAD_DB_ERROR") {
          noDatabase();
        } else {
          counts["inacessível"] += 1;
          console.log(`${row.slug} [${row.state}]: banco inacessível (${code}); ${backupText}`);
        }
        continue;
      }

      const versions = `aplicada ${check.appliedVersion} / manifesto ${check.expectedVersion}`;
      const coreNote =
        row.schema_version !== check.appliedVersion
          ? `; ATENÇÃO: instance.schema_version=${row.schema_version ?? "nulo"} difere do banco (${check.appliedVersion})`
          : "";

      if (check.problem !== null) {
        counts.divergente += 1;
        console.log(
          `${row.slug} [${row.state}]: DIVERGENTE ${check.problem}${check.message ? ` — ${check.message}` : ""}; ${versions}${coreNote}; ${backupText}`,
        );
        continue;
      }

      const pending: number[] = [];
      for (let v = check.appliedVersion + 1; v <= check.expectedVersion; v += 1) pending.push(v);
      if (pending.length > 0) {
        counts.pendente += 1;
        console.log(
          `${row.slug} [${row.state}]: pendente; ${versions}; pendentes: ${pending.join(", ")}${coreNote}; ${backupText}`,
        );
      } else {
        counts["em dia"] += 1;
        console.log(`${row.slug} [${row.state}]: em dia; ${versions}${coreNote}; ${backupText}`);
      }
    }

    console.log(
      `\nResumo (${productCode}, manifesto v${resolved.version}): ${counts["em dia"]} em dia, ` +
        `${counts.pendente} pendente(s), ${counts.divergente} divergente(s), ` +
        `${counts["inacessível"]} inacessível(is), ${counts["sem banco"]} sem banco.`,
    );
    if (counts.pendente > 0) {
      console.log(
        "A aplicação é feita pela tarefa de migração do Core: entrar em manutenção, registrar backup " +
          "com `npm run instances:report-backup` e chamar `POST /api/v1/instances/{id}/migration` " +
          "— não por este script nem por `mysql <` no arquivo .sql.",
      );
    }

    if (counts.divergente > 0 || counts["inacessível"] > 0) return 20;
    if (counts.pendente > 0) return 10;
    return 0;
  } finally {
    await pools.closeAll();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[tuteli-schema-report] falha: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
