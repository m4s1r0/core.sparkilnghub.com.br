# Contrato de comandos do repositório

Comandos estáveis que documentação, CI e agentes usam. Executam igual em Windows (PowerShell) e
Linux; implementados como scripts Node chamados por `npm run`. Nenhum comando aceita segredo por
argumento de linha de comando.

| Comando | Efeito | Ambientes permitidos | Código de saída |
|---|---|---|---|
| `npm run dev:up` | Sobe MySQL (compose), aguarda saúde, migra Core, carrega sementes, inicia servidor, trabalhador e interface | `development` | 0 ao ficar saudável; ≠0 com mensagem e componente |
| `npm run dev:down` | Para processos e contêiner, preservando volume | `development` | 0 |
| `npm run dev:reset` | Recria bancos de desenvolvimento vazios, migra e carrega sementes | `development` apenas; recusa se `environment_marker` ≠ development | 0 / 2 recusado |
| `npm run db:migrate` | Aplica migrações do Core (`spark_core`, `spark_identity`) | todos | 0 / ≠0 com versão e motivo |
| `npm run db:seed` | Carrega dados sintéticos de forma idempotente | `development`, `homologation` | 0 / 2 recusado |
| `npm run ref:validate` | Valida o artefato do produto de referência (manifesto, checksums, construções proibidas) | todos | 0 / ≠0 |
| `npm run verify` | Executa localmente as etapas da CI: tipos, lint, formatação, ADR/portão, duplicação DS, segredos, unidade, integração, contratos, migrações, E2E | `development` | 0 se todas passam |
| `npm run gate -- <fatia>` | Verifica se a fatia pode estar `pronta` (decisões exigidas confirmadas) | todos | 0 / 3 bloqueada, listando decisões |

Recusas por ambiente gravam uma linha de log estruturado com `event: "env_guard_refused"`,
comando, `SPARK_ENV` e marcador encontrado.
