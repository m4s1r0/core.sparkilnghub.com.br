---

description: "Tarefas da fatia F03 — Ciclo e operação da instância"
---

# Tasks: F03 — Ciclo e operação da instância

**Input**: Design documents from `specs/004-f03-ciclo-operacao-instancia/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios (constituição V, mesma regra de F02). Regras de alto risco — ordem de
escrita Core/projeção (R-01), limite transacional da suspensão, checagem de saúde na saída de
manutenção, backup prévio exigido pelo executor de migração, encerramento sem `DROP DATABASE` —
têm o teste escrito e **observado falhando** antes da implementação. Integração sempre contra
MySQL real.

**Organization**: por história de usuário (US1–US7); cada fase termina em ponto verificável
isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história da spec (US1…US7)
- Caminhos relativos à raiz do repositório

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: marcar a fatia como em implementação

- [X] T001 Atualizar `docs/slices.yaml` com `F03: em-implementacao` e confirmar
  `npm run gate -- F03` = 0 (só exige `D-01`, já confirmada)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: migração 0005, o núcleo de transição de ciclo (ordem Core/projeção, elegibilidade,
saúde, backup) e o contrato publicado — usados por mais de uma história

**⚠️ CRITICAL**: nenhuma história começa antes do fim desta fase

### Esquema

- [X] T002 Criar `server/migrations/spark_core/migrations/0005_ciclo_operacao.sql` conforme
  [data-model.md](./data-model.md): `ALTER TABLE admin_task MODIFY kind ENUM('provisionamento',
  'migracao') NOT NULL`; `ALTER TABLE admin_task_step_run MODIFY step ENUM('validar', 'reservar',
  'criar_bancos', 'criar_credencial', 'aplicar_migracoes', 'configurar', 'preparar_convite',
  'verificar', 'concluir', 'confirmar_manutencao', 'confirmar_backup_previo',
  'aplicar_migracoes_instancia', 'verificar_pos_migracao') NOT NULL`; `instance_health_check`
  (`id BINARY(16)` PK, `instance_id BINARY(16)` FK, `checked_at DATETIME(6)`, `healthy BOOLEAN`,
  `schema_version INT UNSIGNED NULL`, `reason VARCHAR(300) NULL`, `origin ENUM('painel',
  'saida_manutencao')`; índice `(instance_id, checked_at)`); `instance_backup_record` (`id
  BINARY(16)` PK, `instance_id BINARY(16)` FK, `taken_at DATETIME(6)`, `result ENUM('sucesso',
  'falha')`, `origin VARCHAR(80)`, `detail VARCHAR(300) NULL`, `reported_at DATETIME(6)`; índice
  `(instance_id, taken_at)`); `instance_termination` (`id BINARY(16)` PK, `instance_id BINARY(16)`
  FK UNIQUE, `reason VARCHAR(500)`, `export_reference VARCHAR(300) NULL`, `retention_policy
  VARCHAR(300)`, `actor_id BINARY(16)`, `created_at DATETIME(6)`); atualizar `manifest.json` com
  sha256. Nenhuma migração em `access_projection` nem `spark_identity` (já cobrem `suspensa`/
  `manutencao` desde F02)
- [X] T003 [P] Acrescentar o caso `spark_core` 4→5 em
  `server/tests/integration/migrations/upgrade-path.test.ts` (igual, a partir de `origin/main`, ao
  aplicar do zero) e confirmar `scripts/lib/upgrade.ts`/`check:upgrade`

### Núcleo do ciclo (ordem Core/projeção, elegibilidade, saúde, backup)

- [X] T004 [P] Escrever teste (deve falhar) `server/tests/unit/instances/lifecycle-order.test.ts`:
  para uma transição que revoga acesso (`direction = 'revogar'`), a projeção é escrita antes do
  Core; para uma que concede (`direction = 'conceder'`), o Core é escrito antes da projeção;
  simular falha entre as duas escritas nos dois sentidos e conferir que o resultado nunca abre
  acesso indevido (R-01)
- [X] T005 Implementar `writeLifecycleTransition(ctx, {direction, instanceId, from, to, actor,
  reason, projectionState})` em `server/src/modules/instances/transitions.ts`: dentro da trava já
  existente (`SELECT … FOR UPDATE`), grava `instance_transition`/`core_audit_event` via
  `transition()` (reaproveitada) e chama `setProjectionState` na ordem de `direction`; ampliar
  `ALLOWED` com `PRONTA>ATIVA`, `ATIVA>SUSPENSA`, `SUSPENSA>ATIVA`, `ATIVA>MANUTENCAO`,
  `MANUTENCAO>ATIVA`, `SUSPENSA>ENCERRADA` — até T004 passar
- [X] T006 [P] Escrever teste (deve falhar) `server/tests/unit/instances/eligibility.test.ts`:
  `checkInstanceEligibility` recusa contratante inativo, schema diferente do manifesto do produto
  implantado e ausência de administrador ativo **e** de convite inicial pendente válido; aceita
  com administrador ativo OU com convite pendente ainda não aceito (exceção `SC-024`)
- [X] T007 Implementar `checkInstanceEligibility(ctx, instanceId)` em
  `server/src/modules/instances/eligibility.ts` (consulta fora da trava; devolve motivo estável
  quando recusa) — até T006 passar; usada por `activateInstance` e `reactivateInstance`
- [X] T008 [P] Escrever teste (deve falhar) `server/tests/unit/instances/health.test.ts`:
  `checkInstanceHealth` devolve `healthy = true` com marcador correto e versão de schema igual ao
  manifesto; `healthy = false` com marcador ausente/divergente, versão diferente ou conexão
  recusada, sempre com `reason` sanitizado (sem SQL)
- [X] T009 Implementar `checkInstanceHealth(ctx, instanceId, origin)` em
  `server/src/modules/instances/health.ts`, reaproveitando a conexão/consulta de marcador e
  `checkHistory` já usadas na etapa `verify` de F02 (sem a parte de banco de acesso); grava
  `instance_health_check` (só inclusão) — até T008 passar
- [X] T010 [P] Escrever teste (deve falhar) `server/tests/unit/instances/backup.test.ts`:
  `latestBackup` devolve `null`/"sem backup bem-sucedido" quando não há linha `result = 'sucesso'`
  e a linha mais recente quando há; `recordBackupResult` recusa `instanceId` inexistente
- [X] T011 Implementar `recordBackupResult`/`latestBackup` em
  `server/src/modules/instances/backup.ts` sobre `instance_backup_record` — até T010 passar

### Contrato publicado e apoio de teste

- [X] T012 [P] Incorporar [openapi-f03.yaml](./contracts/openapi-f03.yaml) a
  `contracts/openapi.yaml` (versão 1.3.0, mudança compatível), registrar em
  `contracts/CHANGELOG.md`, e acrescentar em `contracts/capabilities.md` as capacidades novas
  (ciclo de instância, saúde, migração de instância); rodar `npm run build:contracts`
- [X] T013 [P] Criar `server/tests/support/f03.ts`: `instanceAtState(ctx, state, overrides?)`
  (prepara uma instância já na posição exigida, reaproveitando os helpers de F02),
  `insertHealthCheck`, `insertBackupRecord`, `openSessionFor(instanceId)` (sessão de produto de
  teste para os cenários de suspensão/reativação)

**Checkpoint**: migração 0005 aplicada em banco vazio e a partir de `origin/main`; ordem
Core/projeção, elegibilidade, saúde e backup testadas isoladamente; contrato 1.3.0 publicado

---

## Phase 3: User Story 1 - Ativar a instância pronta (Priority: P1) 🎯 MVP

**Goal**: ativar uma instância `PRONTA` elegível pelo painel, substituindo o caminho só-sementes
de F02 por uma ação administrativa real

**Independent Test**: ativar uma instância `PRONTA` com convite pendente e outra com
administrador vinculado; confirmar `ATIVA`, projeção `ativa` e login do produto aceito

### Tests for User Story 1 ⚠️

- [X] T014 [P] [US1] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/activate.test.ts`: `PRONTA` com convite pendente →
  `ATIVA` e login aceito após aceite; contratante inativo → `409 INSTANCE_NOT_ELIGIBLE`, estado
  inalterado; schema incompatível → mesmo código; já `ATIVA` → `409 CONFLICT_STATE`
- [X] T015 [P] [US1] Escrever teste de contrato `server/tests/contract/instances-lifecycle-contract.test.ts`
  (reaproveitado pelas demais histórias desta fatia): resposta real de `POST
  .../instances/:id/activate` validada contra `contracts/openapi.yaml` 1.3.0

### Implementation for User Story 1

- [X] T016 [US1] Implementar `activateInstance(ctx, instanceId, actor, reason?)` em
  `server/src/modules/instances/transitions.ts`: `checkInstanceEligibility` fora da trava, depois
  `writeLifecycleTransition({direction: 'conceder', from: 'PRONTA', to: 'ATIVA',
  projectionState: 'ativa'})` — até T014 passar
- [X] T017 [US1] Rota `POST /api/v1/instances/:instanceId/activate` em
  `server/src/modules/instances/routes.ts`: `requireRecentMfa`, `withIdempotency`, devolve
  `TransitionResult` (`id`, `state`, `version`); `409` com o motivo de `checkInstanceEligibility`
  quando recusado
- [X] T018 [US1] Em `server/src/modules/provisioning/initial-invitation.ts` e na rota
  `POST .../initial-invitation/issue`, ampliar a pré-condição de "só `PRONTA`" para "`PRONTA` OU
  (`ATIVA` sem administrador local ativo)" (`FR-032`); teste de integração em
  `server/tests/integration/provisioning/initial-invitation.test.ts` cobrindo o caso `ATIVA` sem
  administrador — até então passar
- [X] T019 [US1] `web/src/api/instances.ts`: função `activateInstance(id)`; em
  `web/src/pages/instances/InstancePage.tsx`, botão "Ativar" visível só em `PRONTA`, com
  `Dialog`/`ReauthDialog` de confirmação
- [X] T020 [P] [US1] Teste de componente `web/tests/component/instances/activate-action.test.tsx`:
  botão ausente fora de `PRONTA`; sucesso atualiza o `Badge` de estado; `409` mostra o motivo
- [X] T021 [US1] Estender `web/tests/e2e/instances.spec.ts` (ou `provisioning.spec.ts`): ativar
  pelo painel uma instância `PRONTA` recém-provisionada e conferir o login do produto liberado

**Checkpoint**: instância alcança `ATIVA` por ação administrativa real; US1 testável isoladamente

---

## Phase 4: User Story 2 - Suspender instância com sessão aberta (Priority: P1)

**Goal**: suspender uma instância `ATIVA`, negando toda nova autorização a partir da confirmação
e respeitando o limite transacional

**Independent Test**: com sessões abertas em A e B, suspender A; nova chamada em A negada, a já
autorizada conclui, B inalterada; visitante não autenticado vê a página pública

### Tests for User Story 2 ⚠️

- [X] T022 [P] [US2] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/suspend.test.ts`: a partir da confirmação, uma nova
  validação de sessão na instância falha (`CA-SC-008`); uma transação que já passou a validação
  antes da confirmação conclui sem interrupção (`SC-028`, via conexão aberta antes da suspensão);
  suspender A não altera sessão, estado nem projeção de B (`CS-012`); já `SUSPENSA` →
  `409 CONFLICT_STATE`; busca no código por chamadas a `suspendInstance` fora de rota explícita
  (nenhuma automática por telemetria/vigência, `RN-SC-003`)
- [X] T023 [P] [US2] Escrever teste E2E/integração da página pública
  `server/tests/integration/instances/public-status-page.test.ts`: `GET /i/:slug` de instância
  `SUSPENSA` devolve página mínima sem motivo financeiro; de instância inexistente ou em outro
  estado devolve `404` idêntico (sem enumeração)

### Implementation for User Story 2

- [X] T024 [US2] Implementar `suspendInstance(ctx, instanceId, actor, reason)` em
  `transitions.ts`: `writeLifecycleTransition({direction: 'revogar', from: 'ATIVA', to:
  'SUSPENSA', projectionState: 'suspensa'})`, `reason` obrigatório — até T022 passar
- [X] T025 [US2] Rota `POST /api/v1/instances/:instanceId/suspend` (`requireRecentMfa`, corpo
  `{reason}`, `withIdempotency`)
- [X] T026 [US2] Rota pública `GET /i/:slug` em `server/src/public/instance-status.ts` (sem
  `coreSession`): resolve a instância pelo slug, devolve a página mínima quando `state` ∈
  {`SUSPENSA`, `MANUTENCAO`} (`FR-007`), `404` em qualquer outro caso — até T023 passar
- [X] T027 [US2] `web/src/pages/instances/InstancePage.tsx`: ação "Suspender" (só em `ATIVA`) com
  diálogo de motivo + reautenticação; `web/src/api/instances.ts`: `suspendInstance(id, reason)`

**Checkpoint**: suspensão nega acesso imediatamente, preserva transação em curso e não afeta
outras instâncias; testável isoladamente sobre uma instância já `ATIVA` de teste

---

## Phase 5: User Story 3 - Reativar instância suspensa (Priority: P1)

**Goal**: reativar uma instância `SUSPENSA` sem restaurar sessão revogada, senha ou cobrança

**Independent Test**: suspender e reativar a mesma instância; sessão revogada continua inválida;
nova autenticação cria sessão válida

### Tests for User Story 3 ⚠️

- [X] T028 [P] [US3] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/reactivate.test.ts`: `SUSPENSA` elegível → `ATIVA`;
  sessão revogada pela suspensão continua inválida após a reativação (`CA-SC-009`); nenhuma senha
  ou cobrança alterada; contratante inativado no intervalo → `409 INSTANCE_NOT_ELIGIBLE`,
  permanece `SUSPENSA`

### Implementation for User Story 3

- [X] T029 [US3] Implementar `reactivateInstance(ctx, instanceId, actor)` em `transitions.ts`:
  `checkInstanceEligibility` + `writeLifecycleTransition({direction: 'conceder', from:
  'SUSPENSA', to: 'ATIVA', projectionState: 'ativa'})` — até T028 passar
- [X] T030 [US3] Rota `POST /api/v1/instances/:instanceId/reactivate` (`requireRecentMfa`,
  `withIdempotency`)
- [X] T031 [US3] `web/src/pages/instances/InstancePage.tsx`: ação "Reativar" (só em `SUSPENSA`)

**Checkpoint**: ciclo ativar → suspender → reativar completo e testável de ponta a ponta
(quickstart §1–§3); fecha o MVP de P1 (US1+US2+US3)

---

## Phase 6: User Story 4 - Manutenção controlada (Priority: P2)

**Goal**: colocar uma instância `ATIVA` em manutenção, bloqueando negócio mas permitindo concluir
transação em curso, e só sair com checagem de saúde aprovada

**Independent Test**: entrar em manutenção com transação em curso; novas operações bloqueadas, a
em curso conclui; saída exige saúde aprovada

### Tests for User Story 4 ⚠️

- [X] T032 [P] [US4] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/maintenance.test.ts`: `ATIVA → MANUTENCAO` bloqueia a
  projeção (mesma verificação de `suspend.test.ts`); transação já autorizada antes da confirmação
  conclui; "sair da manutenção" com produto saudável → `ATIVA` com `instance_health_check`
  gravado; com produto indisponível → `409 HEALTH_CHECK_FAILED`, permanece `MANUTENCAO`,
  `instance_health_check` gravado com `healthy = false`

### Implementation for User Story 4

- [X] T033 [US4] Implementar `enterMaintenance`/`exitMaintenance` em `transitions.ts`:
  `enterMaintenance` = `writeLifecycleTransition({direction: 'revogar', from: 'ATIVA', to:
  'MANUTENCAO', projectionState: 'manutencao'})` com `reason`; `exitMaintenance` chama
  `checkInstanceHealth(ctx, instanceId, 'saida_manutencao')` e só prossegue para
  `writeLifecycleTransition({direction: 'conceder', from: 'MANUTENCAO', to: 'ATIVA',
  projectionState: 'ativa'})` quando `healthy = true`; senão devolve o `HealthCheck` reprovado
  sem transicionar — até T032 passar
- [X] T034 [US4] Rotas `POST /api/v1/instances/:instanceId/maintenance/enter` (corpo
  `{reason}`) e `POST .../maintenance/exit`, ambas `requireRecentMfa` + `withIdempotency`
- [X] T035 [US4] `web/src/pages/instances/InstancePage.tsx`: ações "Entrar em manutenção" (só em
  `ATIVA`) e "Sair da manutenção" (só em `MANUTENCAO`, mostra o motivo quando a saúde reprova)

**Checkpoint**: manutenção bloqueia e libera negócio de forma segura; testável isoladamente sobre
uma instância `ATIVA` de teste

---

## Phase 7: User Story 5 - Consultar saúde, versão e backup (Priority: P2)

**Goal**: painel de saúde por instância com versão, conectividade, última verificação e último
backup real, nunca um agendamento apresentado como sucesso

**Independent Test**: abrir o painel de uma instância e conferir os quatro campos com origem;
registrar um backup pelo comando novo e ver o painel atualizar

### Tests for User Story 5 ⚠️

- [X] T036 [P] [US5] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/health-panel.test.ts`: `GET .../health` devolve
  `InstanceHealthStatus` completo; sem nenhum `instance_backup_record`, `backup.lastResult` é
  `null` (nunca "sucesso" implícito); `POST .../health` dispara nova checagem com `origin =
  'painel'` e grava `instance_health_check`
- [X] T037 [P] [US5] Escrever teste de integração (deve falhar)
  `server/tests/integration/scripts/report-backup.test.ts`: `npm run instances:report-backup --
  <id> ok --detail texto` grava `instance_backup_record` com `result = 'sucesso'`; `<id>`
  inexistente → saída 1; argumento inválido (`<id>` fora do formato UUID, resultado fora de
  `ok|falhou`) → saída 2

### Implementation for User Story 5

- [X] T038 [US5] Implementar `server/src/cli/instances-report-backup.ts` + script
  `instances:report-backup` em `package.json`, usando `recordBackupResult` (T011) — até T037
  passar
- [X] T039 [US5] Rotas `GET /api/v1/instances/:instanceId/health` (monta `InstanceHealthStatus` a
  partir do último `instance_health_check` e de `latestBackup`) e `POST
  /api/v1/instances/:instanceId/health` (chama `checkInstanceHealth(..., 'painel')`, sem
  `requireRecentMfa` — leitura técnica) — até T036 passar
- [X] T040 [US5] `web/src/pages/instances/InstancePage.tsx`: aba "Saúde" (`DescriptionList` +
  botão "Verificar agora"); `web/src/api/instances.ts`: `getInstanceHealth`,
  `checkInstanceHealthNow`
- [X] T041 [P] [US5] Criar `docs/operacao/backup-restauracao.md`: procedimento versionado para
  backup/restauração de uma instância e do conjunto Core/identidade (`SC-043`), incluindo como
  chamar `instances:report-backup`
- [X] T042 [US5] Ensaio de restauração (`T-16`, manual): restaurar um backup anterior a uma
  revogação de colaborador em ambiente isolado, conferir identidade/dados/estado, reaplicar
  permissões atuais, confirmar que o colaborador revogado continua sem operar e que nenhuma outra
  instância foi alterada; registrar o resultado em `specs/004-f03-ciclo-operacao-instancia/evidence.md`

**Checkpoint**: painel de saúde e backup consultáveis e corretos; testável isoladamente

---

## Phase 8: User Story 6 - Executor controlado de migrações (Priority: P2)

**Goal**: aplicar uma nova versão do artefato a uma instância em manutenção, com backup prévio
exigido e execução registrada, reaproveitando a tarefa/lease de F02

**Independent Test**: instância em manutenção numa versão anterior; aplicar a atualização com
backup prévio registrado conclui; sem backup prévio ou fora de manutenção, recusado

### Tests for User Story 6 ⚠️

- [X] T043 [P] [US6] Escrever teste de integração (deve falhar)
  `server/tests/integration/provisioning/migration-task.test.ts`: criar tarefa `migracao` fora de
  `MANUTENCAO` → `409 CONFLICT_STATE`; sem `instance_backup_record` mais recente que a entrada em
  manutenção → `409 NO_PRIOR_BACKUP`; já na versão vigente → `409 ALREADY_UP_TO_DATE`; caminho
  feliz: etapas `confirmar_manutencao → confirmar_backup_previo →
  aplicar_migracoes_instancia → verificar_pos_migracao` concluem, `schema_version` da instância
  atualizado; queda do executor entre etapas → outro trabalhador retoma sem repetir a etapa já
  efetivada (mesma semântica de lease/retomada de F02, `provisioning/resume.test.ts`)
- [X] T044 [P] [US6] Escrever teste de contrato cobrindo `GET/POST
  .../instances/:id/migration` em `server/tests/contract/instances-lifecycle-contract.test.ts`
  (T015)

### Implementation for User Story 6

- [X] T045 [US6] Implementar `server/src/modules/provisioning/migration-steps.ts`: as quatro
  etapas novas, reaproveitando a rotina de aplicação de artefato de `apply-artifact.ts` (mesma
  usada pela etapa `aplicar_migracoes` de F02) e a verificação de marcador/versão da etapa
  `verify` — até T043 passar
- [X] T046 [US6] Em `server/src/modules/provisioning/tasks.ts`, implementar
  `createMigrationTask(ctx, instanceId, actor)`: confere `MANUTENCAO` e `instance_backup_record`
  mais recente que a entrada em manutenção antes de abrir a tarefa (`kind = 'migracao'`); em
  `executor.ts`, despachar as etapas novas quando `task.kind = 'migracao'`
- [X] T047 [US6] Rotas `GET /api/v1/instances/:instanceId/migration` (última tarefa ou `null`) e
  `POST /api/v1/instances/:instanceId/migration` (`requireRecentMfa`, `withIdempotency`, 202 com
  `MigrationTask`)
- [X] T048 [US6] `web/src/pages/instances/InstancePage.tsx`: aba "Migração" (só quando
  `MANUTENCAO`), com botão "Aplicar" e histórico de execuções (reaproveita `StepsBlock`/
  `DataTable` já usados no acompanhamento de provisionamento de F02)

**Checkpoint**: executor de migração de instância funcional e retomável; testável isoladamente
sobre uma instância de homologação em manutenção

---

## Phase 9: User Story 7 - Encerrar instância (Priority: P3)

**Goal**: encerrar uma instância `SUSPENSA` como ação terminal, sem excluir recurso físico

**Independent Test**: encerrar uma instância `SUSPENSA`; chega a `ENCERRADA` com motivo e
retenção registrados; banco físico intacto; nenhuma ação de reabertura/exclusão na interface

### Tests for User Story 7 ⚠️

- [X] T049 [P] [US7] Escrever teste de integração (deve falhar)
  `server/tests/integration/instances/terminate.test.ts`: `SUSPENSA` + motivo + política de
  retenção → `ENCERRADA`, `instance_termination` gravada na mesma transação; `ATIVA`/`PRONTA` →
  `409 CONFLICT_STATE`; depois de `ENCERRADA`, `instance_resource` e os bancos físicos continuam
  intactos (nenhuma chamada a `DROP DATABASE`); acesso de negócio continua negado como em
  `SUSPENSA`
- [X] T050 [P] [US7] Escrever teste de contrato para `POST .../instances/:id/terminate` em
  `server/tests/contract/instances-lifecycle-contract.test.ts` (T015)

### Implementation for User Story 7

- [X] T051 [US7] Implementar `terminateInstance(ctx, instanceId, actor, {reason,
  exportReference, retentionPolicy})` em `transitions.ts`: na mesma transação de
  `writeLifecycleTransition({direction: 'revogar' (sem efeito novo na projeção, já 'suspensa'),
  from: 'SUSPENSA', to: 'ENCERRADA'})`, insere `instance_termination` — até T049 passar
- [X] T052 [US7] Rota `POST /api/v1/instances/:instanceId/terminate` (`requireRecentMfa`, corpo
  `{reason, exportReference?, retentionPolicy}`, `withIdempotency`)
- [X] T053 [US7] `web/src/pages/instances/InstancePage.tsx`: diálogo "Encerrar" (só em
  `SUSPENSA`), com aviso de irreversibilidade no MVP; confirmar que nenhuma tela oferece reabrir
  ou excluir definitivamente uma instância `ENCERRADA`

**Checkpoint**: todas as sete histórias completas e testáveis de ponta a ponta

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: sementes, limpeza de ambiente, E2E completo, segurança e fechamento da fatia

- [X] T054 [P] Criar `server/seeds/f03.ts` (instância sintética ativada, uma suspensa com sessão
  de exemplo revogada, um `instance_health_check` e um `instance_backup_record` de amostra) e
  ligar em `server/src/cli/db-seed.ts`
- [X] T055 [P] Confirmar `scripts/dev-reset.ts`: instâncias sintéticas recriadas não deixam linha
  órfã em `instance_health_check`/`instance_backup_record`/`instance_termination` (chave
  `instance_id`, já cobertas pela limpeza existente por instância); ajustar só se o teste mostrar
  o contrário
- [X] T056 Criar `web/tests/e2e/lifecycle.spec.ts`: jornada completa do quickstart (ativar →
  suspender → reativar → manutenção → saúde → migração → encerrar) em 360/1280 px, página pública
  de indisponibilidade, teclado e axe sem violações sérias
- [X] T057 [P] Escrever `server/tests/integration/security/no-secrets-f03.test.ts`: nenhuma
  senha, SQL ou stack trace em telas, respostas, logs, `core_audit_event`,
  `instance_transition`, `instance_health_check`, `instance_backup_record` ou
  `instance_termination` desta fatia (`CS-018`)
- [X] T058 Rodar `npm run verify` completo e escrever
  `specs/004-f03-ciclo-operacao-instancia/evidence.md` (mesmo formato de F02: etapas, cenários
  críticos T-03/T-16, desempenho, defeitos encontrados, limitações)
- [ ] T059 Depois do CI do GitHub verde para esta fatia, marcar `F03: concluida` em
  `docs/slices.yaml`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende do Setup; bloqueia todas as histórias
- **US1 (Phase 3)**: depende só da Foundational — primeira história, MVP inicial
- **US2 (Phase 4)**: depende só da Foundational (não depende de US1: suspende uma instância já
  `ATIVA` preparada pelo suporte de teste, T013)
- **US3 (Phase 5)**: depende da Foundational; testável isoladamente, mas o ciclo completo
  (quickstart) encadeia US1 → US2 → US3
- **US4 (Phase 6)**: depende só da Foundational (`checkInstanceHealth`, T009)
- **US5 (Phase 7)**: depende só da Foundational (`backup.ts`, `health.ts`)
- **US6 (Phase 8)**: depende da Foundational e, operacionalmente, de haver `instance_backup_record`
  (US5) para o caminho feliz do teste — mas a rejeição `NO_PRIOR_BACKUP` é testável sem US5
  implementada, usando o suporte de teste (T013) para inserir o registro diretamente
- **US7 (Phase 9)**: depende só da Foundational (consome `SUSPENSA`, já alcançável desde US2)
- **Polish (Phase 10)**: depende de todas as histórias desejadas estarem completas

### User Story Dependencies

- US1, US2, US4, US5 e US7: nenhuma depende de outra história para ser testada (cada uma parte de
  um estado preparado pelo suporte de teste, T013)
- US3 depende de US1 só para o fluxo de ponta a ponta do quickstart (ativar → suspender →
  reativar); isoladamente, testa a partir de uma instância já `SUSPENSA`
- US6 depende de US5 só para o caminho feliz completo (backup real registrado); a recusa sem
  backup é independente

### Parallel Opportunities

- Foundational: T003 junto com T002; T004/T006/T008/T010 (testes) em paralelo entre si; T012 e
  T013 em paralelo ao restante
- US1: T014 e T015 juntos; T020 em paralelo à rota (T017/T018)
- US2: T022 e T023 juntos
- US4, US5, US6, US7: os testes de cada fase (`[P]`) em paralelo entre si
- US1, US2, US4, US5 e US7 podem ser implementadas em paralelo por pessoas diferentes depois da
  Foundational

---

## Parallel Example: Foundational

```text
Task: "Ordem Core/projeção em server/tests/unit/instances/lifecycle-order.test.ts"
Task: "Elegibilidade em server/tests/unit/instances/eligibility.test.ts"
Task: "Saúde em server/tests/unit/instances/health.test.ts"
Task: "Backup em server/tests/unit/instances/backup.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Setup e Foundational
2. US1 (ativar) → US2 (suspender) → US3 (reativar), nessa ordem para validar o ciclo completo do
   quickstart §1–§3
3. **STOP and VALIDATE**: quickstart §0–§3

### Incremental Delivery

1. MVP (US1–US3) → US4 (manutenção) → US5 (saúde/backup) → US6 (migração, depende do backup real
   de US5 para o caminho feliz) → US7 (encerrar) → Polish
2. Cada história fecha com sua suíte de integração verde

---

## Notes

- Commits citam IDs (`SC-*`, `FR-*`, `CA-SC-*`, `RN-SC-*`, `T-03`, `T-16`); branch
  `004-f03-ciclo-operacao-instancia`
- Nenhuma tarefa adiciona rota de reabertura, exclusão definitiva ou transferência de instância
  entre contratantes (fora do MVP, `SC-031`, `RN-SC-005`)
- Nenhum código em `server/src` contém `DROP DATABASE` nem remove `instance_resource`;
  `check:migrations` continua sem exceção
