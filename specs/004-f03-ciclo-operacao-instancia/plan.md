# Implementation Plan: F03 — Ciclo e operação da instância

**Branch**: `004-f03-ciclo-operacao-instancia` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-f03-ciclo-operacao-instancia/spec.md`

## Summary

Habilitar, sobre a máquina de estados já existente desde F02 (`instance.state`, ENUM de 8 valores
já completo, e `instance_transition`), as transições e telas que faltam: `PRONTA→ATIVA`
(primeira ativação), `ATIVA⇄SUSPENSA` (com o limite transacional da suspensão e a página pública
de indisponibilidade), `ATIVA⇄MANUTENCAO` (com checagem de saúde na saída) e `SUSPENSA→ENCERRADA`
(terminal, sem `DROP DATABASE`). Adiciona um painel de saúde por instância (versão, schema,
conectividade, última verificação, último backup) e um executor de migrações por instância que
reaproveita a infraestrutura de tarefa/etapa/lease de F02 (`admin_task` ganha o tipo `migracao`).
A projeção de acesso v2 **já tem** os estados `suspensa` e `manutencao` (F02); a aplicação apenas
passa a escrevê-los, sem nova migração da projeção. Detalhes em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 sobre Node.js 24 LTS (D-05), sem mudança

**Primary Dependencies**: as de F00 a F02, sem dependência nova

**Storage**: MySQL 8.4 — `spark_core` (migração 0005: `admin_task.kind` ganha `migracao`,
`admin_task_step_run.step` ganha as etapas de migração de instância, três tabelas novas só
inclusão — `instance_health_check`, `instance_backup_record`, `instance_termination`);
`access_projection` sem migração nova (v2 já tem `suspensa` e `manutencao`); `spark_identity` sem
mudança

**Testing**: Vitest 5 (unidade: transições novas e suas pré-condições, ordem de escrita
Core/projeção; integração com MySQL real: suspensão com sessão aberta e transação em curso,
reativação sem restaurar sessão, manutenção com transação em curso, executor de migração com
backup prévio exigido, encerramento sem `DROP DATABASE`; contrato Ajv contra OpenAPI 1.3.0;
componente), Playwright (ciclo completo na instância de referência em 360/1280 px, página pública
de indisponibilidade, teclado, axe)

**Target Platform**: igual a F00 (Windows e Linux para desenvolvimento; CI Ubuntu)

**Project Type**: monólito modular (API + trabalhador + SPA), sem mudança

**Performance Goals**: suspender/reativar/entrar ou sair de manutenção com efeito observável em
até 1 req de autorização após a confirmação (`CS-011`); painel de saúde p95 ≤ 800 ms (`NFR-004`,
mesmo alvo de listas de F02)

**Constraints**: nenhum `DROP DATABASE` nem remoção de recurso físico em nenhuma transição
(`RN-SC-004`); suspender e entrar em manutenção MUST escrever a projeção (que nega acesso) antes
do estado do Core, nunca depois (R-01); nenhuma transferência de instância entre contratantes
(`RN-SC-005`); migração de instância só dentro de `MANUTENCAO`, nunca pelo processo web

**Scale/Scope**: 1 migração em `spark_core` (3 tabelas novas, 2 `ALTER ... ENUM`); 0 migração em
`access_projection`/`spark_identity`; ~10 operações HTTP novas; 1 página pública nova
(indisponibilidade); ~6 telas/ajustes de tela; 1 comando novo (relato de backup pela
infraestrutura); 0 tarefa nova de polling do trabalhador (migração de instância reaproveita o
mesmo executor de F02, acionado por tarefa, não por intervalo)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio / regra (v1.2.1) | Como F03 atende | Resultado |
|---|---|---|
| I. Isolamento por instância | Nenhuma transição ou leitura cruza instâncias; suspender A não toca B (`FR-009`, testes A/B cruzados) | ✅ |
| I. Credencial restrita | Painel de saúde e executor de migração usam a mesma credencial operacional já restrita de F02, sem privilégio novo | ✅ |
| I. Core sem leitura operacional | Health check lê só a tabela de histórico de migração e faz `SELECT 1`; nenhuma tabela de negócio do produto | ✅ |
| II. MFA antes de ação de risco | `requireRecentMfa` (já existe, reaproveitado de F01/F02) em ativar, suspender, reativar, encerrar; entrar/sair de manutenção e disparar migração também exigem | ✅ |
| II. Sessão só em instância ativa | Mecanismo inalterado: `access_instance.state = 'ativa'` já é a condição normativa (F01); F03 só passa a escrever `suspensa`/`manutencao`, sem tocar a consulta de validação | ✅ |
| III. Contratos versionados | OpenAPI 1.3.0 (compatível, só adição); projeção v2 inalterada; nenhum contrato quebrado | ✅ |
| III. Artefato do produto de referência | Executor de migração provado com uma versão nova do artefato `sparkref` sobre uma instância de homologação anterior (`SC-044`) | ✅ |
| IV. Idempotência | Ações de transição são comandos síncronos com `FOR UPDATE` e estado esperado (R-03, igual a F02); migração de instância reaproveita a idempotência de tarefa de F02 | ✅ |
| IV. Tarefa persistente para migração | `admin_task` ganha `kind = 'migracao'`, mesma máquina de lease/heartbeat/repetição de F02; nenhuma tarefa nova de infraestrutura | ✅ |
| IV. Sem `DROP DATABASE`, sem remoção automática | Encerramento só marca `ENCERRADA` e grava o registro de retenção; `check:migrations` continua sem exceção | ✅ |
| IV. Máquina de estados com pré-condições | `transitions.ts` de F02 ganha as transições novas, cada uma com sua pré-condição, sem caminho de edição direta | ✅ |
| IV. Concorrência | `FOR UPDATE` na linha da instância (herdado de F02); duas transições concorrentes — a segunda recebe `CONFLICT_STATE` | ✅ |
| V. MySQL real e falhas | Suspensão com transação em curso, queda do executor de migração a meio, checagem de saúde reprovada — todos com MySQL real | ✅ |
| VI. Auditoria e privacidade | Toda transição grava `instance_transition` e `core_audit_event` (reaproveitados de F02); nenhuma senha, SQL ou stack trace em tela/log (`SC-045`) | ✅ |
| VII. Monólito e escopo | Mesmo executor de tarefa, mesmo trabalhador; rotação de credencial, console de restauração com um clique, rollout em massa e transferência entre contratantes ficam fora (ver "Fora de F03") | ✅ |
| VII. Sem SQL livre ou edição de status técnico | Falha de migração mostra etapa e mensagem sanitizada; nenhuma edição de estado técnico pela interface | ✅ |
| VIII. Design system | Telas reaproveitam os blocos já usados em F02 (`Stepper`, `DataTable`, `SettingsBlock`); página pública nova usa um layout mínimo do design system | ✅ |
| Gate de prontidão | `npm run gate -- F03` exige só `D-01`, já confirmada | ✅ |

**Nota 1 — ordem de escrita Core/projeção**: toda transição que **revoga** acesso (suspender,
entrar em manutenção) grava primeiro a projeção (`access_instance.state`) e só depois o estado do
Core; toda transição que **concede** acesso (ativar, reativar, sair da manutenção) grava primeiro
o Core e só depois a projeção — mesma ordem já usada por `activateSyntheticInstance` (F02). Uma
falha entre as duas escritas nunca abre acesso indevido: nos dois sentidos, o estado que resta
"preso" é o que nega. Detalhe em [research.md](./research.md) (R-01).

**Pós-design (Phase 1)**: reavaliado com data-model e contratos — sem novas violações.

## Project Structure

### Documentation (this feature)

```text
specs/004-f03-ciclo-operacao-instancia/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi-f03.yaml          # incorporado a contracts/openapi.yaml (v1.3.0)
│   ├── ui-f03.md
│   └── commands-f03.md           # incorporado a contracts/commands.md (relato de backup)
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
server/
├── migrations/spark_core/        # 0005: admin_task.kind += 'migracao'; step += etapas de
│                                  #       migração; instance_health_check, instance_backup_record,
│                                  #       instance_termination (só inclusão)
├── src/
│   ├── modules/
│   │   ├── instances/
│   │   │   ├── transitions.ts    # ALLOWED ganha as 6 transições novas; funções de ciclo
│   │   │   │                     #   (activateInstance, suspendInstance, reactivateInstance,
│   │   │   │                     #    enterMaintenance, exitMaintenance, terminateInstance)
│   │   │   ├── health.ts         # novo: checkInstanceHealth (conectividade + versão de schema)
│   │   │   ├── backup.ts         # novo: recordBackupResult, latestBackup
│   │   │   └── routes.ts         # + /activate, /suspend, /reactivate, /maintenance/enter,
│   │   │                         #   /maintenance/exit, /terminate, /health
│   │   ├── provisioning/
│   │   │   ├── tasks.ts          # createMigrationTask (mesma tabela admin_task, kind='migracao')
│   │   │   └── migration-steps.ts # novo: etapas do executor de migração de instância
│   │   └── access-projection/writer.ts   # setProjectionState aceita 'suspensa'/'manutencao'
│   │                                      # (já aceitava 'ativa'/'pronta'; só uso novo)
│   ├── cli/instances-report-backup.ts    # novo: comando para a infraestrutura relatar backup
│   └── public/                   # novo: página pública mínima de indisponibilidade
├── seeds/f03.ts                  # cenário sintético: instância ativada, uma suspensa com
│                                  #   sessão revogada, histórico de saúde/backup de exemplo
└── tests/{unit,integration,contract}/   # + suítes F03
web/src/
├── api/instances.ts               # + ações de ciclo e saúde
└── pages/instances/                # ações no detalhe (ativar/suspender/reativar/manutenção/
                                     #   encerrar), painel de saúde, tela pública de
                                     #   indisponibilidade
docs/operacao/
├── backup-restauracao.md          # novo: procedimento versionado (SC-043)
└── provisionamento.md             # + nota sobre migração de instância em manutenção
```

**Structure Decision**: mesmo monólito e mesma fronteira de módulos de F02. F03 não cria módulo
novo: amplia `instances` (transições, saúde, backup) e `provisioning` (um tipo de tarefa a mais,
mesmo executor). Nenhum serviço, broker ou processo novo — reforça "monólito modular" (princípio
VII) em vez de introduzir um "serviço de ciclo de vida" separado.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação a justificar.

## Riscos e pontos de atenção

- **Ordem de escrita entre Core e projeção** (nota 1): é a parte mais sensível desta fatia —
  qualquer inversão acidental da ordem em suspender/manutenção abriria uma janela de acesso
  indevido. Mitigação: função única `writeLifecycleTransition` que centraliza a ordem por
  direção (revogar/conceder), testada com queda forçada entre as duas escritas nos dois sentidos.
- **Checagem de saúde na saída de manutenção**: precisa de um resultado determinístico para não
  prender a instância indefinidamente por um falso negativo. Mitigação: a mesma verificação
  determinística já usada na etapa `verificar` de F02 (marcador, versão de schema, privilégios
  negativos), sem heurística nova.
- **Backup como dado externo**: o Core nunca executa o backup; depende de a infraestrutura chamar
  o comando novo depois de cada cópia. Mitigação: documentar no procedimento operacional
  (`docs/operacao/backup-restauracao.md`) como parte do `Definition of Done` desta fatia, não
  deixar para depois.
- **Ensaio de restauração (`T-16`)**: exigido pelo critério de sucesso Core (`NFR-007`), mas é um
  procedimento operacional, não uma tela; a prova desta fatia é o documento e um ensaio manual
  registrado em `evidence.md`, não uma suíte automatizada de restauração completa.
