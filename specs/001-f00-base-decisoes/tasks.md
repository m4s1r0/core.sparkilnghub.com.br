---

description: "Tarefas da fatia F00 — Base e decisões do SparkCore"
---

# Tasks: F00 — Base e decisões do SparkCore

**Input**: Design documents from `specs/001-f00-base-decisoes/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios. A spec (US3, FR-017–FR-021) e a constituição (princípio V) exigem
testes contra MySQL real; para regras de alto risco (privilégios, guarda de ambiente, migrador,
artefato) o teste é escrito e **observado falhando** antes da implementação.

**Organization**: tarefas agrupadas por história de usuário; cada fase termina em um ponto
verificável de forma independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história da spec (US1…US7)
- Caminhos relativos à raiz do repositório `core/core.sparkilnghub.com.br`

## Path Conventions

Monólito modular em npm workspaces (plan.md → Project Structure): `server/`, `web/`,
`packages/contracts/`, `scripts/`, `docs/`, `contracts/`, `vendor/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: inicializar o repositório, toolchain e dependências fixadas

- [x] T000 Criar a branch local `001-f00-base-decisoes` a partir de `main` (constituição, fluxo de desenvolvimento) — feito em 2026-10-26, sem commit nem push
- [x] T001 Criar `package.json` raiz com `"private": true`, `"type": "module"`, `"engines": { "node": ">=24 <25" }`, `"workspaces": ["server", "web", "packages/*"]` e os scripts `typecheck` (`tsc -b`), `lint` (`eslint .`), `format` e `format:check` (Prettier), mais `.nvmrc` com `24`
- [x] T002 [P] Criar `.gitignore` (node_modules, dist, `.env`, `test-results`, `playwright-report`, `coverage`) e `.gitattributes` com `* text=auto eol=lf` e `*.sql text eol=lf` (checksum estável entre Windows e Linux — plan.md, Riscos)
- [x] T003 [P] Criar `tsconfig.base.json` (TypeScript 5.9, `strict`, `module`/`moduleResolution` `NodeNext`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) e `tsconfig.json` com project references para `server`, `web`, `packages/contracts`
- [x] T004 [P] Criar `eslint.config.js` (ESLint 9 flat config + typescript-eslint `recommendedTypeChecked`, `no-floating-promises`, proibição de `console` fora de `scripts/`) e `.prettierrc.json` + `.prettierignore`
- [x] T005 [P] Criar `packages/contracts/package.json` (`@sparkcore/contracts`) e `packages/contracts/tsconfig.json`, com dependência de TypeBox
- [x] T006 [P] Criar `server/package.json` (`@sparkcore/server`; dependências Fastify 5, `@fastify/static`, TypeBox, `@fastify/type-provider-typebox`, `mysql2`, `kysely`, `pino`, `uuid` v7, `"@sparkcore/contracts": "*"`; dev: `tsx`, `vitest`, `ajv`, `ajv-formats`, `yaml`) e `server/tsconfig.json`; scripts `dev:app`, `dev:worker`, `build`, `start:app`, `start:worker`
- [x] T007 Copiar o pacote já gerado `../../UX/design-system/sparkling-hub-design-system-0.2.0.tgz` (produzido pelo `npm pack` do design system; não regenerar nem editar) **sem alteração** para `vendor/design-system/sparkling-hub-design-system-0.2.0.tgz`; registrar sha256 do arquivo em `vendor/design-system/README.md` com origem, versão e data
- [x] T008 Criar `web/package.json` (`@sparkcore/web`; React 19, React DOM 19, React Router 7, TanStack Query 5, `"@sparkcore/contracts": "*"`, `"@sparkling-hub/design-system": "file:../vendor/design-system/sparkling-hub-design-system-0.2.0.tgz"`; dev: Vite 7, `@vitejs/plugin-react`, Tailwind CSS v4, `@tailwindcss/vite`, Vitest 5, Testing Library, jsdom, `@playwright/test`, `@axe-core/playwright`) e `web/tsconfig.json` (depende de T007)
- [x] T009 Executar `npm install` na raiz e versionar `package-lock.json`, com versões exatas resolvidas (research.md: versões fixadas no lockfile) (depende de T001, T005, T006, T008)
- [x] T090 Criar `vitest.config.ts` na raiz com `test.projects`: o padrão `"*/vitest.config.ts"` (descobre `server/vitest.config.ts` — projetos `unit`, `integration`, `contract`, criado em T019 — e `web/vitest.config.ts` — projeto `component`, criado em T061 — à medida que existirem) e o projeto inline `scripts` (`environment: "node"`, `include: ["scripts/tests/**/*.test.ts"]`); registrar no `package.json` raiz `test:scripts` (`vitest run --project scripts`) — depende de T009; pré-requisito de T030, T031, T052 e T060
- [x] T010 [P] Copiar sem alteração os escopos 1.0 de `../../docs/escopos/` (`README.md`, `00`…`03`) para `docs/escopos/` e criar `docs/escopos/ORIGEM.md` com data da cópia, versão 1.0 e sha256 de cada arquivo (FR-004)
- [x] T011 [P] Criar `docs/CONTRIBUTING.md`: branch por funcionalidade `NNN-slug` a partir de `main`, PR com revisão obrigatória, fluxo Spec Kit, referência a IDs estáveis em commits/PRs, regra de atualização do design system (FR-005, princípio VIII)
- [x] T012 [P] Criar `.env.example` com todas as variáveis do esquema de configuração (T014), valores de desenvolvimento não secretos e senhas como `__defina__`; nenhum segredo real (FR-010)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: configuração, banco, migrador, servidor HTTP mínimo e harness de testes — exigidos
por todas as histórias

**⚠️ CRITICAL**: nenhuma história começa antes do fim desta fase

### Banco local e credenciais

- [x] T013 Criar `compose.yaml` com serviço `mysql` (imagem `mysql:8.4`, porta `3307:3306`, volume nomeado `sparkcore-mysql`, `--character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci --default-time-zone=+00:00`, `partial_revokes` desativado, healthcheck `mysqladmin ping`) e `docker/mysql/init/01-databases-and-users.sh` que cria `spark_core` e `spark_identity` e os usuários de research.md R-06: `spark_core_migrator` (DDL/DML em `spark_core` e `spark_identity`), `spark_core_web` (`SELECT/INSERT/UPDATE/DELETE` em `spark_core` e `spark_identity`; sem DDL), `spark_core_worker` (DML em `spark_core`; sem DDL), `spark_provisioner` (`CREATE USER`; todos os privilégios com `GRANT OPTION` apenas em `` `sparkref\_%` `` e `` `sparkpet\_%` ``), senhas lidas das variáveis do `.env`

### Configuração, logs e banco no servidor

- [x] T014 Implementar `server/src/platform/config/schema.ts` e `server/src/platform/config/load.ts`: esquema TypeBox de todas as variáveis (`SPARK_ENV` ∈ `development|homologation|production`, host/porta MySQL, uma senha por usuário MySQL, `HTTP_PORT`, `APP_VERSION`), validação na inicialização que lista **todas** as variáveis ausentes/invalidas e encerra com código ≠0, sem valor padrão para segredos (FR-010, Edge Case "configuração ausente")
- [x] T015 [P] Implementar `server/src/platform/logging/logger.ts` (pino JSON, campo fixo `product: "sparkcore"`, redação de `authorization`, `cookie`, `password`, `secret`, `token`, `dsn` em qualquer profundidade; serializer de erro que, para erros do `mysql2`, remove `sql`, `sqlMessage` e `parameters`, registrando apenas `code`, `errno`, `sqlState` e o texto do comando sem valores) (FR-015, FR-016, research.md R-10)
- [x] T016 [P] Implementar `server/src/platform/db/pools.ts`: fábrica de pool `mysql2` + Kysely **por par (banco, credencial)**, com limite por pool e teto global configuráveis, `timezone: 'Z'`, sem `multipleStatements` nos pools web/worker; proibir `USE` em conexão compartilhada (princípio I)
- [x] T017 [P] Implementar `server/src/platform/ids.ts`: geração de UUID v7, conversão texto ⇄ `BINARY(16)`, e `instanceDatabaseName(prefix, uuid)` que valida o UUID e retorna `prefix + 32hex` (research.md R-11)
- [x] T018 [P] Implementar `server/src/platform/config/env-guard.ts`: `assertEnvironment(allowed: Env[], command)` que compara `SPARK_ENV` com `spark_core.environment_marker.environment` e recusa (código de saída 2) se não permitido ou divergente, gravando log `event: "env_guard_refused"` com comando, `SPARK_ENV` e marcador encontrado (contracts/commands.md, FR-011, FR-028)

### Migrador (alto risco — testes primeiro)

- [x] T019 Criar harness de integração `server/tests/support/mysql.ts`: antes de criar ou remover qualquer banco, chama `assertEnvironment(['development'], 'test-harness')` (T018) e aborta se recusado; conecta com `spark_core_migrator`/`spark_provisioner`, cria bancos temporários `t_<runid>_*` e, no teardown, remove **somente** bancos com prefixo `t_<runid>_`; e `server/vitest.config.ts` com projetos `unit`, `integration`, `contract`
- [x] T020 [P] Escrever testes de unidade (devem falhar) em `server/tests/unit/migrations/manifest.test.ts`: manifesto com versões não contíguas, sha256 divergente do arquivo normalizado (LF, UTF-8 sem BOM), arquivo ausente e `formatVersion` ≠ 1 são recusados com códigos estáveis
- [x] T021 [P] Escrever testes de integração (devem falhar) em `server/tests/integration/migrations/migrator.test.ts`: aplica do zero; reaplicação não faz nada; histórico com versão ausente do manifesto → recusa `SCHEMA_UNKNOWN_VERSION`; checksum registrado divergente → recusa `SCHEMA_CHECKSUM_MISMATCH`; versão com `status = falha` bloqueia novas versões `SCHEMA_FAILED`; falha no meio de um arquivo grava `falha`; com `SPARK_ENV=production` o harness recusa antes de qualquer `CREATE`/`DROP` (saída 2, log `env_guard_refused`)
- [x] T022 Implementar `server/src/platform/migrations/manifest.ts` (leitura e validação do `manifest.json` conforme contracts/migration-artifact.md) e `server/src/platform/migrations/migrator.ts`: cria `_spark_schema_history` (`version INT UNSIGNED PK` sequencial a partir de 1 sem lacunas; `name VARCHAR(120)` igual ao manifesto; `checksum CHAR(64)` sha256 hex do arquivo SQL normalizado (LF, sem BOM); `artifact VARCHAR(64)`; `status ENUM('aplicada','falha')`; `started_at`/`finished_at DATETIME(6)` UTC; `applied_by VARCHAR(64)` usuário MySQL e id do processo), aplica um arquivo por vez e grava o histórico após sucesso (research.md R-04) — até T020/T021 passarem
- [x] T023 Criar `server/migrations/spark_core/manifest.json` + `0001_environment_marker.sql` (`environment_marker`: `id TINYINT PK` sempre 1; `environment ENUM('development','homologation','production')` imutável; `synthetic_data BOOLEAN` true somente em development/homologation; `created_at DATETIME(6)`) + `0002_worker_heartbeat.sql` (`worker_heartbeat`: `worker_id BINARY(16) PK`; `hostname VARCHAR(255)`; `app_version VARCHAR(40)`; `started_at`/`last_seen_at DATETIME(6)`); e `server/migrations/spark_identity/manifest.json` + `0001_baseline.sql` (baseline vazio)
- [x] T024 Implementar `server/src/cli/db-migrate.ts` (comando `npm run db:migrate`): aplica `spark_core` e `spark_identity` com `spark_core_migrator`; na primeira aplicação insere `environment_marker` com `SPARK_ENV` e `synthetic_data` coerente; saída ≠0 com versão e motivo em falha

### Servidor HTTP mínimo e contratos compartilhados

- [x] T025 [P] Criar `packages/contracts/src/error.ts` e `packages/contracts/src/system-status.ts` com esquemas TypeBox idênticos a `ErrorEnvelope`, `HealthState` (`SAUDAVEL|DEGRADADA|INDISPONIVEL|DESCONHECIDA`), `ComponentStatus` e `SystemStatus` de contracts/openapi.yaml, exportados em `packages/contracts/src/index.ts`
- [x] T026 Implementar `server/src/app/plugins/correlation.ts`: reutiliza `X-Correlation-Id` se for UUID válido, senão gera UUID v7; devolve o cabeçalho em toda resposta (inclusive erro) e injeta `correlationId` no logger da requisição (contracts/conventions.md §3)
- [x] T027 Implementar `server/src/app/plugins/errors.ts`: converte qualquer erro no envelope de contracts/conventions.md §4 (`code` UPPER_SNAKE_CASE, `message` pt-BR segura, `field`, `retryable`, `correlationId`), mapeia validação → `422`, JSON malformado → `400`, inesperado → `500` com mensagem genérica; nunca inclui SQL, stack trace, caminho de arquivo ou credencial (FR-016); cabeçalhos `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- [x] T028 Implementar `server/src/app/build-app.ts` (Fastify 5 + type provider TypeBox, logger de T015, plugins T026/T027, rejeição de campos desconhecidos) e `server/src/app/main.ts` (carrega config T014, escuta `HTTP_PORT`, encerramento gracioso)
- [x] T029 Publicar os contratos na raiz: copiar `specs/001-f00-base-decisoes/contracts/{conventions.md,capabilities.md,openapi.yaml,migration-artifact.md}` para `contracts/` e criar `contracts/CHANGELOG.md` com a entrada `v1 — 2026-10-26`; a partir daqui `contracts/` é a fonte publicada

**Checkpoint**: config, logs, pools, migrador testado, migrações do Core e servidor mínimo prontos

---

## Phase 3: User Story 1 — Decisões estruturais registradas (Priority: P1) 🎯 MVP

**Goal**: D-01..D-05 registradas com estado validado e portão que bloqueia F01/F02 sem D-04

**Independent Test**: `npm run gate -- F01` sai com 3 listando `D-04`; uma ADR `confirmada` sem
`owner` faz `npm run check:adr` falhar

### Tests for User Story 1 ⚠️

- [x] T030 [P] [US1] Escrever testes (devem falhar) em `scripts/tests/check-adr.test.ts` com ADRs de fixture em `scripts/tests/fixtures/adr/`: frontmatter sem campo obrigatório; `status` fora de `proposta|confirmada|substituída`; `confirmada` sem `date` ou `owner`; `substituída` sem `superseded_by` ou sem `impacts`; presença do campo `blocks` (removido — fonte única é `docs/slices.yaml`); seção obrigatória ausente (Contexto, Decisão, Alternativas rejeitadas, Consequências); transição inválida em relação à versão de `main`
- [x] T031 [P] [US1] Escrever testes (devem falhar) em `scripts/tests/gate.test.ts`: fatia com `status` `pronta`/`em-implementacao`/`concluida` cujo `requires` contém decisão não confirmada → saída 3 com lista das decisões; fatia `especificando` → saída 0

### Implementation for User Story 1

- [x] T032 [P] [US1] Criar `docs/adr/TEMPLATE.md` com o frontmatter de data-model.md (`id`, `title`, `status`, `date`, `owner`, `supersedes`, `superseded_by`, `requirements`, `impacts`) e as quatro seções obrigatórias
- [x] T033 [P] [US1] Criar `docs/adr/0001-dois-monolitos.md` (`D-01`, `status: confirmada`, `date: 2026-10-26`, `owner: responsável técnico Sparkling Hub`, `requirements: [COM-004]`), conteúdo das diretrizes §2.2/§3 e motivo
- [x] T034 [P] [US1] Criar `docs/adr/0002-identidade-central.md` (`D-02`, confirmada em 2026-10-26, `requirements: [COM-006, COM-007, COM-008]`)
- [x] T035 [P] [US1] Criar `docs/adr/0003-instancia-um-estabelecimento.md` (`D-03`, confirmada em 2026-10-26, `requirements: [SC-014, SC-015]`)
- [x] T036 [P] [US1] Criar `docs/adr/0004-autorizacao-sincrona.md` (`D-04`, `status: proposta`, `requirements: [COM-018, SC-027, SC-028, T-03, T-15]`), com as alternativas a avaliar: autorização síncrona sem cache (referência) × validação local com mecanismo de revogação, e consequências de cada uma (spec, Clarifications)
- [x] T037 [P] [US1] Criar `docs/adr/0005-stack-servidor-dados-migracoes.md` (`D-05`, `status: proposta`, `requirements: [COM-002, COM-003, NFR-011]`) resumindo research.md R-01 a R-05 e R-08 com versões do lockfile (T009)
- [x] T038 [US1] Criar `docs/slices.yaml` com `F00` (`em-implementacao`, `requires: []`), `F01` (`especificando`, `requires: [D-01, D-02, D-04, D-05]`), `F02` (`especificando`, `requires: [D-01, D-02, D-03, D-04, D-05]`), `F03` (`especificando`, `requires: [D-01]`), `F08-Core` (`especificando`, `requires: [D-01, D-02]`)
- [x] T039 [US1] Implementar `scripts/check-adr.ts` (comando `npm run check:adr`): valida todas as ADRs de `docs/adr/` segundo data-model.md e compara transições com `git show origin/main:docs/adr/...` quando disponível — até T030 passar
- [x] T040 [US1] Implementar `scripts/gate.ts` (comando `npm run gate -- <fatia>`): lê `docs/slices.yaml` e ADRs; saída 0 se liberada, 3 se bloqueada listando decisões; e verificação global que falha se qualquer fatia com `status` ≥ `pronta` tiver decisão pendente — até T031 passar

**Checkpoint**: US1 verificável sozinha — ADRs e portão funcionam sem servidor nem banco

---

## Phase 4: User Story 2 — Ambiente local reproduzível (Priority: P1)

**Goal**: um comando sobe MySQL, servidor, trabalhador e interface; saúde por componente;
privilégios separados; reinicialização protegida

**Independent Test**: quickstart.md seções 1–4

### Tests for User Story 2 ⚠️

- [x] T041 [P] [US2] Escrever teste de integração (deve falhar) em `server/tests/integration/privileges.test.ts`: `spark_core_web` e `spark_core_worker` recebem erro de privilégio em `CREATE DATABASE` e `ALTER TABLE`; `spark_provisioner` cria `sparkref_<32hex>` mas é recusado em `CREATE DATABASE x_qualquer` e em qualquer DDL em `spark_identity`; usuário `inst_*` criado pelo provisionador acessa só o próprio banco e não cria tabelas em outro banco de instância; o usuário `inst_*` recebe erro de privilégio em `CREATE TABLE`, `ALTER TABLE` e `DROP TABLE` no **próprio** banco (duas instâncias sintéticas — princípio I)
- [x] T042 [P] [US2] Escrever testes de unidade (devem falhar) em `server/tests/unit/system/derive-status.test.ts` com as regras de data-model.md: trabalhador `SAUDAVEL` se algum `last_seen_at` ≤ 30 s; `DEGRADADA` entre 30 s e 120 s; `INDISPONIVEL` acima de 120 s ou sem linhas (`WORKER_STALE`/`WORKER_ABSENT`); `DESCONHECIDA` se o banco não responder; bancos conforme "Derivação dos bancos" (`DB_UNREACHABLE`, `SCHEMA_FAILED`/`SCHEMA_CHECKSUM_MISMATCH`/`SCHEMA_UNKNOWN_VERSION` → `INDISPONIVEL`; `SCHEMA_BEHIND` → `DEGRADADA`); estado geral conforme data-model.md: essenciais `server`, `spark_core`, `spark_identity`; algum essencial `INDISPONIVEL`/`DESCONHECIDA` → `INDISPONIVEL`; essencial `DEGRADADA` ou trabalhador ≠ `SAUDAVEL` (inclusive `INDISPONIVEL`) → `DEGRADADA`; senão `SAUDAVEL`
- [x] T043 [P] [US2] Escrever testes de integração (devem falhar) em `server/tests/integration/system-status.test.ts`: com MySQL saudável → `200` e quatro componentes; com pool apontando para porta fechada → `503`, `Retry-After`, `reason: "DB_UNREACHABLE"`, corpo sem SQL/usuário/stack trace; `/health/live` → `200 {"status":"ok"}` mesmo com banco indisponível

### Implementation for User Story 2

- [x] T044 [US2] Implementar `server/src/worker/main.ts`: carrega config, gera `worker_id` UUID v7, insere/atualiza `worker_heartbeat` a cada 10 s com `spark_core_worker` e remove linhas com mais de 24 h; encerramento gracioso (FR-009)
- [x] T045 [US2] Implementar `server/src/modules/system/derive-status.ts` (regras de T042) e `server/src/modules/system/probe.ts` (consulta `_spark_schema_history` de `spark_core`/`spark_identity` e `worker_heartbeat` com timeout de 2 s por banco; versão esperada lida dos manifestos embutidos no artefato) — até T042 passar
- [x] T046 [US2] Implementar `server/src/modules/system/routes.ts`: `GET /health/live` e `GET /api/v1/system/status` conforme contracts/openapi.yaml (`200` para `SAUDAVEL`/`DEGRADADA`, `503` + `Retry-After: 10` para `INDISPONIVEL`), registrando em `server/src/app/build-app.ts` — até T043 passar
- [x] T047 [US2] Implementar `scripts/dev-up.ts` (`npm run dev:up`): exige `SPARK_ENV=development`; verifica portas 3000/5173/3307 livres e indica a variável para alterá-las; `docker compose up -d mysql` e espera saúde; verifica versão `8.4.x` do servidor MySQL e recusa outra versão; executa `db:migrate` e `db:seed`; inicia `dev:app`, `dev:worker` e `web dev` em paralelo; termina com "SparkCore saudável" e as URLs após `/api/v1/system/status` responder `SAUDAVEL` (Edge Cases de versão e porta)
- [x] T048 [P] [US2] Implementar `scripts/dev-down.ts` (`npm run dev:down`): encerra processos e `docker compose stop`, preservando o volume
- [x] T049 [US2] Implementar `scripts/dev-reset.ts` (`npm run dev:reset`): chama `assertEnvironment(['development'])` (T018); recusa se `environment_marker` ≠ development; remove e recria `spark_core`/`spark_identity` e bancos `sparkref_*` marcados `synthetic = true`; migra e semeia; se uma execução anterior ficou com `status = falha`, recria do zero (Edge Case "migração interrompida")
- [x] T050 [US2] Implementar `server/src/cli/db-seed.ts` (`npm run db:seed`) inicial: `assertEnvironment(['development','homologation'])`, garante `environment_marker` e informa quantidade inserida (0 na repetição); ampliado em US7
- [x] T051 [US2] Registrar na raiz `package.json` os scripts `dev:up`, `dev:down`, `dev:reset`, `db:migrate`, `db:seed`, `test:unit` (`vitest run --project unit`), `test:integration` (`vitest run --project integration`) e os comandos de CLI executados com `tsx`, conforme contracts/commands.md

**Checkpoint**: quickstart §1–4 executável; US2 verificável sem interface (via HTTP)

---

## Phase 5: User Story 3 — Verificação automática obrigatória (Priority: P2)

**Goal**: CI com todas as etapas, bloqueio em falha, mesma verificação local

**Independent Test**: PRs de teste com falha deliberada falham na etapa correta (quickstart §7)

### Tests for User Story 3 ⚠️

- [x] T052 [P] [US3] Escrever testes (devem falhar) em `scripts/tests/check-migrations.test.ts`: arquivo de migração existente em `origin/main` com conteúdo alterado ou removido → falha indicando arquivo; nova versão adicionada → passa; renormalização só de final de linha não altera checksum; fixture em `server/src` contendo `DROP DATABASE` → falha indicando arquivo e linha; o mesmo texto em `scripts/` ou `server/tests/` → passa; `server/src/platform/migrations/artifact-validator.ts` contendo `DROP DATABASE` na lista de construções proibidas → passa (único arquivo liberado); qualquer outro arquivo de `server/src` com o mesmo texto → falha

### Implementation for User Story 3

- [x] T053 [US3] Implementar `scripts/check-migrations.ts` (`npm run check:migrations`): (1) compara `server/migrations/**` e `server/reference-product/**` com `origin/main` e com os checksums dos manifestos (FR-019); (2) falha se encontrar `DROP DATABASE` (sem distinção de maiúsculas) em `server/src/**`, exceto no único arquivo liberado `server/src/platform/migrations/artifact-validator.ts`, onde o texto é a lista do que o validador recusa e não é executado; a liberação fica declarada no próprio script, com comentário citando a constituição IV (v1.1.1) — até T052 passar
- [x] T088 [P] [US3] Escrever teste de integração (deve falhar) em `server/tests/integration/migrations/upgrade-path.test.ts`: banco A recebe as migrações de uma revisão base e depois as atuais; banco B recebe as atuais do zero; `information_schema.TABLES`, `COLUMNS` e `STATISTICS` idênticos para `spark_core` e `spark_identity`; base sem migrações (primeira versão) → passa trivialmente; migração que gera estrutura diferente → falha indicando a tabela (FR-017, CS-005, constituição V)
- [x] T089 [US3] Implementar `scripts/check-migration-upgrade.ts` (`npm run check:upgrade`): extrai `server/migrations/**` de `origin/main` com `git archive` para pasta temporária; usando o harness (T019, com guarda) aplica-as em bancos `t_<runid>_upgrade_*` via migrador (T022), depois aplica as migrações atuais e compara com a migração do zero; remove só bancos `t_<runid>_*`; se `origin/main` não tiver migrações, registra "sem versão anterior" e sai 0 — até T088 passar
- [x] T054 [P] [US3] Criar `.gitleaks.toml` (regras padrão + permissões apenas para `.env.example` com `__defina__`) e `scripts/check-secrets.ts` (`npm run check:secrets`) que executa gitleaks via `docker run zricethezav/gitleaks` com versão fixada
- [x] T055 [US3] Implementar `scripts/verify.ts` (`npm run verify`): executa em sequência `typecheck`, `lint`, `format:check`, `test:scripts`, `check:adr`, `gate` global, `check:ds`, `check:secrets`, `check:migrations`, `ref:validate`, `test:unit`, `test:component`, `test:integration`, `check:upgrade`, `test:contract`, `test:e2e`; para na primeira falha com etapa e teste; não usa cobertura percentual como critério (FR-017, FR-018, FR-020, US3 cenário 6)
- [x] T056 [US3] Criar `.github/workflows/verify.yml` em `pull_request` e `push` para `main`, Node 24, cache npm, jobs paralelos: `static` (typecheck, lint, format, test:scripts, test:component, check:adr, gate, check:ds, check:migrations com `fetch-depth: 0`), `secrets` (gitleaks action com mesma configuração), `test` (`env: SPARK_ENV: development`, `fetch-depth: 0`, service `mysql:8.4` com init de `docker/mysql/init`, db:migrate, unit, integration, contract, check:upgrade, ref:validate), `e2e` (`env: SPARK_ENV: development`, build, servidor e trabalhador com MySQL service, Playwright Chromium); `timeout-minutes: 15` por job (CS-004)
- [x] T057 [US3] Documentar em `docs/CONTRIBUTING.md` a configuração manual da proteção de `main` exigindo os jobs `static`, `secrets`, `test` e `e2e` e revisão aprovada

**Checkpoint**: verificação local e remota equivalentes; integração bloqueada em falha

---

## Phase 6: User Story 4 — Interface base ligada ao design system (Priority: P2)

**Goal**: página `/` com marca, situação do sistema e matriz de estados, só com o design system

**Independent Test**: E2E em 360 px e 1280 px, só teclado, estados carregando/sucesso/503/erro

### Tests for User Story 4 ⚠️

- [x] T058 [P] [US4] Escrever testes de componente (devem falhar) em `web/tests/component/system-status-page.test.tsx` com respostas simuladas: carregando (`aria-busy="true"`, texto "Consultando situação…", nenhum número); sucesso 200 (rótulos "Saudável/Degradada/Indisponível/Desconhecida" em texto); 503 (aviso "Um ou mais componentes estão indisponíveis" + tabela); erro de rede/500 (mensagem segura, correlação, botão "Tentar novamente", sem dados anteriores como atuais); atualizando (botão em loading, dados anteriores marcados "atualizando") — contracts/ui-base-page.md
- [x] T059 [P] [US4] Escrever E2E (deve falhar) em `web/tests/e2e/system-status.spec.ts` (Playwright, projetos 360×800 e 1280×800, Chromium; Edge local opcional): ordem de tabulação cabeçalho → "Atualizar situação" → tabela; foco visível; sem rolagem horizontal (`scrollWidth <= clientWidth`); estados via interceptação de rede; varredura axe como sinal adicional
- [x] T060 [P] [US4] Escrever testes (devem falhar) em `scripts/tests/check-ds.test.ts`: fixture em `web/src` com definição de `--color-sh-*`, seletor `.sh-` com regras, classe Tailwind interpolada (`` `bg-${x}` ``) ou cópia de arquivo CSS do pacote → falha; import de `@sparkling-hub/design-system` pela raiz → passa; tgz em `vendor/design-system/` alterado sem entrada nova em `docs/design-system-updates.md` → falha

### Implementation for User Story 4

- [x] T061 [US4] Criar `web/vite.config.ts` (React, `@tailwindcss/vite`, proxy `/api` e `/health` → `http://127.0.0.1:3000`, porta 5173), `web/index.html` (lang `pt-BR`), `web/src/styles/app.css` (`@import "tailwindcss";` apenas para utilidades de layout do app, fontes de varredura restritas a `web/src`), `web/vitest.config.ts` (ambiente `jsdom`, `setupFiles: ["./tests/setup.ts"]`, inclui `tests/component/**`) e `web/tests/setup.ts` (importa `@testing-library/jest-dom/vitest`)
- [x] T062 [US4] Criar `web/src/main.tsx`: importa `@sparkling-hub/design-system/styles.css` **uma única vez**, depois `./styles/app.css`; renderiza dentro de `<div className="sh-theme">` com `QueryClientProvider` e `RouterProvider` (rota `/`)
- [x] T063 [P] [US4] Copiar sem alteração o SVG aprovado de `../../UX/assets/logomarca/final-v1/` para `web/public/brand/` e registrar origem e sha256 em `web/public/brand/ORIGEM.md`
- [x] T064 [P] [US4] Implementar `web/src/api/client.ts`: `fetch` com `X-Correlation-Id` gerado por requisição, leitura do envelope de erro de `@sparkcore/contracts`, distinção entre 503-com-`SystemStatus` e erro; e `web/src/api/system-status.ts` com hook TanStack Query (`retry: false`, `refetchOnWindowFocus: false`)
- [x] T065 [US4] Implementar `web/src/pages/system-status/SystemStatusPage.tsx` com `Navbar`, `Heading`, `Text`, `StatsBlock`, `DataTable` com coluna de `Badge`, `Skeleton`, `Alert`, `Button` do `@sparkling-hub/design-system`, regiões `role="status"`/`role="alert"`, conforme contracts/ui-base-page.md — até T058 passar
- [x] T066 [US4] Servir a interface construída pelo servidor em produção: registrar `@fastify/static` em `server/src/app/build-app.ts` para `web/dist` com fallback de SPA para rotas não `/api`/`/health`, CSP restrita a `'self'`
- [x] T067 [US4] Implementar `scripts/check-ds.ts` (`npm run check:ds`) e criar `docs/design-system-updates.md` com a primeira entrada (`0.2.0`, 2026-10-26, motivo, testes executados) — até T060 passar
- [x] T068 [US4] Adicionar `web/playwright.config.ts` (webServer: build da interface + `start:app` + `start:worker`, projetos 360/1280) e os scripts `test:e2e` e `test:component` em `package.json` raiz — até T059 passar

**Checkpoint**: página base funcional, acessível e verificada na CI

---

## Phase 7: User Story 5 — Convenções de contrato e catálogo (Priority: P2)

**Goal**: respostas reais validadas contra o contrato publicado; correlação e erros conforme
convenções

**Independent Test**: `npm run test:contract` passa; remover um campo da resposta de status
faz o teste falhar

### Tests for User Story 5 ⚠️

- [x] T069 [P] [US5] Escrever testes de contrato em `server/tests/contract/openapi.test.ts`: carrega `contracts/openapi.yaml` com `yaml`, compila esquemas com Ajv 2020 + `ajv-formats`, e valida respostas reais de `/health/live`, `/api/v1/system/status` (200 e 503) e de um erro 500 e 422 forçados contra os esquemas declarados
- [x] T070 [P] [US5] Escrever testes em `server/tests/contract/correlation.test.ts`: sem cabeçalho → UUID gerado e devolvido; UUID válido → reutilizado; valor inválido (`"abc\n injected"`) → substituído; mesmo `correlationId` no corpo de erro e na linha de log capturada
- [x] T071 [P] [US5] Escrever teste em `server/tests/contract/error-safety.test.ts`: rota de teste que lança erro com SQL e stack → resposta `500` com mensagem genérica e sem `SELECT`, `at `, caminho de arquivo ou senha; log contém stack trace e a mesma correlação, sem senha, token nem valores de parâmetros SQL

### Implementation for User Story 5

- [x] T072 [US5] Ajustar `server/src/app/plugins/errors.ts` e `correlation.ts` até T069–T071 passarem, sem mudar os contratos publicados; registrar script `test:contract` no `package.json` raiz
- [x] T073 [US5] Revisar `contracts/capabilities.md` marcando "Situação operacional do Core" como **Completa** e as demais como Reservadas com fatia e dependências, e `contracts/conventions.md` §5 com a política de não revelação (`404` idêntico para inexistente e de outra instância)

**Checkpoint**: contratos de F00 provados pela verificação automática

---

## Phase 8: User Story 6 — Produto de referência sintético (Priority: P3)

**Goal**: artefato `sparkref` v1/v2 no formato contratado, validado e aplicável

**Independent Test**: `npm run ref:validate` e `npm run test:integration -- reference-artifact`

### Tests for User Story 6 ⚠️

- [x] T074 [P] [US6] Escrever testes de unidade (devem falhar) em `server/tests/unit/migrations/artifact-validator.test.ts`: recusa `USE`, nome de banco qualificado, `CREATE DATABASE`, `CREATE USER`, `GRANT`, `DROP DATABASE`, `SET GLOBAL`, `LOAD DATA`, `INTO OUTFILE`; `productCode` fora de `^[a-z][a-z0-9]{2,15}$`; `databasePrefix` ≠ `productCode + "_"`
- [x] T075 [P] [US6] Escrever testes de integração (devem falhar) em `server/tests/integration/reference-artifact.test.ts`: banco A recebe v1 e depois v2, banco B recebe v1+v2 do zero — `information_schema.COLUMNS`, `STATISTICS` e `TABLES` idênticos; `_spark_instance` com `instance_uuid` igual ao sufixo do nome do banco, `product_code = 'sparkref'`, `owner_task_uuid` nulo, `synthetic = true`; checksum alterado e versão fora de sequência recusados com motivo

### Implementation for User Story 6

- [x] T076 [P] [US6] Criar `server/reference-product/manifest.json` (`formatVersion: 1`, `productCode: "sparkref"`, `databasePrefix: "sparkref_"`) com `migrations/0001_baseline.sql` (`_spark_instance`: `instance_uuid BINARY(16) PK`; `product_code VARCHAR(32)`; `owner_task_uuid BINARY(16) NULL`; `synthetic BOOLEAN`; `created_at DATETIME(6)` UTC) e `migrations/0002_ref_item.sql` (`ref_item`: `id`, `label`, `created_at`), sha256 calculados dos arquivos normalizados; nenhum conceito do Tuteli (FR-027)
- [x] T077 [US6] Implementar `server/src/platform/migrations/artifact-validator.ts` (construções proibidas e regras do manifesto) — até T074 passar
- [x] T078 [US6] Implementar `server/src/platform/migrations/apply-artifact.ts`: com `spark_provisioner`, cria o banco `instanceDatabaseName(prefix, uuid)` com `utf8mb4`/`utf8mb4_0900_ai_ci`, aplica as versões via migrador (T022), insere a linha de `_spark_instance` imediatamente após a v1 e cria o usuário `inst_<12hex>…` com DML apenas nesse banco — até T075 passar (base para o provisionador de F02, sem tarefas persistentes nesta fatia)
- [x] T079 [US6] Implementar `server/src/cli/ref-validate.ts` (`npm run ref:validate`) e registrar o script no `package.json` raiz

**Checkpoint**: artefato de referência pronto para o provisionador de F02

---

## Phase 9: User Story 7 — Dados sintéticos e proteção contra dados reais (Priority: P3)

**Goal**: sementes idempotentes, marcadas como fictícias e recusadas em produção

**Independent Test**: `db:seed` duas vezes sem duplicar; `SPARK_ENV=production` → saída 2

### Tests for User Story 7 ⚠️

- [x] T080 [P] [US7] Escrever testes de integração (devem falhar) em `server/tests/integration/seed.test.ts`: duas execuções → mesma contagem; instância de referência com UUID fixo de semente e `synthetic = true`; textos com prefixo `[SINTÉTICO]` e e-mails só em `example.test`; `SPARK_ENV=production` ou `environment_marker` = production → saída 2 e log `env_guard_refused`; `dev:reset` com `SPARK_ENV=homologation` → recusado

### Implementation for User Story 7

- [x] T081 [US7] Criar `server/seeds/f00.ts` com UUID fixo de semente declarado e a instância de referência sintética (`sparkref_<uuid>` via `apply-artifact`, T078), e ampliar `server/src/cli/db-seed.ts` para aplicá-la de forma idempotente — até T080 passar
- [x] T082 [US7] Documentar em `server/seeds/README.md` as regras de dados sintéticos (marcação, domínio `example.test`, proibição de cópia de produção para desenvolvimento/homologação — `NFR-016`) e como cada fatia amplia o conjunto

**Checkpoint**: todas as histórias funcionais e verificáveis isoladamente

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: documentação, desempenho e fechamento da fatia

- [x] T083 [P] Escrever `README.md` do repositório: propósito do SparkCore, pré-requisitos, `npm run dev:up`, comandos de contracts/commands.md, links para `docs/`, `contracts/` e constituição
- [x] T084 [P] Medir p95 de `/api/v1/system/status` com 200 requisições locais e registrar o resultado (meta ≤ 300 ms) em `specs/001-f00-base-decisoes/evidence.md`
- [ ] T085 Executar o roteiro completo de [quickstart.md](./quickstart.md) em Windows **e** em Linux (máquina limpa ou VM/contêiner com Docker), registrar tempos de cada um (CS-001), resultados por seção e limitações em `specs/001-f00-base-decisoes/evidence.md`
- [ ] T086 Abrir as cinco PRs de falha deliberada do quickstart §7 (teste, tipo, migração alterada, segredo fictício, campo removido do status), registrar a etapa que bloqueou cada uma e a duração do workflow em `specs/001-f00-base-decisoes/evidence.md`, e fechá-las sem integrar (CS-003, CS-004)
- [ ] T087 Após aprovação do plano pelo responsável técnico, atualizar `docs/adr/0005-stack-servidor-dados-migracoes.md` para `status: confirmada` com `date` e `owner`, e `docs/slices.yaml` com `F00: concluida` somente quando T083–T086 tiverem evidência (CS-002, DoD)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências; T009 depende de T001/T005/T006/T008; T008 de T007; T090 de T009
- **Foundational (Phase 2)**: depende do Setup — bloqueia todas as histórias
- **US1 (Phase 3)**: depende só do Setup (scripts e docs); pode começar em paralelo à Phase 2
- **US2 (Phase 4)**: depende da Phase 2
- **US3 (Phase 5)**: T052–T054 e T088 podem começar após a Phase 2; T055 (`verify`) e T056
  (CI) fecham depois de US1, US2, US4 (`check:ds`, `test:e2e`), US5 (`test:contract`) e US6
  (`ref:validate`)
- **US4 (Phase 6)**: depende de US2 (endpoint de status)
- **US5 (Phase 7)**: depende de US2 (endpoints reais)
- **US6 (Phase 8)**: depende da Phase 2 (migrador); independente de US2–US5
- **US7 (Phase 9)**: depende de US2 (T050) e US6 (T078)
- **Polish (Phase 10)**: depende de todas as histórias; T087 depende também da aprovação de D-05

### User Story Dependencies

```text
Setup ─┬─ US1 ────────────────┐
       └─ Foundational ─┬─ US2 ─┬─ US4 ──┐
                        │       ├─ US5 ──┤
                        │       └────────┼─ US3 ── Polish
                        └─ US6 ── US7 ───┘
```

### Within Each User Story

- Testes escritos e observados falhando antes da implementação correspondente
- Esquemas/migrações → serviços → rotas/comandos → integração
- Story completa e verificada no checkpoint antes da próxima prioridade

### Parallel Opportunities

- Setup: T002, T003, T004, T005, T006, T010, T011, T012
- Foundational: T015, T016, T017, T018 juntos; T020 e T021 juntos; T025 em paralelo ao migrador
- US1: T030–T031 e T032–T037 (arquivos distintos)
- US2: T041, T042, T043 juntos; T048 em paralelo
- US4: T058, T059, T060, T063, T064 juntos
- US5: T069, T070, T071 juntos
- US6 pode ser feita em paralelo a US2–US5 após a Phase 2

---

## Parallel Example: User Story 2

```text
Task: "Teste de privilégios em server/tests/integration/privileges.test.ts"
Task: "Teste de derivação de estado em server/tests/unit/system/derive-status.test.ts"
Task: "Teste de integração do status em server/tests/integration/system-status.test.ts"
```

## Parallel Example: User Story 1

```text
Task: "ADR D-01 em docs/adr/0001-dois-monolitos.md"
Task: "ADR D-02 em docs/adr/0002-identidade-central.md"
Task: "ADR D-03 em docs/adr/0003-instancia-um-estabelecimento.md"
Task: "ADR D-04 em docs/adr/0004-autorizacao-sincrona.md"
Task: "ADR D-05 em docs/adr/0005-stack-servidor-dados-migracoes.md"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 (Setup) e Phase 3 (US1) em paralelo à Phase 2 (Foundational)
2. Phase 4 (US2)
3. **STOP and VALIDATE**: quickstart §1–5 — decisões registradas, portão funcionando, ambiente
   local saudável com privilégios separados

### Incremental Delivery

1. MVP (US1 + US2) → ambiente e decisões utilizáveis pela equipe
2. US5 → contratos provados; US4 → página base; US3 → CI obrigatória
3. US6 → artefato de referência; US7 → sementes completas
4. Polish → evidências e fechamento da fatia (DoD)

### Observação de governança

F00 não implementa identidade nem provisionamento. `D-04` em `proposta` mantém F01/F02
bloqueadas para implementação pelo portão (T040); a especificação de F01 pode começar assim que
US1 estiver concluída.

---

## Notes

- [P] = arquivos diferentes, sem dependência de tarefa incompleta
- [USn] liga a tarefa à história para rastreabilidade; commits e PRs citam IDs (`FR-*`, `COM-*`, `NFR-*`)
- Commit por tarefa ou grupo lógico, em branch `001-f00-base-decisoes`
- Nenhuma tarefa toca o Tuteli, o site institucional ou o código-fonte do design system
