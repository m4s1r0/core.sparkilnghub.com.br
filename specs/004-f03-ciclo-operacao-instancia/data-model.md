# Data Model — F03 Ciclo e operação da instância

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Convenções de F00 a F02, sem mudança: UUID v7 em `BINARY(16)`, instantes `DATETIME(6)` UTC,
`utf8mb4_0900_ai_ci`, segredos só como resumo ou cifrados. Sem chaves estrangeiras entre bancos.

## Bancos envolvidos

| Banco | Mudança em F03 | Quem escreve |
|---|---|---|
| `spark_core` | migração 0005: `admin_task.kind`/`admin_task_step_run.step` ampliados; três tabelas novas só inclusão | web (transições, relato de backup) e trabalhador (etapas de migração) |
| `access_projection` | **nenhuma** — v2 (F02) já tem `suspensa` e `manutencao` | `spark_access_writer`, chamado pelo Core nas transições |
| `spark_identity` | nenhuma | — |
| `<prefixo><uuid>` | nenhuma mudança de schema; só lida pela checagem de saúde e pelo executor de migração | trabalhador (`spark_provisioner`) |

## `spark_core`

### Máquina de estados (F03 completa o que F02 deixou pronto)

```text
                         ┌──────────────── (F02: CADASTRADA → PROVISIONANDO → PRONTA) ───────────────┐
                         │                                                                            │
                         ▼                                                                            │
                      PRONTA ──(ativar, SC-029)──────────────────────────────────────────▶ ATIVA ◀────┘
                                                                                            │   ▲
                                              (suspender, motivo) ─────────────────────────┘   │
                                                                                                 │
                                   SUSPENSA ◀─────────────────────────────────────┘   (reativar, SC-029)
                                      │
                       (encerrar, só a partir de SUSPENSA) ──▶ ENCERRADA (terminal)

                      ATIVA ──(entrar em manutenção)──▶ MANUTENCAO ──(checagem de saúde ok)──▶ ATIVA
```

`instance.state` já é o `ENUM` de 8 valores completo desde F02; **nenhuma migração de schema**
nesta fatia para essa coluna. F03 só amplia `ALLOWED` em `transitions.ts` (aplicação) com:
`PRONTA>ATIVA`, `ATIVA>SUSPENSA`, `SUSPENSA>ATIVA`, `ATIVA>MANUTENCAO`, `MANUTENCAO>ATIVA`,
`SUSPENSA>ENCERRADA`. Nenhuma transição parte ou chega em `ENCERRADA` além dessa (terminal,
`SC-031`).

### `admin_task` (alterada)

```sql
ALTER TABLE admin_task MODIFY kind ENUM('provisionamento', 'migracao') NOT NULL;
```

Uma tarefa `migracao` só é criada com a instância em `MANUTENCAO` (conferido na mesma transação
que grava a intenção, igual à reserva de slug em F02). `active_instance_key` (já existente) impede
uma tarefa de migração concorrente com qualquer outra tarefa estrutural da mesma instância —
mesma regra de `RN-SC-002` herdada, sem alteração de coluna.

### `admin_task_step_run` (alterada)

```sql
ALTER TABLE admin_task_step_run MODIFY step ENUM(
  'validar', 'reservar', 'criar_bancos', 'criar_credencial', 'aplicar_migracoes', 'configurar',
  'preparar_convite', 'verificar', 'concluir',
  'confirmar_manutencao', 'confirmar_backup_previo', 'aplicar_migracoes_instancia',
  'verificar_pos_migracao'
) NOT NULL;
```

As quatro etapas novas pertencem só a `kind = 'migracao'`; a aplicação, não o banco, garante que
uma tarefa de `kind = 'provisionamento'` nunca produz uma linha com essas etapas (mesmo padrão já
usado para separar os dois conjuntos de etapas no executor, R-03).

### `instance_health_check` (novo, só inclusão)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `instance_id` | `BINARY(16)` FK | |
| `checked_at` | `DATETIME(6)` | |
| `healthy` | `BOOLEAN` | |
| `schema_version` | `INT UNSIGNED` NULL | lido na checagem |
| `reason` | `VARCHAR(300)` NULL | motivo sanitizado quando `healthy = FALSE` (`SC-045`) |
| `origin` | `ENUM('painel', 'saida_manutencao')` | quem disparou a checagem |

Índice `(instance_id, checked_at)`. O painel de saúde (`SC-042`) mostra a linha mais recente por
instância; a saída de manutenção (`FR-014`) grava uma linha e só libera `ATIVA` se `healthy =
TRUE` na mesma checagem.

### `instance_backup_record` (novo, só inclusão)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `instance_id` | `BINARY(16)` FK | |
| `taken_at` | `DATETIME(6)` | instante informado pela ferramenta de backup |
| `result` | `ENUM('sucesso', 'falha')` | |
| `origin` | `VARCHAR(80)` | nome/identificador da ferramenta que executou (`SC-042`) |
| `detail` | `VARCHAR(300)` NULL | texto livre sanitizado (sem segredo) |
| `reported_at` | `DATETIME(6)` | instante em que o comando CLI gravou a linha |

Índice `(instance_id, taken_at)`. Alimentada só pelo comando `instances:report-backup` (R-05);
nenhuma rota HTTP escreve aqui. "Backup bem-sucedido mais recente" = última linha com `result =
'sucesso'`; sua ausência é o estado padrão exibido (`SC-042`, nunca sucesso implícito).

### `instance_termination` (novo, só inclusão)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `instance_id` | `BINARY(16)` FK UNIQUE | uma instância só encerra uma vez no MVP (sem reabertura, `SC-031`) |
| `reason` | `VARCHAR(500)` | |
| `export_reference` | `VARCHAR(300)` NULL | referência à exportação/backup aplicável, se houver |
| `retention_policy` | `VARCHAR(300)` | texto registrado, sem automação de expurgo (Assumptions) |
| `actor_id` | `BINARY(16)` | administrador que confirmou |
| `created_at` | `DATETIME(6)` | mesmo instante da transição `SUSPENSA → ENCERRADA` |

Gravada na mesma transação do Core que a transição para `ENCERRADA`. Nenhum campo aqui referencia
ou altera `instance_resource`.

### `instance_transition` (sem alteração de schema, uso ampliado)

Já existente (F02): `id`, `instance_id`, `from_state`, `to_state`, `actor_kind`, `actor_id`,
`reason`, `task_id`, `correlation_id`, `created_at`. F03 só passa a gravar as seis transições
novas, sempre com `reason` obrigatório quando a ação exigir motivo (suspender, manutenção,
encerrar) e `actor_kind = 'usuario'` com `actor_id` do administrador.

## Banco de acesso (`<prefixo><uuid>_acc`) — projeção v2, sem migração

`access_instance.state` já aceita `pronta`, `ativa`, `suspensa`, `manutencao` (F02). F03 só passa
a escrever `suspensa` e `manutencao` pela mesma função `setProjectionState` (F02), chamada pelas
funções de transição do Core na ordem definida em [research.md](./research.md) (R-01):
projeção antes do Core ao revogar; Core antes da projeção ao conceder.

## Validações (resumo, FR → regra)

| FR | Regra | Onde |
|---|---|---|
| FR-001/FR-010 | ativar/reativar exige contratante elegível, schema compatível, administrador local ativo ou convite inicial pendente válido (`SC-024`) | `instances/transitions.ts` (consulta antes de abrir a transação) |
| FR-005/FR-012 | revogar (suspender, entrar em manutenção) grava a projeção antes do Core | `writeLifecycleTransition` (R-01) |
| FR-006/FR-013 | transação já autorizada conclui: nenhuma ação do Core aborta comando em execução no banco da instância | ausência deliberada de qualquer kill de conexão/transação |
| FR-008 | nenhuma rota ou job automático chama `suspendInstance` por telemetria ou vigência | revisão de código + teste negativo (`RN-SC-003`) |
| FR-014 | saída de manutenção exige `checkInstanceHealth` com `healthy = TRUE` na mesma operação | `instances/health.ts` |
| FR-017 | status de backup só "sucesso" com linha em `instance_backup_record`; ausência não é sucesso | `instances/backup.ts` (`latestBackup`) |
| FR-020/FR-021 | migração de instância só com a instância em `MANUTENCAO`; versão alvo conferida contra o manifesto do provisionador (F02) | `createMigrationTask` + etapa `confirmar_manutencao` |
| FR-023/FR-024 | encerrar só a partir de `SUSPENSA`; nenhum `DROP DATABASE` nem exclusão de `instance_resource` | `transitions.ts` (`terminateInstance`) + `check:migrations` (sem exceção) |
| FR-025 | nenhuma rota de reabertura ou exclusão definitiva de instância `ENCERRADA` | ausência deliberada de rota |
| FR-031 | nenhum campo ou rota altera `instance.contractor_id` após criação (F02 já trata como imutável; F03 confirma sem adicionar caminho) | revisão de código |
