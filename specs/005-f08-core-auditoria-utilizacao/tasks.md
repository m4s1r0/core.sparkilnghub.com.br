# Tasks: F08-Core — Auditoria, utilização e painel do Core

**Input**: Design documents from `specs/005-f08-core-auditoria-utilizacao/`

**Branch**: `005-f08-core-auditoria-utilizacao`

**Rastreabilidade**: SC-032–SC-041, SP-098, NFR-010/014, CA-SC-011/012, T-14, D-01, D-02

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências incompletas)
- **[Story]**: User story a que pertence (US1–US6)
- Caminhos são relativos à raiz do repositório

---

## Phase 1: Setup (Infraestrutura compartilhada)

**Purpose**: Atualização do design system e criação da branch.

- [X] T001 Atualizar `web/package.json`: `"@sparkling-hub/design-system": "file:../vendor/design-system/sparkling-hub-design-system-0.2.1.tgz"` e rodar `npm install` no diretório `web/` (R-06; API 0.2.1 preservada — sem ajustes de código)
- [X] T002 Verificar que `npm run verify` continua verde após atualização do DS; corrigir eventual regressão de tipo ou snap antes de prosseguir

---

## Phase 2: Fundacional (Pré-requisitos bloqueantes)

**Purpose**: Migrações de schema que BLOQUEIAM todas as US.

**⚠️ CRÍTICO**: Nenhum trabalho de User Story pode começar até esta fase estar completa.

- [X] T003 Criar `server/migrations/spark_core/0006_auditoria_utilizacao.sql` com: (1) `CREATE TABLE instance_usage_batch` conforme data-model.md — `id BINARY(16) PK`, `instance_id BINARY(16)`, `batch_id VARCHAR(36)`, `received_at DATETIME(6)`, `events_accepted INT UNSIGNED DEFAULT 0`, `events_discarded INT UNSIGNED DEFAULT 0`, UNIQUE KEY `uq_instance_batch(instance_id, batch_id)`, KEY `k_instance_usage_batch(instance_id, received_at)`; (2) `CREATE TABLE instance_usage_event` com `id BINARY(16) PK`, `instance_id BINARY(16)`, `event_id VARCHAR(36)`, `occurred_at DATETIME(6)`, `received_at DATETIME(6)`, `kind VARCHAR(48)`, `count INT UNSIGNED DEFAULT 1`, UNIQUE KEY `uq_instance_event(instance_id, event_id)`, KEY `k_instance_event_period(instance_id, occurred_at)`, KEY `k_instance_event_kind_period(kind, occurred_at)`; (3) `ALTER TABLE app_credential MODIFY scopes SET('sessions','members','connection','utilizacao') NOT NULL`
- [X] T004 Criar `server/migrations/spark_identity/0005_auditoria_index.sql` com: `ALTER TABLE security_event ADD KEY k_security_event_instance (instance_id, created_at)`
- [X] T005 Aplicar migrações (`spark_core` 5→6, `spark_identity` 4→5) em ambiente local e confirmar que `npm run verify` continua verde (sem regressão de schema)
- [X] T006 [P] Criar `server/src/modules/utilization/utilization.ts` com os tipos TypeScript `UsageBatchRequest`, `UsageBatchEvent`, `UsageBatchResult`, `UsageEventKind` (enum: `atendimentos_iniciados`, `atendimentos_concluidos`, `vendas_confirmadas`, `usuarios_ativos`); `kind` fora do enum é aceito com `log.warn` (forward compatibility)
- [X] T007 [P] Criar `server/src/lib/csv.ts` (ou adicionar a lib utilitária existente) com função `sanitizeCsvCell(value: string): string` que prefixa com `'` células cujo valor começa com `=`, `+`, `-` ou `@` (R-09, SC-041)

**Checkpoint**: Migrações aplicadas e tipos criados — US podem começar.

---

## Phase 3: User Story 1 — Receber e deduplicar lotes de utilização (Priority: P1) 🎯 MVP

**Goal**: Expor `POST /internal/v1/instances/:instanceId/usage-batches`; autenticar via credencial de escopo `utilizacao`; deduplica por `(instance_id, event_id)` via INSERT IGNORE; retorna 200 para lote já visto (idempotência de batch_id).

**Independent Test**: curl lote novo → 202; reenvio mesmo `batch_id` → 200; evento duplicado em lote novo → `events_discarded` correto; credencial de instância errada → 403; instância SUSPENSA → 409.

### Implementação US1

- [X] T008 Adicionar validação de escopo `utilizacao` em `server/src/modules/app-credentials/app-credentials.ts`: a função de validação de credencial existente deve aceitar o novo escopo na verificação de `app_credential.scopes`; confirmar que o `ALTER TABLE` da migração 0006 reflete no código de validação de enum/SET
- [X] T009 Implementar função `receiveUsageBatch(instanceId: Buffer, request: UsageBatchRequest): Promise<UsageBatchResult>` em `server/src/modules/utilization/utilization.ts`: (a) verificar que `instance_id` da credencial bate com `instanceId` do path (403 se diferir — I-01, CA-SC-011); (b) verificar estado da instância (409 CONFLICT_STATE se não ATIVA/PRONTA — SC-037); (c) verificar idempotência de batch_id: se `(instance_id, batch_id)` já existe em `instance_usage_batch`, retornar resultado original (200); (d) processar eventos via `INSERT IGNORE INTO instance_usage_event` em batch; (e) gravar resumo em `instance_usage_batch` com `events_accepted = ROW_COUNT()` equivalente; retornar `UsageBatchResult`
- [X] T010 Criar `server/src/modules/utilization/routes.ts` com rota `POST /internal/v1/instances/:instanceId/usage-batches`: validação de schema Zod do body (batch_id UUID, events[0..500]); autenticação via middleware de credencial de app; chamar `receiveUsageBatch`; retornar 202 (novo) ou 200 (idempotente); respostas de erro com `code` estável (403, 409, 422) — contratos em `contracts/openapi-f08.yaml`
- [X] T011 Registrar módulo utilization no bootstrap do servidor (arquivo de registro de rotas existente, provavelmente `server/src/app.ts` ou equivalente): importar e montar o router de utilization
- [X] T012 Escrever testes de integração em `server/tests/integration/utilization/receive-batch.test.ts` cobrindo (MySQL real — constituição V): lote novo → 202; reenvio mesmo batch_id → 200 sem duplicação; evento duplicado em batch diferente → discarded; lote com `occurred_at` atrasado → grava `occurred_at` original; credencial de instância B no path de instância A → 403; instância SUSPENSA → 409; lote com events vazio → 202 com accepted=0; dois envios concorrentes do mesmo batch_id → exatamente um 202 (T-14, CA-SC-011, constituição I)

**Checkpoint**: `POST /internal/v1/instances/.../usage-batches` funcional e testado com produto de referência.

---

## Phase 4: User Story 2 — Painel de estado expandido (Priority: P1)

**Goal**: `GET /api/v1/dashboard/stats` retorna métricas operacionais completas (instâncias por estado, provisionamentos, utilização, telemetria, versão); UI exibe todos os indicadores num painel único.

**Independent Test**: curl ao endpoint com sessão admin → JSON com todos os campos de `DashboardStats`; instância sem dados de uso → `instances_without_any_data > 0`; abrir painel na UI e verificar StatsBlocks.

### Implementação US2 — Servidor

- [X] T013 Criar função `getDashboardStats(db: Pool): Promise<DashboardStats>` em `server/src/modules/system/derive-status.ts` (ou novo arquivo `server/src/modules/system/dashboard-stats.ts`): calcular `instances_by_state` (GROUP BY state em `instance`), `pending_provisionings`/`failed_provisionings` (GROUP BY status em `admin_task`), `instances_without_recent_usage.last7d`/`last30d` (LEFT JOIN com `instance_usage_event`), `instances_without_any_data` (instâncias ATIVAS sem nenhum `instance_usage_event`), `instances_with_telemetry_delay` (`received_at - max(occurred_at) > 24h` no último lote), `instances_with_schema_issue` (schema_version ≠ versão vigente), `cleanup_last_run`/`cleanup_last_count` (campo a ser atualizado pelo worker US6); campo `calculated_at` = NOW()
- [X] T014 Adicionar rota `GET /api/v1/dashboard/stats` em `server/src/modules/system/routes.ts`: autenticação via sessão administrativa; chamar `getDashboardStats`; retornar JSON com schema de `DashboardStats` definido em `contracts/openapi-f08.yaml`
- [X] T015 Escrever teste de integração em `server/tests/integration/dashboard/stats.test.ts`: endpoint retorna todos os campos; `instances_without_any_data` conta corretamente instância sem eventos; `instances_with_telemetry_delay` detecta lote antigo

### Implementação US2 — Web

- [X] T016 Criar `web/src/api/dashboard.ts` com hook `useDashboardStats()` (React Query, tipo `DashboardStats`)
- [X] T017 Expandir (ou criar) a página de painel em `web/src/pages/dashboard/DashboardPage.tsx` com os novos `StatsBlock` de provisionamento, utilização (7d/30d), sem histórico, atraso de telemetria e schema desatualizado, conforme `contracts/ui-f08.md` seção 1; exibir `calculated_at` formatado em pt-BR; `Skeleton` durante fetch; `Alert tone="error"` em falha

**Checkpoint**: Painel admin exibe métricas completas de utilização e saúde.

---

## Phase 5: User Story 3 — Consultar e exportar acessos de segurança (Priority: P2)

**Goal**: `GET /api/v1/security-events` com filtros (instance_id, actor_account_id, type, result, from/to), paginação e exportação CSV com neutralização de fórmulas.

**Independent Test**: listagem filtrada por result=falha; exportar CSV e verificar cabeçalho + neutralização + sem campos sensíveis; evento > 180 dias exibe ip/user_agent como null.

### Implementação US3 — Servidor

- [X] T018 Ampliar `server/src/modules/identity/security-events.ts` com função `listSecurityEvents(filters, pagination)`: query em `spark_identity.security_event` usando o índice `k_security_event_instance`; filtros: `instance_id`, `actor_account_id`, `type`, `result`, `from`/`to`; retornar `{ items, total, page, page_size }`; registros com `ip IS NULL` retornam `null` (comportamento pós-limpeza de 180 dias — SC-033)
- [X] T019 Adicionar rota `GET /api/v1/security-events` nas rotas de identidade (arquivo de rotas do módulo identity ou criar `server/src/modules/identity/audit-routes.ts`): validar query params via Zod (page ≥ 1, page_size ≤ 100 default 50); autenticação via sessão administrativa; detectar `Accept: text/csv` para exportação; limite 10.000 linhas em CSV (`X-Truncated: true` quando atingido); aplicar `sanitizeCsvCell` em cada célula (T007); gerar cabeçalho CSV com linha de geração e filtros aplicados (SC-041); sem campos sensíveis (sem senha, sem stack trace, sem SQL)
- [X] T020 Escrever teste de integração em `server/tests/integration/audit/security-events.test.ts`: listagem paginada; filtro por result; filtro por instance_id usa índice (verificar EXPLAIN se possível); CSV exportado com neutralização de fórmulas; evento com ip NULL não falha serialização; SC-035: verificar que não existe rota PUT/DELETE para `security_event`

### Implementação US3 — Web

- [X] T021 [P] Criar `web/src/api/security-events.ts` com hook `useSecurityEvents(filters, pagination)` e função `exportSecurityEventsCsv(filters)`
- [X] T022 [P] Criar `web/src/pages/security-events/SecurityEventsPage.tsx`: formulário de filtros (Select resultado, Input instância/conta, DateRange), DataTable com colunas (data/hora, tipo, ator, instância, resultado com Badge), paginação, botão "Exportar CSV" com aviso de limite, Skeleton/Alert, conforme `contracts/ui-f08.md` seção 2
- [X] T023 Adicionar rota `/acessos` no roteador principal (`web/src/App.tsx` ou equivalente) apontando para `SecurityEventsPage`
- [X] T024 Adicionar item "Acessos" na sidebar de navegação (`web/src/components/layout/` — arquivo de menu/sidebar existente)

**Checkpoint**: Tela `/acessos` funcional com filtros, paginação e exportação CSV.

---

## Phase 6: User Story 4 — Consultar e exportar auditoria administrativa (Priority: P2)

**Goal**: `GET /api/v1/audit-events` com filtros (object_type, object_id, actor_id, action, from/to), paginação, exportação CSV; detalhe expandido via Drawer mostrando `changes` e `reason`.

**Independent Test**: filtrar por object_type=Instance; exportar CSV; clicar linha → Drawer mostra changes formatado; CA-SC-010: ator inativado ainda identificado pelo valor do evento.

### Implementação US4 — Servidor

- [X] T025 Ampliar `server/src/modules/audit/audit.ts` com função `listAuditEvents(filters, pagination)`: query em `spark_core.core_audit_event`; filtros: `object_type`, `object_id`, `actor_id`, `action`, `from`/`to`; retornar `{ items, total, page, page_size }`; `changes` retornado como JSON parseado (sem campos sensíveis — CA-SC-010)
- [X] T026 Criar `server/src/modules/audit/routes.ts` (ou adicionar às rotas existentes de auditoria) com rota `GET /api/v1/audit-events`: validar query params via Zod; autenticação via sessão administrativa; suporte a `Accept: text/csv` com limite 10.000 linhas e `sanitizeCsvCell` (T007, SC-041); cabeçalho CSV com linha de geração e filtros; SC-035: sem rota de edição/exclusão
- [X] T027 Escrever teste de integração em `server/tests/integration/audit/audit-events.test.ts`: listagem com filtros; CSV neutralizado; verificar que CA-SC-010 (ator inativado) não quebra serialização; verificar SC-035 (sem PUT/DELETE)

### Implementação US4 — Web

- [X] T028 [P] Criar `web/src/api/audit-events.ts` com hook `useAuditEvents(filters, pagination)` e função `exportAuditEventsCsv(filters)`
- [X] T029 [P] Criar `web/src/pages/audit/AuditEventsPage.tsx`: formulário de filtros (entidade, ID, ator, ação, DateRange), DataTable com colunas (data/hora, ação, entidade, ID entidade, ator), clique em linha abre `Drawer` (DS 0.2.1) com `changes` formatado em JSON e `reason`, botão "Exportar CSV", Skeleton/Alert, conforme `contracts/ui-f08.md` seção 3
- [X] T030 Adicionar rota `/auditoria` no roteador principal apontando para `AuditEventsPage`
- [X] T031 Adicionar item "Auditoria" na sidebar de navegação

**Checkpoint**: Tela `/auditoria` funcional com filtros, detalhe expandido e exportação CSV.

---

## Phase 7: User Story 5 — Relatórios de utilização (Priority: P2)

**Goal**: `GET /api/v1/instances/:instanceId/usage` (por instância) e `GET /api/v1/usage` (consolidado); ambos aceitam filtro de período e fuso; exportam CSV; `data_status: dados_insuficientes` quando sem eventos (CA-SC-012).

**Independent Test**: consultar instância com lotes → contagens corretas; instância sem dados → data_status=dados_insuficientes; evento atrasado → aparece no período de ocorrência; exportar CSV consolidado.

### Implementação US5 — Servidor

- [X] T032 Implementar `getInstanceUsage(instanceId, from, to, timezone)` em `server/src/modules/utilization/utilization.ts`: agregar `instance_usage_event` por `kind` no período usando `occurred_at` (não `received_at`); calcular `data_status`: `ok` se há eventos, `dados_insuficientes` se nenhum evento, `atraso_detectado` se `max(received_at) - max(occurred_at) > 24h`; dados relativos ao `occurred_at` original (SC-040)
- [X] T033 Implementar `getConsolidatedUsage(from, to, timezone, instanceId?)` em `server/src/modules/utilization/utilization.ts`: agregar todas as instâncias (ou filtrada por instanceId) no período; retornar lista de `UsageByPeriod` com `generated_at`
- [X] T034 Adicionar rotas `GET /api/v1/instances/:instanceId/usage` e `GET /api/v1/usage` em `server/src/modules/utilization/routes.ts`: validar params Zod (from/to obrigatórios, timezone default `America/Sao_Paulo`); autenticação via sessão administrativa; suporte a `Accept: text/csv` com `sanitizeCsvCell` e nome de arquivo sugerido `utilizacao-YYYY-MM-DD.csv` (SC-041); CA-SC-012: instância sem dados retorna `data_status: dados_insuficientes`, nunca zero
- [X] T035 Escrever teste de integração em `server/tests/integration/utilization/usage-report.test.ts`: relatório por instância com dados → contagens corretas; instância sem dados → dados_insuficientes; evento atrasado → período de ocorrência; relote não duplica contagem; exportação CSV correto

### Implementação US5 — Web

- [X] T036 Criar `web/src/api/utilization.ts` com hooks `useInstanceUsage(instanceId, from, to, timezone)`, `useConsolidatedUsage(from, to, timezone, instanceId?)` e funções de export CSV
- [X] T037 Adicionar aba "Utilização" em `web/src/pages/instances/InstancePage.tsx`: DateRangePicker (padrão últimos 30 dias), StatsBlock por kind (`atendimentos_iniciados`, `atendimentos_concluidos`, `vendas_confirmadas`, `usuarios_ativos`), Alert de `dados_insuficientes`/`atraso_detectado`, note "Dados de ocorrência", conforme `contracts/ui-f08.md` seção 4
- [X] T038 [P] Criar `web/src/pages/usage/UsagePage.tsx`: filtros (DateRange, Select instância, Select fuso), DataTable com colunas por kind + Badge de status (ok/dados_insuficientes/atraso), botão "Exportar CSV", Skeleton/Alert, conforme `contracts/ui-f08.md` seção 5
- [X] T039 Adicionar rota `/utilizacao` no roteador principal apontando para `UsagePage`
- [X] T040 Adicionar item "Utilização" na sidebar de navegação

**Checkpoint**: Rotas de relatório funcionais; aba Utilização na instância; tela `/utilizacao` consolidada.

---

## Phase 8: User Story 6 — Limpeza automática de IP e agente (Priority: P3)

**Goal**: Worker diário apaga `ip`/`user_agent` de `security_event` com `created_at < NOW() - 180d`; LIMIT 1000/rodada; itera até `affectedRows = 0`; idempotente; painel reflete `cleanup_last_run`.

**Independent Test**: inserir evento com `created_at` de 181 dias atrás; executar worker; `ip IS NULL AND user_agent IS NULL`; evento com 179 dias intacto; segunda execução não falha.

### Implementação US6

- [X] T041 Criar `server/src/workers/ip-retention.ts` com função `cleanIpRetention(identityDb: Pool): Promise<{ affected: number }>`: executar em loop `UPDATE security_event SET ip = NULL, user_agent = NULL WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY) AND (ip IS NOT NULL OR user_agent IS NOT NULL) LIMIT 1000` até `affectedRows = 0`; retornar total limpo; garantir idempotência (`WHERE ip IS NOT NULL OR user_agent IS NOT NULL` exclui registros já limpos — R-03)
- [X] T042 Registrar `cleanIpRetention` no loop do worker de tarefas existente (frequência diária — verificar arquivo de agendamento/loop do worker, provavelmente `server/src/worker.ts` ou `server/src/modules/worker/`): gravar `cleanup_last_run` e `cleanup_last_count` após cada execução bem-sucedida (campo persistido para o painel — US2)
- [X] T043 Expor `cleanup_last_run` e `cleanup_last_count` na função `getDashboardStats` (T013): ler do registro de estado do worker e incluir no retorno de `DashboardStats`; campos nullable (null se worker ainda não executou)
- [X] T044 Escrever teste de integração em `server/tests/integration/workers/ip-retention.test.ts` (MySQL real): evento 181 dias → ip/ua limpos; evento 179 dias → intacto; execução dupla → idempotente; `cleanIpRetention` retorna contagem correta

**Checkpoint**: Worker de limpeza funcional; painel exibe `cleanup_last_run`.

---

## Phase 9: Polish & Cross-cutting

**Purpose**: Verificação final, validação end-to-end e fechamento da fatia.

- [X] T045 [P] Rever todas as rotas novas: confirmar que nenhuma retorna SQL, stack trace, segredo ou dados operacionais do Tuteli em corpo de erro ou CSV (constituição III, SC-037, SC-041)
- [X] T046 [P] Verificar testes negativos de isolamento: pelo menos dois testes com instâncias sintéticas distintas em `receive-batch.test.ts` e `security-events.test.ts` (constituição I, T-04)
- [X] T047 Executar `npm run verify` completo (servidor + web); todos os 16+ checks devem passar verde; corrigir regressão antes de prosseguir
- [X] T048 Executar cenários do `quickstart.md` manualmente (ou com script): US1 lote → deduplicação; US2 painel UI; US3 CSV com neutralização; US4 Drawer; US5 relatório + dados_insuficientes; US6 worker
- [X] T049 Atualizar `docs/slices.yaml`: marcar `F08-Core: em-implementacao` (ou estado correto da fatia); F02 e F03 ainda pendentes de merge — não alterar aqui, aguardar PR
- [X] T050 Commit final da fatia com todas as tarefas [X]; abrir PR `005-f08-core-auditoria-utilizacao → main`; acionar CI (workflow_dispatch se necessário)
- [ ] T051 Após CI verde: marcar `F08-Core: concluida` em `docs/slices.yaml` e commitar com evidência de CI

---

## Dependências e Ordem de Execução

### Dependências por Fase

- **Setup (Phase 1)**: Sem dependências — começar imediatamente
- **Fundacional (Phase 2)**: Depende de Phase 1 — BLOQUEIA todas as US
- **US1 (Phase 3)**: Depende de Phase 2 — pode começar após T005 (migrações) + T006 (tipos)
- **US2 (Phase 4)**: Depende de Phase 2 + US1 (utilization.ts criado em T006/T008) — pode ser paralela a US3/US4/US5
- **US3 (Phase 5)**: Depende de Phase 2 — pode ser paralela a US2/US4/US5
- **US4 (Phase 6)**: Depende de Phase 2 — pode ser paralela a US2/US3/US5
- **US5 (Phase 7)**: Depende de US1 (T008, T009 — utilization.ts) — pode ser paralela a US2/US3/US4
- **US6 (Phase 8)**: Depende de Phase 2 — pode ser paralela a outras US
- **Polish (Phase 9)**: Depende de todas as US desejadas

### Dentro de Cada US

- Servidor antes de Web (ou em paralelo com [P])
- Tipos/modelos antes de serviços
- Serviços antes de rotas
- Rotas antes de testes E2E do quickstart

### Oportunidades Paralelas

- T006 e T007 (Phase 2) paralelos entre si
- US2 servidor (T013–T015) e US2 web (T016–T017) paralelos com [P]
- US3 servidor (T018–T020) e US3 web (T021–T024) paralelos internamente com [P]
- US4 servidor (T025–T027) e US4 web (T028–T031) paralelos internamente com [P]
- US3, US4 e US6 são independentes entre si após Phase 2

---

## Exemplo Paralelo — US1 (MVP)

```bash
# Após Phase 2 completa:
# Tarefa 1: implementar receiveUsageBatch (T008, T009)
# Tarefa 2 (paralela): adicionar validação de escopo utilizacao (T008 — em app-credentials.ts)
# Tarefa 3: criar rotas (T010) — após T009
# Tarefa 4: registrar módulo (T011) — após T010
# Tarefa 5: escrever testes (T012) — após T011
```

---

## Estratégia de Implementação

### MVP Mínimo (US1 + US2)

1. Completar Phase 1: Setup (DS 0.2.1)
2. Completar Phase 2: Fundacional (migrações — CRÍTICO)
3. Completar Phase 3: US1 (endpoint de utilização — SP-098)
4. Completar Phase 4: US2 (painel expandido — SC-038/039)
5. **PARAR e VALIDAR**: testar com produto de referência
6. Abrir PR e aguardar CI

### Entrega Incremental Completa

1. Setup + Fundacional → base pronta
2. US1 (P1) → contrato com produto de referência comprovado
3. US2 (P1) → painel operacional completo
4. US3, US4, US5 (P2) em paralelo → consulta e exportação de auditoria e utilização
5. US6 (P3) → limpeza de privacidade
6. Polish → verificação e fechamento da fatia

---

## Notas

- `[P]` = arquivos diferentes, sem dependências incompletas — podem rodar em paralelo
- `[Story]` mapeia cada tarefa à US de rastreabilidade
- Cada US é independentemente testável após implementação
- `npm run verify` deve passar verde a cada checkpoint
- Constituição V: deduplicação, isolamento e idempotência DEVEM ser testados com MySQL real
- Constituição I: testes negativos de isolamento obrigatórios (≥2 instâncias sintéticas — T-04)
