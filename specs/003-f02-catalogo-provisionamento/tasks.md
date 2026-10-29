---
description: "Tarefas da fatia F02 — Catálogo e provisionamento"
---

# Tasks: F02 — Catálogo e provisionamento

**Input**: Design documents from `specs/003-f02-catalogo-provisionamento/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios (constituição V). Regras de alto risco — transições de estado,
idempotência da solicitação, unicidade do slug, prova de propriedade, retomada, lease, privilégios
da credencial operacional, contrato de conexão — têm o teste escrito e **observado falhando** antes
da implementação. Integração sempre contra MySQL real.

**Organization**: por história de usuário; cada fase termina em ponto verificável isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história da spec (US1…US6)
- Caminhos relativos à raiz do repositório

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: configuração, chave nova e ativos

- [X] T001 Atualizar `docs/slices.yaml` com `F02: em-implementacao` e confirmar `npm run gate -- F02` = 0
- [X] T002 [P] Acrescentar ao esquema em `server/src/platform/config/schema.ts`, a `server/src/platform/config/load.ts` e ao `.env.example`: `INSTANCE_SECRET_KEY` (32 bytes base64, segredo, em `SecretNames`), `INSTANCE_SECRET_KEY_VERSION` (inteiro, padrão 1), `INSTANCE_DB_HOST` (padrão `MYSQL_HOST`), `INSTANCE_DB_PORT` (padrão `MYSQL_PORT`), `PROVISIONING_MAX_ATTEMPTS` (inteiro 1–20, padrão 5); expor `config.secrets.instanceKey`; cobrir em `server/tests/unit/config/load.test.ts` (chave ausente ou com tamanho errado → erro sem exibir o valor); gerar valor no `.env` local sem exibi-lo
- [X] T003 [P] Em `.github/workflows/verify.yml`, gerar `INSTANCE_SECRET_KEY` por execução nos jobs `test` e `e2e` (`echo "INSTANCE_SECRET_KEY=$(openssl rand -base64 32)" >> "$GITHUB_ENV"`, como a `IDENTITY_SECRET_KEY`) e passar a variável em `compose.yaml` para o serviço que executa servidor e trabalhador, se houver
- [X] T004 [P] Criar `server/assets/reserved-slugs.txt` (uma palavra por linha, minúsculas: `admin`, `administrador`, `api`, `app`, `assets`, `auth`, `core`, `convite`, `entrar`, `health`, `i`, `internal`, `login`, `logout`, `painel`, `recuperar`, `sparkcore`, `sparkpet`, `sparkref`, `static`, `suporte`, `www`) e acrescentar `reservedSlugsFile` em `server/src/platform/paths.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, renomeação da instância, serviço de transições, auditoria, projeção v2 e
contrato publicado — usados por todas as histórias

**⚠️ CRITICAL**: nenhuma história começa antes do fim desta fase

### Esquema

- [X] T005 Criar `server/migrations/spark_core/migrations/0004_catalogo_provisionamento.sql` conforme [data-model.md](./data-model.md): `contractor` (`legal_name VARCHAR(200)`, `display_name VARCHAR(120)`, `name_key VARCHAR(200)` indexado, `person_type ENUM('fisica','juridica')`, `document_type ENUM('cpf','cnpj') NULL`, `document_normalized VARCHAR(14) NULL`, `contact_name VARCHAR(120)`, `email VARCHAR(254)` não único, `phone VARCHAR(13) NULL`, `address JSON NULL`, `status ENUM('ativo','inativo')`, `version INT UNSIGNED`, `created_by`/`updated_by BINARY(16) NULL`, `created_at`/`updated_at`; `UNIQUE (document_type, document_normalized)`, `KEY (status, display_name)`); `product` (`code VARCHAR(16)` PK, `name VARCHAR(80)`, `description VARCHAR(280)`, `status ENUM('ativo','inativo')`, `reference_only BOOLEAN`, `version`, `created_at`, `updated_at`, `updated_by`); `RENAME TABLE instance_ref TO instance` e `ALTER` acrescentando `contractor_id BINARY(16)`, `timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo'`, `initial_admin_email VARCHAR(254)`, `state ENUM('CADASTRADA','PROVISIONANDO','FALHA_PROVISIONAMENTO','PRONTA','ATIVA','SUSPENSA','MANUTENCAO','ENCERRADA')`, `schema_version INT UNSIGNED NULL`, `notes TEXT NULL`, `valid_from`/`valid_until DATE NULL` com `CHECK (valid_until >= valid_from)`, `version INT UNSIGNED`, `created_by BINARY(16) NULL`, `updated_at`, `product_code` para `VARCHAR(16)`, índices `(contractor_id, state)`, `(state, created_at)`, `(product_code, state)`; `instance_resource` (`kind ENUM('banco_operacional','banco_acesso','usuario_mysql')`, `identifier VARCHAR(64)` ascii_bin UNIQUE, `status ENUM('pretendido','criado','verificado')`, `secret_enc VARBINARY(512) NULL`, `secret_key_version TINYINT UNSIGNED NULL`, `owner_task_id`; `UNIQUE (instance_id, kind)`); `instance_transition` (`from_state` NULL, `to_state`, `actor_kind ENUM('usuario','sistema')`, `actor_id` NULL, `reason VARCHAR(500)`, `task_id` NULL, `correlation_id`, `created_at`; índice `(instance_id, created_at)`); `admin_task` (`seq BIGINT UNSIGNED AUTO_INCREMENT UNIQUE`, `kind ENUM('provisionamento')`, `status ENUM('pendente','em_execucao','aguardando_repeticao','concluida','falhou')`, coluna gerada `active_instance_key` UNIQUE, `current_step VARCHAR(32) NULL`, `run_number`, `attempt`, `next_attempt_at`, `lease_until` NULL, `worker_id` NULL, `artifact_code`, `artifact_version`, `manifest_sha256 CHAR(64)`, `requested_by`, `idempotency_key CHAR(36)`, `request_hash CHAR(64)`, `UNIQUE (requested_by, idempotency_key)`, `error_code VARCHAR(64) NULL`, `error_message VARCHAR(300) NULL`, `created_at`, `started_at`, `finished_at`); `admin_task_step_run` (`step ENUM('validar','reservar','criar_bancos','criar_credencial','aplicar_migracoes','configurar','preparar_convite','verificar','concluir')`, `status ENUM('em_execucao','concluida','falhou','interrompida','ignorada')`, `run_number`, `attempt`, `worker_id`, `started_at`, `finished_at`, `duration_ms`, `error_code`, `error_message`; índice `(task_id, run_number, started_at)`); `core_audit_event` (`actor_kind`, `actor_id`, `action VARCHAR(48)`, `object_type`, `object_id`, `changes JSON`, `reason`, `correlation_id`, `created_at`); `app_credential.scopes` para `SET('sessions','members','connection')`; dados: produto `sparkpet` (ativo, `reference_only = FALSE`) sempre; quando existirem linhas `synthetic = TRUE` em `instance`, criar produto `sparkref` (`reference_only = TRUE`), o contratante `[SINTÉTICO] Contratante de referência`, associar as instâncias, `state = 'ATIVA'` e transição `NULL → ATIVA` de ator `sistema` com motivo `migracao_f01`; por fim `contractor_id NOT NULL` e as chaves estrangeiras `instance → contractor`, `instance → product`; atualizar `manifest.json` com sha256
- [X] T006 [P] Criar `server/migrations/spark_identity/migrations/0004_convite_emissao.sql`: `ALTER TABLE invitation ADD link_issued_at DATETIME(6) NULL` e `UPDATE invitation SET link_issued_at = created_at`; atualizar `manifest.json`
- [X] T007 [P] Criar `server/migrations/access_projection/migrations/0002_estado_pronta.sql` (`access_instance.state` → `ENUM('pronta','ativa','suspensa','manutencao')`) conforme [access-projection-v2.md](./contracts/access-projection-v2.md); atualizar `manifest.json`; acrescentar caso v1 → v2 em `server/tests/integration/migrations/upgrade-path.test.ts` e conferir `scripts/lib/upgrade.ts` (`check:upgrade` cobre spark_core 3→4, spark_identity 3→4, projeção 1→2)

### Instância completa, transições e auditoria

- [X] T008 Renomear `server/src/modules/instances/instance-ref.ts` para `server/src/modules/instances/instances.ts` usando a tabela `instance`, ampliando o tipo (`contractorId`, `state`, `timezone`, `initialAdminEmail`, `schemaVersion`, `notes`, `validFrom`, `validUntil`, `version`, `createdAt`); atualizar todos os importadores (`server/src/cli/access-reconcile.ts`, `server/src/modules/access-projection/*`, `server/src/modules/memberships/*`, `server/src/modules/internal-api/*`, `server/seeds/f01.ts`, testes) e confirmar a suíte de F01 inteira verde (CS-009)
- [X] T009 [P] Escrever teste (deve falhar) `server/tests/unit/audit/audit-insert-only.test.ts`, que falha se algum arquivo de `server/src` contiver `UPDATE core_audit_event` ou `DELETE FROM core_audit_event`, e implementar `server/src/modules/audit/audit.ts` (`recordAudit(trx, {actorKind, actorId, action, objectType, objectId, changes, reason, correlationId})`, só `INSERT`; `changes` passa por um filtro que recusa chaves `password`, `secret`, `token` e mascara documento como `***.***.***-12`)
- [X] T010 [P] Escrever testes de integração (devem falhar) `server/tests/integration/instances/transitions.test.ts`: transições permitidas em F02 (`CADASTRADA → PROVISIONANDO`, `PROVISIONANDO → PRONTA`, `PROVISIONANDO → FALHA_PROVISIONAMENTO`, `FALHA_PROVISIONAMENTO → PROVISIONANDO`) gravam `instance_transition` e mudam o estado na mesma transação; transição a partir de estado diferente do esperado → erro `CONFLICT_STATE` sem gravar nada; duas transições concorrentes do mesmo estado → exatamente uma vence; transição de sistema registra `actor_kind = 'sistema'` e a tarefa; `activateSyntheticInstance` recusa sem administrador ativo, com instância não sintética ou com marcador `production`
- [X] T011 Implementar `server/src/modules/instances/transitions.ts` (`transition(trx, instanceId, {from, to, actor, reason, taskId, correlationId})` com `SELECT … FOR UPDATE`, lista de transições permitidas de F02 e registro em auditoria `instancia.transicao`) e `activateSyntheticInstance(trx, instanceId)` só para sementes: transição `PRONTA → ATIVA` que exige `synthetic = TRUE`, marcador de ambiente diferente de `production` e ao menos um vínculo `administrador` ativo na instância (research R-18) — até T010 passar
- [X] T012 [P] Escrever teste (deve falhar) `server/tests/integration/access/instance-not-active.test.ts`: login de produto (`POST /internal/v1/instances/{slug}/sessions`) em instância `PRONTA` → negado como credenciais inválidas, sem gravar sessão; com `access_instance.state = 'pronta'` a consulta normativa do cliente de referência não valida nenhuma sessão; instâncias `ATIVA` seguem funcionando
- [X] T013 Exigir `instance.state = 'ATIVA'` antes de gravar sessão de produto em `server/src/modules/internal-api/sessions.ts` (e no caminho de `server/src/modules/identity/login.ts` usado pelo produto, se compartilhado) — até T012 passar
- [X] T014 [P] Implementar `server/src/cli/instances-migrate-access.ts` e o script `instances:migrate-access` em `package.json`: com a credencial `provisioner`, aplica a versão vigente de `server/migrations/access_projection` (histórico `_spark_access_history`) em todas as instâncias com `banco_acesso` criado (ou, para instâncias de F01 sem recursos registrados, pelo `access_database_name`), lista inacessíveis e sai com 4 se houver alguma; teste em `server/tests/integration/access/migrate-access.test.ts`; chamar o comando em `scripts/dev-up.ts`, `scripts/dev-reset.ts` e nos jobs de `.github/workflows/verify.yml` depois de `db:migrate`
- [X] T015 Atualizar `server/seeds/f01.ts` e `server/src/cli/db-seed.ts` para que, antes de registrar `ref-a`/`ref-b`, existam o produto `sparkref` (`reference_only = TRUE`) e o contratante sintético, e as instâncias sejam registradas em `PRONTA`, recebam os vínculos de administrador (ana em A, bruno em B) e só então fiquem `ATIVA` via `activateSyntheticInstance` (instâncias já `ATIVA` pela migração são mantidas); ajustar `server/tests/integration/seed.test.ts` (idempotência mantida)

### Contrato publicado e apoio de testes

- [X] T016 [P] Incorporar [openapi-f02.yaml](./contracts/openapi-f02.yaml) a `contracts/openapi.yaml` (versão 1.2.0, mudança compatível; `GET /api/v1/instances` passa a ter o esquema paginado), registrar em `contracts/CHANGELOG.md`, publicar a v2 em `contracts/access-projection.md` e acrescentar em `contracts/capabilities.md` a capacidade "Conexão da instância" (v1, F02, consumidor Tuteli) e "Criar convite inicial" como interna do provisionamento; rodar `npm run build:contracts`
- [X] T017 [P] Criar `server/tests/support/f02.ts`: fábricas de contratante e produto, `requestInstanceViaService`, `runProvisioning(ctx, taskId, {afterEffect?, clock?, workerId?})`, leitura de `admin_task_step_run`; ampliar `server/tests/support/mysql.ts` para rastrear e remover, só no teardown de teste, os bancos `sparkref_*`/`_acc` e usuários `inst_*` criados por provisionamentos de teste (prefixo e marcador sintético, como em F01)

**Checkpoint**: migrações aplicadas em banco vazio e a partir de `origin/main`; suíte de F01 verde
com a tabela `instance`; contrato 1.2.0 publicado

---

## Phase 3: User Story 1 - Cadastro e manutenção de contratantes (Priority: P1) 🎯 MVP

**Goal**: cadastrar, pesquisar, editar, inativar e reativar contratantes com documento validado,
alerta de homônimos e auditoria

**Independent Test**: dois contratantes (física e jurídica), tentativa com documento repetido e
outra com nome parecido, busca, edição concorrente e inativação recusada por instância `ATIVA`

### Tests for User Story 1 ⚠️

- [X] T018 [P] [US1] Escrever testes unitários (devem falhar) `server/tests/unit/contractors/document.test.ts`: CPF válido/inválido (DV, 11 dígitos, sequências repetidas recusadas); CNPJ numérico válido/inválido; CNPJ alfanumérico (12 posições `[0-9A-Z]` + 2 dígitos, DV módulo 11 com valor = código ASCII − 48) com os exemplos públicos da Receita Federal; normalização (sem pontuação, maiúsculas); tipo incompatível (CNPJ para pessoa física) recusado; e `name_key` (sem acentos, minúsculas, sem pontuação, sem sufixos `ltda`, `me`, `epp`, `eireli`, `sa`, `s/a`)
- [X] T019 [P] [US1] Escrever testes de integração (devem falhar) `server/tests/integration/contractors/contractors.test.ts`: criar com campos obrigatórios (`legal_name` 2–200, `display_name` 2–120, `contact_name`, `email`) e opcionais (`phone` só dígitos 10–13, `address` com `uf` entre as 27 siglas) → `ativo`, `version = 1`, auditoria `contratante.criado`; documento repetido → `409 CONFLICT_DOCUMENT_TAKEN` com o existente; e-mail repetido permitido; `similar` devolve até 10 por mesma `name_key`, contenção ou mesmo documento; busca paginada por nome, documento e contato com produtos e contagem de instâncias; edição com versão antiga → `409 CONFLICT_VERSION`; editar nome não altera UUID, bancos, slug nem transições das instâncias (`CA-SC-002`); inativar com instância `ATIVA` → `409 CONFLICT_CONTRACTOR_HAS_ACTIVE_INSTANCES` listando as instâncias, nada muda (`CA-SC-003`); inativar sem `ATIVA` → `inativo`; reativar com motivo; idempotência da criação (mesma chave → mesmo contratante)
- [X] T020 [P] [US1] Escrever teste de contrato `server/tests/contract/contractors-contract.test.ts`: respostas reais de `/api/v1/contractors*` validadas contra `contracts/openapi.yaml` 1.2.0 com `expectMatchesContract`; campo desconhecido → `422`

### Implementation for User Story 1

- [X] T021 [P] [US1] Implementar `server/src/modules/contractors/document.ts` (validação e normalização de CPF/CNPJ, inclusive alfanumérico) e `server/src/modules/contractors/name-key.ts` — até T018 passar
- [X] T022 [US1] Implementar `server/src/modules/contractors/contractors.ts` (criar, obter com instâncias, buscar paginado, `similar`, atualizar com versão otimista, inativar com `SELECT … FOR UPDATE` nas instâncias do contratante, reativar; auditoria em cada mudança) — até T019 passar
- [X] T023 [US1] Implementar `server/src/modules/contractors/routes.ts` (`GET/POST /api/v1/contractors`, `GET /api/v1/contractors/similar`, `GET/PUT /api/v1/contractors/:contractorId`, `POST …/inactivate`, `POST …/reactivate`) com sessão MFA, verificação de origem, TypeBox (`additionalProperties: false`) e `withIdempotency` na criação; registrar em `server/src/app/modules.ts` — até T020 passar
- [X] T024 [P] [US1] Implementar `web/src/api/contractors.ts` e as telas `web/src/pages/contractors/ContractorsPage.tsx`, `web/src/pages/contractors/ContractorFormPage.tsx` (alerta de homônimos com "Continuar mesmo assim", documento já usado com link, conflito de versão preservando o digitado, endereço em `Collapse`) e `web/src/pages/contractors/ContractorPage.tsx` (instâncias, inativar/reativar com motivo e lista das instâncias que impedem), conforme [ui-f02.md](./contracts/ui-f02.md); rotas `/contratantes`, `/contratantes/novo`, `/contratantes/:id`, `/contratantes/:id/editar` em `web/src/app/routes.tsx` e item de menu em `web/src/app/layouts.tsx`
- [X] T025 [P] [US1] Escrever testes de componente `web/tests/component/contractors.test.tsx`: estados vazio, carregando, erro, homônimos, documento inválido no campo, conflito de versão, inativação recusada
- [X] T026 [US1] Escrever E2E `web/tests/e2e/contractors.spec.ts`: criar pessoa jurídica com CNPJ, ver alerta de homônimo ao criar outra com nome parecido, buscar, editar, tentar inativar o contratante sintético (recusado com `ref-a` e `ref-b`); 360 e 1280 px; teclado; axe

**Checkpoint**: US1 funcional e verificável isoladamente (quickstart §1)

---

## Phase 4: User Story 2 - Catálogo de produtos (Priority: P1)

**Goal**: catálogo com produtos provisionáveis calculados a partir do código implantado, edição
de nome/descrição e inativação

**Independent Test**: `sparkpet` não provisionável, `sparkref` provisionável fora de produção,
artefato inválido, inativar/reativar, catálogo em produção sem `sparkref`

### Tests for User Story 2 ⚠️

- [X] T027 [P] [US2] Escrever testes de integração (devem falhar) `server/tests/integration/catalog/catalog.test.ts`: `sparkpet` → `provisionable = false`, motivo `SEM_PROVISIONADOR`; `sparkref` em `development` → provisionável com `deployedVersion` = maior versão do manifesto; artefato de teste com checksum divergente registrado num provisionador de teste → `ARTEFATO_INVALIDO` sem caminho nem SQL na mensagem; inativar → `PRODUTO_INATIVO`, instâncias existentes inalteradas (`SC-008`); reativar; `PUT` com versão antiga → `409`; `PUT` com `code` ou `provisioner` → `422`; auditoria de edição, inativação e reativação
- [X] T028 [P] [US2] Escrever teste (deve falhar) `server/tests/integration/catalog/catalog-production.test.ts`: com `SPARK_ENV=production` (contexto de teste), `GET /api/v1/products` não inclui `sparkref`, `GET /api/v1/products/sparkref` → `404` e o registro de provisionadores recusa `sparkref` (`AMBIENTE_NAO_PERMITIDO`)
- [X] T029 [P] [US2] Escrever teste de contrato `server/tests/contract/catalog-contract.test.ts` para `/api/v1/products*`

### Implementation for User Story 2

- [X] T030 [US2] Implementar `server/src/modules/catalog/provisioners.ts` (registro em código: `sparkref` → `referenceProductDir`, ambientes `development` e `homologation`; função `resolveProvisioner(code, env)` que carrega o manifesto, chama `validateArtifact` e devolve versão e `manifest_sha256` ou o motivo) e `server/src/modules/catalog/catalog.ts` (listar com campos calculados, obter, atualizar `name` 2–80 e `description` até 280 com versão, inativar, reativar, auditoria) — até T027 e T028 passarem
- [X] T031 [US2] Implementar `server/src/modules/catalog/routes.ts` (`GET /api/v1/products`, `GET/PUT /api/v1/products/:code`, `POST …/inactivate`, `POST …/reactivate`) e registrar em `server/src/app/modules.ts` — até T029 passar
- [X] T032 [P] [US2] Implementar `web/src/api/products.ts`, `web/src/pages/products/ProductsPage.tsx` (tabela com situação, versão, provisionável ou motivo em `Tooltip`) e `web/src/pages/products/ProductPage.tsx` (`SettingsBlock` com nome e descrição; versões e provisionador somente leitura; inativar/reativar com motivo e aviso de que instâncias não mudam); rotas `/produtos` e `/produtos/:code` e item de menu; testes de componente em `web/tests/component/products.test.tsx` (nenhum campo de SQL, script, URL ou código)

**Checkpoint**: US2 funcional (quickstart §2)

---

## Phase 5: User Story 3 - Solicitar e provisionar uma instância até PRONTA (Priority: P1)

**Goal**: solicitação idempotente com MFA, tarefa persistente executada pelo trabalhador e
instância `PRONTA` com bancos, credencial restrita, migrações, marcador, convite preparado e
contrato de conexão

**Independent Test**: provisionar A e B do produto de referência para contratantes distintos,
repetir a solicitação, disputar o mesmo slug e conferir isolamento e privilégios

### Tests for User Story 3 ⚠️

- [X] T033 [P] [US3] Escrever testes unitários (devem falhar) `server/tests/unit/instances/slug.test.ts` e `server/tests/unit/instances/timezones.test.ts`: normalização (NFD sem diacríticos, minúsculas, espaço e `_` → `-`, hífens colapsados e aparados), regex `^[a-z][a-z0-9-]{1,61}[a-z0-9]$`, palavras de `reserved-slugs.txt` recusadas, `"Loja Centro!"` → `loja-centro`; fusos suportados = zonas `America/*` do Brasil via `Intl.supportedValuesOf('timeZone')`, padrão `America/Sao_Paulo`
- [X] T034 [P] [US3] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/request.test.ts`: `POST /api/v1/instances` sem TOTP recente → `403 AUTH_REAUTH_REQUIRED`; contratante inativo → `409 CONFLICT_CONTRACTOR_INACTIVE`; produto não provisionável → `409 CONFLICT_PRODUCT_NOT_PROVISIONABLE` com motivo; slug reservado ou inválido, fuso fora da lista, vigência invertida → `422`; sucesso → `201` com instância `CADASTRADA`, `database_name` = prefixo + UUID sem hífens, `access_database_name` = `<database_name>_acc`, tarefa `pendente` com protocolo `PRV-` + 6 dígitos, artefato e `manifest_sha256` fixados, transição `NULL → CADASTRADA`, auditoria `instancia.solicitada`, `admin_task_step_run` com `validar` e `reservar` concluídas na execução 1, tudo numa transação; `POST /api/v1/instances/preview` normaliza o slug e informa disponibilidade sem reservar
- [X] T035 [P] [US3] Escrever teste de integração (deve falhar) `server/tests/integration/provisioning/idempotency.test.ts` (CS-003, `T-01`, `CA-SC-005`): 100 rodadas com mesma chave e mesmo corpo em paralelo → uma instância, uma tarefa e o mesmo protocolo em todas as respostas; mesma chave e corpo diferente → `409 CONFLICT_IDEMPOTENCY_MISMATCH`; chaves diferentes para o mesmo `(produto, slug)` em paralelo → uma `201` e as demais `409 CONFLICT_SLUG_TAKEN`; depois do provisionamento, um único banco operacional, um `_acc`, um usuário e um convite inicial
- [X] T036 [P] [US3] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/steps.test.ts`: executor leva a tarefa de `pendente` a `concluida` e a instância por `CADASTRADA → PROVISIONANDO → PRONTA`; registros em `admin_task_step_run` para as etapas 1–9 (1 e 2 gravadas pela solicitação, 1 conferida de novo e 3–9 pelo executor); `instance_resource` com os três recursos em `verificado`; senha só em `secret_enc` (decifrável com `INSTANCE_SECRET_KEY` e AAD = UUID); histórico `_spark_schema_history` com versões e checksums do artefato; `_spark_instance` com o UUID e `owner_task_uuid` = tarefa; `access_instance.state = 'pronta'` na projeção v2; convite inicial `pendente`, `is_initial`, `link_issued_at IS NULL`; `schema_version` gravada; com a credencial operacional: DML no próprio banco ok, `SELECT` em banco de outra instância e no `_acc` dela negado, `CREATE TABLE` e `CREATE DATABASE` negados (CS-006); provisionar A com B já `PRONTA`: comparar, antes e depois, `information_schema` (tabelas e colunas) dos bancos de B, `SHOW GRANTS` do usuário de B, linhas do `_acc` de B e `instance_resource`/`admin_task` de B — nada muda (`T-04`, tarefa); nenhum log do pino contém a senha
- [X] T037 [P] [US3] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/lease.test.ts`: dois executores disputando a mesma tarefa → só um obtém o lease (`FOR UPDATE SKIP LOCKED`); heartbeat renova `lease_until` a cada 20 s (relógio de teste); segunda tarefa estrutural ativa para a mesma instância → recusada pelo índice único (`SC-022`, `RN-SC-002`); lease vencido → outro executor assume e a tentativa anterior vira `interrompida`
- [X] T038 [P] [US3] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/connection.test.ts`: `GET /internal/v1/instances/{slug}/connection` com credencial `sparkref` com escopo `connection` → `200`, `Cache-Control: no-store`, host/porta de `INSTANCE_DB_HOST`/`INSTANCE_DB_PORT`, credencial funcional; sem o escopo → `401 AUTH_APP_CREDENTIAL_INVALID` (mesma resposta de F01); credencial de outro produto ou slug inexistente → `404` idêntico; instância `CADASTRADA`, `PROVISIONANDO` ou `FALHA_PROVISIONAMENTO` → `409 INSTANCE_NOT_READY`; evento de segurança `conexao_entregue` sem a senha; a senha não aparece no log; com o cliente de referência (`connect`), 200 aquisições alternadas A/B usando as conexões entregues pelo contrato, cada consulta conferindo `SELECT DATABASE()` e o marcador `_spark_instance` da própria instância (`T-04`, pool reutilizado)
- [X] T039 [P] [US3] Escrever teste de contrato `server/tests/contract/provisioning-contract.test.ts` para `POST /api/v1/instances`, `/preview`, `/timezones`, `GET /api/v1/instances/{id}/provisioning` e `/internal/v1/instances/{slug}/connection`

### Implementation for User Story 3

- [X] T040 [P] [US3] Implementar `server/src/modules/instances/slug.ts` e `server/src/modules/instances/timezones.ts` — até T033 passar
- [X] T041 [US3] Implementar `server/src/modules/provisioning/tasks.ts`: criar instância + tarefa + transição + auditoria numa transação com `UNIQUE (requested_by, idempotency_key)` e `request_hash` (R-04), tradução de `ER_DUP_ENTRY` em `instance_slug` → `CONFLICT_SLUG_TAKEN`; obter lease (`pendente` ou `aguardando_repeticao` vencida, ou `em_execucao` com lease vencido) com `FOR UPDATE SKIP LOCKED`; renovar e liberar; registrar início e fim de `admin_task_step_run`; gravar `validar` e `reservar` concluídas na transação da solicitação
- [X] T042 [US3] Decompor `server/src/platform/migrations/apply-artifact.ts` em funções reutilizáveis (criar banco, aplicar artefato com `afterVersion`, aplicar projeção, conceder privilégios) mantendo `applyArtifact` para `ref:validate` e testes de F00; implementar `server/src/modules/provisioning/resources.ts` (intenção `pretendido` antes de cada efeito, `criado` depois, `verificado` na etapa 8; adoção de banco existente só com intenção + marcador do UUID ou nenhuma tabela; usuário MySQL: senha gerada (32 bytes base64url) e cifrada antes do `CREATE USER`, `ALTER USER … IDENTIFIED BY` com a senha guardada quando 1396 e há intenção; sem intenção → `PROVISIONING_RESOURCE_CONFLICT`) conforme research R-06
- [X] T043 [US3] Implementar `server/src/modules/provisioning/steps.ts` com as etapas 1–9 da tabela do research R-06 (validar só provisionador, ambiente e `manifest_sha256` fixado com `resolveProvisioner` — diferente → `PROVISIONING_ARTIFACT_CHANGED`; não consulta situação de contratante nem de produto; `criar_bancos`; `criar_credencial`; `aplicar_migracoes` com `owner_task_uuid` no marcador e projeção vigente; `configurar` com `access_instance` `pronta`; `preparar_convite` inserindo convite inicial `pendente` com token descartado e `link_issued_at` nulo, sem duplicar; `verificar` com a credencial operacional, incluindo os testes negativos de privilégio; `concluir`) e `server/src/modules/provisioning/executor.ts` (executa etapas em ordem a partir da primeira não concluída na execução atual, marca `ignorada` quando o efeito já está verificado, heartbeat a cada 20 s, parâmetro opcional `afterEffect` para testes, transições via `transitions.ts`, logs `provisioning_step`/`provisioning_finished`) — até T036 e T037 passarem
- [X] T044 [US3] Implementar `server/src/worker/jobs/provisioning.ts` (`processDueProvisioning(ctx)` pega uma tarefa por vez com lease e roda o executor) e registrar em `server/src/worker/main.ts` com a credencial `provisioner` carregada só no trabalhador (`loadConfig({credentials: ["worker", "access", "provisioner"]})`), intervalo de consulta de 2 s
- [X] T045 [US3] Implementar `server/src/modules/instances/request.ts` (prévia e solicitação: valida contratante `ativo`, produto provisionável, slug, fuso, e-mail normalizado, vigência `valid_until ≥ valid_from`, `notes` até 4 000) e rotas em `server/src/modules/instances/routes.ts` (`POST /api/v1/instances` com `requireRecentMfa` e idempotência da tarefa, `POST /api/v1/instances/preview`, `GET /api/v1/instances/timezones`, `GET /api/v1/instances/:instanceId/provisioning`); registrar em `server/src/app/modules.ts` — até T034, T035 e T039 passarem
- [X] T046 [US3] Acrescentar o escopo `connection` em `server/src/modules/app-credentials/app-credentials.ts`, `server/src/platform/http/app-credential.ts` e `server/src/cli/app-credential.ts`; implementar `server/src/modules/internal-api/connection.ts` (`GET /internal/v1/instances/:slug/connection`, resolvendo pelo produto da credencial, decifrando a senha só para a resposta, `Cache-Control: no-store`, evento `conexao_entregue`, nenhuma serialização da resposta no log) — até T038 passar
- [X] T047 [US3] Acrescentar `connect(slug)` ao cliente `server/reference-product/client.ts` (obtém a conexão pelo contrato e abre um pool exclusivo por instância, nunca `USE`, coberto por T038) e trocar as sementes para `server/seeds/f02.ts`: contratante sintético, produto `sparkref`, credencial `sparkref` com `sessions,members,connection`, instâncias `ref-a`/`ref-b` com UUID fixo criadas pelo executor em modo síncrono até `PRONTA`, com os vínculos de administrador criados antes de `activateSyntheticInstance`; `server/src/cli/db-seed.ts` chama `seedF02`; ajustar `server/tests/integration/seed.test.ts`
- [X] T048 [P] [US3] Implementar `web/src/api/instances.ts`, `web/src/api/provisioning.ts`, `web/src/pages/instances/NewInstancePage.tsx` (`Stepper` em 3 passos: contratante ativo e produto provisionável; dados com slug normalizado ao lado do digitado; resumo sem credenciais e confirmação com `useReauth`; `Idempotency-Key` gerada uma vez e mantida no estado do formulário para reenvio após timeout) e `web/src/pages/instances/ProvisioningPage.tsx` (protocolo, `StepsBlock`/`Stepper` das etapas, tentativas, consulta a cada 2 s enquanto ativa, texto "a instância ficará PRONTA; a ativação chega em etapa posterior"); rotas `/instancias/nova` e `/instancias/:id/provisionamento`
- [X] T049 [P] [US3] Escrever testes de componente `web/tests/component/new-instance.test.tsx` (produto não provisionável desabilitado com motivo, slug normalizado, slug em uso, reautenticação, reenvio usa a mesma chave) e `web/tests/component/provisioning-page.test.tsx` (em andamento, concluída, consulta periódica para em estado final)
- [X] T050 [US3] Escrever E2E `web/tests/e2e/provisioning.spec.ts`: contratante → nova instância `sparkref` com slug "Loja Centro!" → TOTP → protocolo → etapas até `PRONTA` (trabalhador rodando no ambiente do E2E); nenhuma senha na página; 360 e 1280 px; teclado; axe

**Checkpoint**: MVP — contratante, catálogo e instância `PRONTA` (quickstart §1–§3)

---

## Phase 6: User Story 4 - Falha, retomada e repetição (Priority: P1)

**Goal**: retomada sem duplicidade após interrupção, falhas classificadas, `FALHA_PROVISIONAMENTO`
visível e nova execução manual

**Independent Test**: interromper em cada etapa 3–8 e retomar; `SIGKILL` do trabalhador; recursos
sem prova de propriedade; migração com falha; nova execução

### Tests for User Story 4 ⚠️

- [X] T051 [P] [US4] Escrever testes unitários (devem falhar) `server/tests/unit/provisioning/errors.test.ts`: classificação transitória (`ECONNREFUSED`, `ECONNRESET`, `PROTOCOL_CONNECTION_LOST`, `ETIMEDOUT`, `ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`, `ER_CON_COUNT_ERROR`) × não transitória (privilégio negado → `PROVISIONING_PRIVILEGE_MISSING`, `MigrationError` `MIGRATION_FAILED` → `PROVISIONING_MIGRATION_FAILED`, `SCHEMA_FAILED` → `PROVISIONING_MIGRATION_INTERRUPTED`, conflito, artefato inválido ou alterado); espera `5 s × 3^(n-1)` limitada a 5 min; mensagem segura sem SQL, nome de usuário MySQL, caminho ou senha
- [X] T052 [P] [US4] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/resume.test.ts` (CS-004, `CA-SC-006`, `T-02`): para cada etapa 3–8, `afterEffect` interrompe depois do efeito e antes do registro; outro executor retoma após o lease (relógio de teste) e chega a `PRONTA` com um banco, um `_acc`, um usuário (mesma senha guardada e funcional) e um convite; a tentativa interrompida fica `interrompida` no histórico; caso específico: banco criado e nenhuma versão aplicada → adotado (banco vazio + intenção) e migrações concluídas
- [X] T053 [P] [US4] Escrever teste de integração (deve falhar) `server/tests/integration/provisioning/worker-kill.test.ts` (`NFR-014`): inicia o trabalhador real como processo filho, aguarda a etapa `aplicar_migracoes` começar, envia `SIGKILL`, inicia outro processo e confere `PRONTA` sem duplicidade e com o histórico preservado; reiniciar o trabalhador depois de `concluida` não executa etapa nenhuma
- [X] T054 [P] [US4] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/ownership.test.ts` (CS-005, `SC-021`): banco com o nome derivado existente sem intenção → `PROVISIONING_RESOURCE_CONFLICT`; com intenção, mas com tabelas e sem marcador → conflito; com marcador de outra instância → conflito; usuário `inst_*` existente sem intenção → conflito; em todos, nenhuma tabela, linha, usuário ou privilégio é alterado ou removido e a falha não é repetida automaticamente
- [X] T055 [P] [US4] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/failure.test.ts`: falha transitória injetada → `aguardando_repeticao` com `next_attempt_at` progressivo e sucesso na tentativa seguinte; tentativas esgotadas (`PROVISIONING_MAX_ATTEMPTS = 2`) → instância `FALHA_PROVISIONAMENTO`, tarefa `falhou`, `error_code`/`error_message` seguros (`CA-SC-007`); artefato de teste com versão que falha → `PROVISIONING_MIGRATION_FAILED`, `retryable = false`; versão interrompida (linha `falha` no histórico) → `PROVISIONING_MIGRATION_INTERRUPTED`; login de produto continua negado; `POST /api/v1/instances/{id}/provisioning/retry` sem TOTP recente → `403`; fora de `FALHA_PROVISIONAMENTO` → `409 CONFLICT_STATE`; com motivo → `run_number + 1`, `attempt = 0`, retoma da primeira etapa não concluída, linhas da execução anterior intactas, auditoria `provisionamento.repetido`; mesma chave → mesma resposta; inativar o contratante e o produto entre a solicitação e o início do trabalhador → a tarefa conclui em `PRONTA`; manifesto implantado alterado após a solicitação → `PROVISIONING_ARTIFACT_CHANGED`, `retryable = false`; credencial de provisionamento sem `CREATE USER` (usuário de teste) → `PROVISIONING_PRIVILEGE_MISSING` na etapa `criar_credencial`; não existe rota para alterar estado, etapa, SQL ou credencial (inventário das rotas registradas)

### Implementation for User Story 4

- [X] T056 [US4] Implementar `server/src/modules/provisioning/errors.ts` (classificação, códigos estáveis, mensagens seguras, espera progressiva, `retryable` para a interface) — até T051 passar
- [X] T057 [US4] Completar o tratamento de falhas em `server/src/modules/provisioning/executor.ts` e `server/src/modules/provisioning/tasks.ts`: falha transitória → `aguardando_repeticao` com `next_attempt_at`; não transitória ou `attempt ≥ PROVISIONING_MAX_ATTEMPTS` → tarefa `falhou`, transição `PROVISIONANDO → FALHA_PROVISIONAMENTO`; lease vencido marca a tentativa aberta como `interrompida` ao ser assumido — até T052, T053 e T054 passarem
- [X] T058 [US4] Implementar `server/src/modules/provisioning/retry.ts` e a rota `POST /api/v1/instances/:instanceId/provisioning/retry` (reautenticação, `withIdempotency`, motivo obrigatório, só em `FALHA_PROVISIONAMENTO`, transição `FALHA_PROVISIONAMENTO → PROVISIONANDO` feita pelo executor ao retomar) — até T055 passar
- [X] T059 [P] [US4] Ampliar `web/src/pages/instances/ProvisioningPage.tsx` com os estados aguardando repetição (próxima tentativa), falha repetível (botão "Repetir" com `Dialog` de motivo e `useReauth`) e falha que exige procedimento (sem botão, com orientação e link para o procedimento), mensagem segura e `correlationId`; testes de componente em `web/tests/component/provisioning-failure.test.tsx`
- [X] T060 [P] [US4] Escrever `docs/operacao/provisionamento.md`: como diagnosticar pelo protocolo e pelos logs `provisioning_step`; procedimento para `PROVISIONING_RESOURCE_CONFLICT`, `PROVISIONING_MIGRATION_INTERRUPTED` e `PROVISIONING_PRIVILEGE_MISSING` (sem apagar recursos com dados; quando a instância nunca ficou pronta, encerrá-la em F03 e solicitar outra); perda da `INSTANCE_SECRET_KEY` (redefinir senha por `ALTER USER`)

**Checkpoint**: US4 funcional (quickstart §4)

---

## Phase 7: User Story 5 - Convite inicial e caminho para o primeiro administrador (Priority: P2)

**Goal**: emitir e reemitir o link do convite inicial de uma instância `PRONTA`, sem tocar em
recursos estruturais

**Independent Test**: provisionar, emitir, reemitir, deixar expirar, aceitar com conta nova e
existente e conferir que nada estrutural mudou

### Tests for User Story 5 ⚠️

- [X] T061 [P] [US5] Escrever testes de integração (devem falhar) `server/tests/integration/provisioning/initial-invitation.test.ts`: situação `aguardando_emissao` após o provisionamento; `POST /api/v1/instances/{id}/initial-invitation/issue` sem TOTP recente → `403`; instância não `PRONTA` → `409 CONFLICT_STATE`; emissão → link exibido uma vez (48 h), `link_issued_at` preenchido, situação `emitido`, auditoria `convite_inicial.emitido`; segunda emissão → o primeiro token passa a ser inválido; aceite com conta nova e com conta existente cria vínculo `administrador` sem liberar login de produto (instância segue `PRONTA`); depois de 48 h (relógio de teste) → `expirado`; reemitir não cria `admin_task_step_run`, não altera `instance_resource` nem o histórico de migrações; após aceite → `409 CONFLICT_INITIAL_INVITATION_ACCEPTED`; convites criados por pessoas em F01 continuam com `link_issued_at` preenchido; após o aceite, o vínculo aparece em `access_member` do `_acc` da instância (réplica de F01) e `npm run access:reconcile -- <slug>` sai com 0 sem divergência; revogar o vínculo grava a revogação no `_acc` (sincronização de F01 alcança instância provisionada)
- [X] T062 [P] [US5] Escrever teste de contrato `server/tests/contract/initial-invitation-contract.test.ts` para a emissão e para `initialInvitation` em `GET /api/v1/instances/{id}`

### Implementation for User Story 5

- [X] T063 [US5] Em `server/src/modules/identity/invitations.ts`, gravar `link_issued_at = now` em `createInvitationTx` e aceitar `linkIssued: false` para o convite preparado pela tarefa; implementar `server/src/modules/provisioning/initial-invitation.ts` (situação calculada `aguardando_emissao`/`emitido`/`expirado`/`aceito`/`revogado`/`inexistente` e emissão por reenvio de F01 com `isInitial`) e a rota `POST /api/v1/instances/:instanceId/initial-invitation/issue` (reautenticação, `withIdempotency`) — até T061 e T062 passarem
- [X] T064 [P] [US5] Acrescentar a `web/src/pages/instances/ProvisioningPage.tsx` o bloco do convite inicial (situação, "Emitir link"/"Reemitir link" com `useReauth` e `OneTimeLinkDialog`), separado da prontidão técnica; testes de componente em `web/tests/component/initial-invitation.test.tsx`
- [X] T065 [US5] Estender `web/tests/e2e/provisioning.spec.ts`: na instância `PRONTA`, emitir o link, abrir em contexto anônimo, criar a conta e aceitar; voltar ao painel e ver a situação `aceito`; 360 e 1280 px; axe

**Checkpoint**: US5 funcional (quickstart §5)

---

## Phase 8: User Story 6 - Consulta e acompanhamento de instâncias (Priority: P2)

**Goal**: lista filtrada e paginada, detalhe com linha do tempo, edição de nome, anotações e
vigência

**Independent Test**: filtros por contratante, produto, estado e período; detalhe; edição com
conflito; slug imutável; vigência vencida

### Tests for User Story 6 ⚠️

- [X] T066 [P] [US6] Escrever testes de integração (devem falhar) `server/tests/integration/instances/query.test.ts`: `GET /api/v1/instances` sem parâmetros devolve a primeira página (25) com os campos de F01 mais os novos; filtros `contractorId`, `productCode`, `state`, `createdFrom`/`createdTo` (datas civis em `America/Sao_Paulo`, intervalo `[início, fim + 1 dia)`); `lastTask` com protocolo e situação; `validityExpired` calculado na data local do fuso da instância, sem mudar o estado; `GET /api/v1/instances/{id}` com transições (ator pessoa ou "Sistema"), `initialInvitation`, sem credencial; `PUT` com `displayName` 2–120, `notes` até 4 000 e vigência → atualiza com auditoria `instancia.editada`; versão antiga → `409`; `slug`, `productCode` ou `contractorId` no corpo → `422`; instância inexistente → `404`
- [X] T067 [P] [US6] Escrever teste de contrato `server/tests/contract/instances-contract.test.ts` para `GET /api/v1/instances`, `GET/PUT /api/v1/instances/{id}`

### Implementation for User Story 6

- [X] T068 [US6] Implementar `server/src/modules/instances/query.ts` (lista filtrada e paginada, detalhe com transições e convite, atualização com versão otimista) e as rotas `GET /api/v1/instances`, `GET /api/v1/instances/:instanceId`, `PUT /api/v1/instances/:instanceId` em `server/src/modules/instances/routes.ts`, removendo a rota antiga de `server/src/modules/memberships/routes.ts` — até T066 e T067 passarem
- [X] T069 [P] [US6] Reescrever `web/src/pages/instances/InstancesPage.tsx` (filtros em `Select` e `Input type=date` refletidos na URL, `DataTable`, `Badge` de estado, protocolo, pendência de vigência, `Pagination`, botão "Nova instância") e criar `web/src/pages/instances/InstancePage.tsx` (`Tabs` Resumo/Linha do tempo/Vínculos; edição de nome, anotações e vigência com conflito de versão; slug sem edição; atalho para provisionamento e para `/instancias/:id/vinculos` de F01); rota `/instancias/:id`; testes de componente em `web/tests/component/instances.test.tsx`; ajustar `web/tests/e2e/members.spec.ts` se a navegação para vínculos mudar
- [X] T070 [US6] Escrever E2E `web/tests/e2e/instances.spec.ts`: filtrar por estado `ATIVA` (vê `ref-a` e `ref-b`), abrir detalhe, ver linha do tempo, editar nome e anotações, informar vigência vencida e ver a pendência; 360 e 1280 px; teclado; axe

**Checkpoint**: todas as histórias funcionais e verificáveis isoladamente

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T071 [P] Escrever `server/tests/integration/security/no-secrets-f02.test.ts` (CS-007): provisionamento completo, falha, nova execução, emissão de convite e contrato de conexão capturando a saída do pino, `admin_task`, `admin_task_step_run`, `core_audit_event`, `security_event` e as respostas de `/api/v1`; a senha operacional, o nome do usuário MySQL nas mensagens de erro, SQL e o token do convite não aparecem, exceto o link na resposta de emissão e a senha na resposta do contrato de conexão
- [X] T072 [P] Escrever `server/tests/integration/provisioning/perf-provisioning.test.ts` (CS-002): 20 provisionamentos sequenciais do produto de referência, registrar p95 do tempo entre a solicitação e `PRONTA` (meta ≤ 2 min)
- [X] T073 [P] Incluir na situação do sistema (`server/src/modules/system/probe.ts`) as contagens de tarefas de provisionamento pendentes, aguardando repetição e com falha, sem detalhes de instância; ajustar `server/tests/integration/system-status.test.ts` e o contrato
- [X] T074 [P] Registrar em `docs/design-system-updates.md` as lacunas observadas em F02 (seleção com busca de contratante, campo de data com calendário, linha do tempo); atualizar `contracts/commands.md` com [commands-f02.md](./contracts/commands-f02.md), `contracts/migration-artifact.md` (o aplicador grava `owner_task_uuid`; uma versão interrompida exige procedimento; **prontidão** = marcador `_spark_instance` com o UUID, histórico na última versão do manifesto sem linha `falha` e credencial operacional capaz de ler o marcador; verificações próprias do produto entram como evolução versionada do contrato), `README.md` (novas variáveis e fluxo de provisionamento) e `docs/CONTRIBUTING.md` (escopo `connection`)
- [X] T075 Executar o roteiro de [quickstart.md](./quickstart.md) e `npm run verify`, registrando resultados, p95 (T072) e limitações em `specs/003-f02-catalogo-provisionamento/evidence.md`
- [ ] T076 Com a evidência de T075 e a CI do GitHub verde, marcar `F02: concluida` em `docs/slices.yaml`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências
- **Foundational (Phase 2)**: depende do Setup — bloqueia todas as histórias. Dentro dela:
  esquema (T005–T007) → renomeação (T008) → transições (T010–T011), login só em `ATIVA`
  (T012–T013), `instances:migrate-access` (T014) e sementes (T015); auditoria (T009), contrato
  (T016) e apoio de testes (T017) em paralelo
- **US1 (Phase 3)**: depende da Fase 2
- **US2 (Phase 4)**: depende da Fase 2; independente de US1
- **US3 (Phase 5)**: depende da Fase 2, de US1 (contratante ativo) e de US2 (produto
  provisionável)
- **US4 (Phase 6)**: depende de US3 (executor e recursos)
- **US5 (Phase 7)**: depende de US3 (convite preparado e instância `PRONTA`)
- **US6 (Phase 8)**: depende da Fase 2; usa dados de US3 nos testes, mas a consulta das
  instâncias sintéticas já funciona sem US3
- **Polish (Phase 9)**: depende de todas

### User Story Dependencies

```text
Setup → Foundational ─┬─ US1 ─┐
                      ├─ US2 ─┴─ US3 ─┬─ US4 ─┐
                      │               └─ US5 ─┼─ Polish
                      └─ US6 ─────────────────┘
```

### Within Each User Story

- Testes escritos e observados falhando antes da implementação
- Domínio → rotas → interface → E2E

### Parallel Opportunities

- Setup: T002, T003, T004
- Fase 2: T006 e T007 junto com T005; T009, T016 e T017 em paralelo ao restante; T012 e T014
  depois de T008
- US1: T018, T019, T020 juntos; T024/T025 em paralelo às rotas
- US2: T027, T028, T029 juntos; T032 em paralelo às rotas; US2 pode correr em paralelo a US1
- US3: T033–T039 juntos; T040 e T048/T049 em paralelo ao backend
- US4: T051–T055 juntos; T059 e T060 em paralelo
- US5 e US6 podem correr em paralelo depois de US3

---

## Parallel Example: User Story 3

```text
Task: "Slug e fusos em server/tests/unit/instances/slug.test.ts e timezones.test.ts"
Task: "Solicitação em server/tests/integration/provisioning/request.test.ts"
Task: "Idempotência em server/tests/integration/provisioning/idempotency.test.ts"
Task: "Etapas e privilégios em server/tests/integration/provisioning/steps.test.ts"
Task: "Lease em server/tests/integration/provisioning/lease.test.ts"
Task: "Contrato de conexão em server/tests/integration/provisioning/connection.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Setup e Fundação
2. US1 (contratantes) e US2 (catálogo), em paralelo
3. US3 (solicitação e provisionamento até `PRONTA`)
4. **STOP and VALIDATE**: quickstart §0–§3

### Incremental Delivery

1. MVP → US4 (falha e retomada, a outra P1) → US5 (convite inicial) → US6 (consulta) → Polish
2. Cada história fecha com sua suíte de integração verde e o E2E correspondente

---

## Notes

- Commits citam IDs (`SC-*`, `COM-*`, `FR-*`, `T-01`, `T-02`); branch
  `003-f02-catalogo-provisionamento`
- Nenhuma tarefa toca o Tuteli além da linha `sparkpet` não provisionável no catálogo
- Nenhum código em `server/src` contém `DROP DATABASE`; limpezas de teste ficam em
  `server/tests/support/mysql.ts`
