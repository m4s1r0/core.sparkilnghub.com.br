# Comandos — F03 (delta sobre `contracts/commands.md`)

Nenhum comando aceita segredo por argumento. Recusas por ambiente seguem a guarda de F00.

| Comando | Mudança | Ambientes | Código de saída |
|---|---|---|---|
| `npm run instances:report-backup -- <instanceId> <ok\|falhou> [--origin <nome>] [--detail <texto>] [--takenAt <ISO>]` (novo) | Grava um `instance_backup_record`; chamado pela infraestrutura depois de cada cópia (R-05). `--origin` identifica a ferramenta que executou (padrão "ferramenta externa de backup"); `--detail` é texto livre sanitizado. Sem segredo; truncados em 80/300 caracteres | todos | 0 / 1 instância inexistente / 2 argumento inválido |
| `npm run db:migrate` (adendo 2026-11-13) | Aplica a migração `spark_core` 0009 (`admin_task.from_version`). **Obrigatório antes de subir o servidor/trabalhador com o código da aba "Migração" revista** — sem ela, `GET/POST .../migration` e `.../migration/plan` respondem 500 (`Unknown column 'from_version'`) | todos | inalterado |
| `npm run db:seed` | Passa a incluir o cenário sintético de F03 (`seeds/f03.ts`): uma instância ativada, uma suspensa com sessão revogada de exemplo, um registro de saúde e um de backup de amostra | `development`, `homologation` | inalterado |
| `npm run dev:reset` | Também remove as tabelas novas de F03 ao recriar o ambiente sintético (`instance_health_check`, `instance_backup_record`, `instance_termination` ficam vazias para instâncias recriadas) | `development` | inalterado |
| Processo trabalhador | Passa a processar tarefas `admin_task.kind = 'migracao'` pelo mesmo laço que já processa `provisionamento`; nenhuma variável de ambiente nova | todos | — |

Nenhuma variável de ambiente nova nesta fatia (reaproveita `INSTANCE_SECRET_KEY`,
`PROVISIONING_MAX_ATTEMPTS` e as credenciais de F00/F02).

**`instances:report-backup` — erros comuns (adendo 2026-11-13)**:

- O primeiro argumento é o **UUID da instância** (`/instancias/:id`), não o slug nem o `sha256` de
  uma migração do `manifest.json`. Um valor que não é UUID imprime o uso e sai com código 2 **sem
  gravar nada** — a aplicação seguinte continua recusada com `NO_PRIOR_BACKUP`.
- O backup só conta como prévio se `taken_at` for igual ou posterior à última entrada em
  `MANUTENCAO` (`hasBackupSince`). Sem `--takenAt`, vale o instante em que o comando roda; para um
  dump feito antes do registro, informe o instante real (`--takenAt 2026-11-13T08:15:00-03:00`).
