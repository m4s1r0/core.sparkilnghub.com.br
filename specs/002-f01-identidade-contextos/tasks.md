---

description: "Tarefas da fatia F01 — Identidade e contextos do SparkCore"
---

# Tasks: F01 — Identidade e contextos do SparkCore

**Input**: Design documents from `specs/002-f01-identidade-contextos/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: obrigatórios (constituição V). Regras de alto risco — senha, TOTP, sessão, revogação,
isolamento, último administrador, privilégios da projeção — têm o teste escrito e **observado
falhando** antes da implementação. Integração sempre contra MySQL real.

**Organization**: por história de usuário; cada fase termina em ponto verificável isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: história da spec (US1…US5)
- Caminhos relativos à raiz do repositório

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: dependências, configuração e credenciais novas

- [X] T001 Atualizar `docs/slices.yaml` com `F01: em-implementacao` e confirmar `npm run gate -- F01` = 0
- [X] T002 [P] Acrescentar dependências: `@node-rs/argon2` ^2.2 e `@fastify/cookie` ^11.1 em `server/package.json`; `qrcode` ^1.5 e `@types/qrcode` ^1.5 em `web/package.json`; rodar `npm install` e versionar `package-lock.json` (sem novos `allowScripts`)
- [X] T003 [P] Acrescentar ao `.env.example` e ao esquema em `server/src/platform/config/schema.ts`: `IDENTITY_SECRET_KEY` (32 bytes base64, segredo), `IDENTITY_SECRET_KEY_VERSION` (inteiro, padrão 1), `PUBLIC_ORIGIN` (URL, padrão `http://127.0.0.1:5173` em development), `MYSQL_ACCESS_WRITER_PASSWORD` (segredo, papel `access` → usuário `spark_access_writer`), `SEED_USER_PASSWORD` (segredo, só dev/homologação), `SPARKREF_APP_CREDENTIAL` (opcional, gerado pelo seed); atualizar `credentialVariable`/`mysqlUser` e os testes de `server/tests/unit/config/load.test.ts`
- [X] T004 [P] Em `docker/mysql/init/01-databases-and-users.sh` criar `spark_access_writer` sem privilégios globais (grants por instância feitos pelo provisionador); passar `MYSQL_ACCESS_WRITER_PASSWORD` em `compose.yaml` e no job `test`/`e2e` de `.github/workflows/verify.yml`
- [X] T005 [P] Copiar a lista "10k-most-common.txt" do SecLists (MIT) para `server/assets/common-passwords.txt` e registrar origem, commit e licença em `server/assets/ORIGEM.md`
- [X] T006 Tornar a tabela de histórico do migrador parametrizável (`historyTable`, padrão `_spark_schema_history`) em `server/src/platform/migrations/migrator.ts` e `checkHistory`/`readHistory`, sem mudar o comportamento atual; ajustar `server/tests/integration/migrations/migrator.test.ts` para cobrir um histórico com outro nome

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, primitivas de segurança, projeção de acesso e infraestrutura HTTP usadas por
todas as histórias

**⚠️ CRITICAL**: nenhuma história começa antes do fim desta fase

### Esquema

- [X] T007 Criar `server/migrations/spark_identity/migrations/0002_contas_credenciais.sql` com `account` (`id BINARY(16) PK`; `email_normalized VARCHAR(254) UNIQUE`; `email_display VARCHAR(254)`; `display_name VARCHAR(120)` obrigatório; `status ENUM('ativa','inativa','bloqueada')`; `auth_revision INT UNSIGNED`; `created_at`/`updated_at DATETIME(6)`), `password_credential` (`account_id` PK; `hash VARCHAR(255)`; `changed_at`; `params_version`), `totp_factor` (`account_id` PK; `secret_enc VARBINARY(128)`; `key_version`; `enrolled_at`; `confirmed_at` NULL; `last_step BIGINT`), `recovery_code` (`id` PK; `account_id`; `code_hash CHAR(64)`; `used_at` NULL; índice `account_id`), `platform_role` (`account_id` PK; `role ENUM('administrador')`; `status ENUM('ativo','inativo')`; `granted_by`; `granted_at`; `changed_at`)
- [X] T008 Criar `server/migrations/spark_identity/migrations/0003_vinculos_convites_sessoes.sql` com `membership` (`id` PK; `account_id`; `instance_id`; `role ENUM('administrador','colaborador')`; `status ENUM('ativo','revogado')`; `version INT UNSIGNED`; `created_by`, `created_at`, `changed_by`, `changed_at`, `change_reason`; coluna gerada para unicidade de (`account_id`,`instance_id`) entre ativos), `invitation` (`id` PK; `target ENUM('plataforma','instancia')`; `instance_id` NULL; `role VARCHAR(32)`; `email_normalized VARCHAR(254)`; `token_hash CHAR(64) UNIQUE`; `status ENUM('pendente','aceito','revogado','expirado')`; `is_initial BOOLEAN`; `expires_at`; `created_by`, `created_at`, `accepted_by`, `accepted_at`), `core_session` (`id_hash CHAR(64)` PK; `account_id`; `created_at`; `last_seen_at`; `expires_at`; `mfa_confirmed_at` NULL; `auth_revision`; `ended_at` NULL; `end_reason`; `ip`; `user_agent`), `password_reset` (`token_hash` PK; `account_id`; `created_by`; `created_at`; `expires_at`; `used_at` NULL), `recovery_request` (`id` PK; `email_normalized`; `created_at`; `ip`; `handled_at` NULL), `auth_throttle` (`throttle_key VARCHAR(160)` PK; `failures`; `window_started_at`; `locked_until` NULL), `idempotency_record` (`scope_key CHAR(64)` PK; `request_hash CHAR(64)`; `status_code`; `response_body JSON`; `created_at`; `expires_at`), `security_event` (`id` PK; `type`; `actor_account_id` NULL; `actor_kind ENUM('usuario','sistema','aplicacao')`; `target_account_id` NULL; `instance_id` NULL; `result ENUM('sucesso','falha','negado')`; `detail JSON`; `correlation_id`; `ip`; `user_agent`; `created_at`); atualizar `manifest.json` com sha256
- [X] T009 [P] Criar `server/migrations/spark_core/migrations/0003_instancias_credenciais_sync.sql` com `instance_ref` (`id BINARY(16) PK`; `product_code`; `slug VARCHAR(63)`; `database_name`; `access_database_name`; `authorization_revision INT UNSIGNED`; `synthetic BOOLEAN`; `created_at`; único (`product_code`,`slug`)), `app_credential` (`id` PK; `product_code`; `label`; `secret_hash CHAR(64)`; `scopes SET('sessions','members')`; `created_at`; `expires_at` NULL; `revoked_at` NULL; `last_used_at` NULL), `access_sync_job` (`id` PK; `instance_id`; `kind ENUM('revogar_sessoes_conta','revogar_vinculo','replicar_vinculo','revisao_instancia','reconciliar')`; `payload JSON`; `status ENUM('pendente','em_execucao','concluido','falhou')`; `attempts`; `next_attempt_at`; `lease_until` NULL; `last_error` NULL; `created_at`; `finished_at` NULL); atualizar `manifest.json`
- [X] T010 [P] Criar o artefato do Core `server/migrations/access_projection/` (`manifest.json` com `artifact: "access_projection"` + `migrations/0001_projecao_v1.sql`) com `access_session`, `access_session_logout`, `access_member` e `access_instance` exatamente como em [access-projection.md](./contracts/access-projection.md), incluindo índice por `membership_id` em `access_session`; acrescentar o diretório a `MIGRATION_ROOTS` em `scripts/lib/check-migrations.ts` e ao loop de manifestos de `scripts/check-migrations.ts`

### Primitivas de segurança (testes primeiro)

- [X] T011 [P] Escrever testes (devem falhar) em `server/tests/unit/crypto/crypto.test.ts`: token de 32 bytes base64url distinto a cada chamada; `sha256Hex`; AES-256-GCM cifra/decifra e falha com tag adulterada ou `key_version` desconhecida; `timingSafeEqualHex`
- [X] T012 [P] Escrever testes (devem falhar) em `server/tests/unit/identity/totp.test.ts` com os vetores SHA-1 do RFC 6238 (59, 1111111109, 1111111111, 1234567890, 2000000000 → códigos de 8 dígitos truncados para 6 conforme a seção 5.3), janela ±1 passo aceita, ±2 recusada, reuso do mesmo passo recusado, URI `otpauth://totp/SparkCore:<email>?secret=…&issuer=SparkCore&digits=6&period=30`
- [X] T013 [P] Escrever testes (devem falhar) em `server/tests/unit/identity/password.test.ts`: política (mínimo 12, máximo 128, recusa da lista comum em minúsculas, recusa igual ao e-mail ou ao nome), hash Argon2id m=19456 t=2 p=1 em formato PHC, verificação correta e incorreta, `needsRehash` quando `params_version` muda; normalização de e-mail (`trim` + minúsculas, preserva pontos e `+sufixo`)
- [X] T014 Implementar `server/src/platform/crypto/index.ts` (tokens, sha256, AES-GCM com `IDENTITY_SECRET_KEY`/versão, comparação constante) — até T011 passar
- [X] T015 Implementar `server/src/modules/identity/totp.ts` (RFC 6238 com `node:crypto`, segredo de 20 bytes, base32, códigos de recuperação de 10 caracteres base32 armazenados como sha256) — até T012 passar
- [X] T016 Implementar `server/src/modules/identity/password.ts` (política, `@node-rs/argon2`, carga única da lista de `server/assets/common-passwords.txt`) e `server/src/modules/identity/email.ts` — até T013 passar
- [X] T017 [P] Escrever testes de integração (devem falhar) em `server/tests/integration/identity/throttle.test.ts`: 10 falhas por conta → `locked_until` +15 min e 11ª tentativa limitada; sucesso zera; 50 falhas por origem em 15 min → bloqueio de origem; chaves `account:`, `ip:` e as regras de login, convite e recuperação (a chave `ip-account:` foi dispensada: redundante com `account:` + `ip:`)
- [X] T018 Implementar `server/src/modules/identity/throttle.ts` sobre `auth_throttle` com `SELECT … FOR UPDATE`, incluindo as regras do aceite de convite (senha atual errada por conta; token inválido por origem, 50 em 15 min) e dos pedidos de recuperação (5 por e-mail por hora, 20 por origem em 15 min) do research R-06 — até T017 passar
- [X] T019 [P] Implementar `server/src/modules/identity/security-events.ts` (somente `INSERT`; tipos de FR-030; `detail` passa por `scrub`) e teste `server/tests/unit/identity/security-events-insert-only.test.ts` que falha se qualquer arquivo de `server/src` contiver `UPDATE security_event` ou `DELETE FROM security_event`

### Projeção de acesso e instâncias (testes primeiro)

- [X] T020 [P] Escrever testes de integração (devem falhar) em `server/tests/integration/access/provision-access.test.ts`: aplicar o produto de referência a uma instância cria também `<banco>_acc` com o artefato `access_projection` (histórico `_spark_access_history`); `spark_access_writer` tem DML em `<acc>.*` e nada no banco operacional; usuário `inst_*` tem `SELECT` em `<acc>.*` e `INSERT` só em `access_session_logout`; `inst_*` recebe erro de privilégio em `INSERT INTO access_session`, `UPDATE access_session` (inclusive `SET ended_at = NULL`), `DELETE FROM access_session_logout`, `UPDATE access_session_logout`, `UPDATE access_member` e `UPDATE access_instance`; duas instâncias não enxergam o `_acc` uma da outra
- [X] T021 Estender `server/src/platform/migrations/apply-artifact.ts`: criar `<banco>_acc`, aplicar `server/migrations/access_projection` com histórico `_spark_access_history`, inserir a linha de `access_instance` (`state = 'ativa'`), conceder os privilégios de T020 com `grantDatabaseName`; registrar em `server/src/modules/instances/instance-ref.ts` (`instance_ref` com `access_database_name`) — até T020 passar
- [X] T022 Atualizar `server/tests/support/mysql.ts` (rastrear e remover `<banco>_acc` das instâncias criadas pelo teste) e `scripts/dev-reset.ts` (remover também `_acc` das instâncias sintéticas)
- [X] T023 [P] Escrever testes de integração (devem falhar) em `server/tests/integration/access/projection-writer.test.ts`: `createSession` grava só em `<acc>` da instância e devolve token cujo sha256 é o `id_hash`; `upsertMember` respeita `version`; `revokeMembership` encerra sessões daquele vínculo (`end_reason = vinculo_revogado`); `bumpAccount` atualiza `account_auth_revision`/`account_status` em todas as instâncias da conta; instância inacessível gera `access_sync_job` pendente e retorno `pendente`; **conexão reaproveitada** (`T-04`): 200 aquisições alternadas de conexões para A e B conferem `SELECT DATABASE()` igual ao `_acc` pedido e nenhuma conexão executa `USE`
- [X] T024 Implementar `server/src/modules/access-projection/writer.ts` (uma conexão/pool por banco `_acc`, identificada pelo `instance_id`, credencial `access`, sem `USE`) e `server/src/modules/access-projection/sync.ts` (retorna `SyncOutcome`, cria `access_sync_job` em falha) — até T023 passar
- [X] T025 Implementar `server/src/worker/jobs/access-sync.ts` (lease 60 s, repetição exponencial até 1 h, `last_error` sanitizado) e registrá-lo em `server/src/worker/main.ts`; teste `server/tests/integration/access/access-sync-job.test.ts` com banco `_acc` temporariamente sem privilégio → pendente → privilégio restaurado → concluído sem duplicar efeito; **tarefa de outra instância** (`T-04`): processar uma tarefa de A deixa o `_acc` de B idêntico, e tarefa cujo `payload` cite outra instância é recusada (`falhou`) sem efeito
- [X] T026 Implementar `server/src/modules/access-projection/reconcile.ts` (`reconcileInstance(instanceId)`: recalcula `access_member` e `access_instance` a partir de `spark_identity`/`instance_ref`, corrige a favor da fonte, encerra sessões de vínculos revogados na fonte e registra evento `projecao_reconciliada` com o número de divergências), o tipo `reconciliar` em `server/src/worker/jobs/access-sync.ts` e o comando `server/src/cli/access-reconcile.ts` (`npm run access:reconcile -- <slug>`, saídas de [commands-f01.md](./contracts/commands-f01.md), script no `package.json` raiz); teste antes (deve falhar) em `server/tests/integration/access/reconcile.test.ts` que adultera a réplica com a credencial de teste (vínculo revogado reativado, `account_auth_revision` antiga, membro ausente da fonte) e confirma correção e contagem (FR-033)

### HTTP

- [X] T027 [P] Escrever testes (devem falhar) em `server/tests/contract/http-security.test.ts`: método inseguro com cookie de sessão sem `Sec-Fetch-Site: same-origin` e com `Origin` diferente de `PUBLIC_ORIGIN` → `403 AUTH_CSRF_REJECTED`; `/internal/v1` ignora a regra; cookie `sparkcore_session` com `HttpOnly`, `SameSite=Strict`, `Path=/` e `Secure` fora de development; `Idempotency-Key` repetida com mesmo corpo devolve a mesma resposta e com corpo diferente `409 CONFLICT_IDEMPOTENCY_KEY_REUSED`
- [X] T028 Implementar em `server/src/platform/http/`: `cookies.ts` (`@fastify/cookie`), `origin-check.ts`, `session-guard.ts` (resolve `core_session` pelas regras de validade do data-model, renova `last_seen_at` no máximo a cada 60 s; decora `request.account`), `reauth.ts` (exige `mfa_confirmed_at` ≤ 5 min → `403 AUTH_REAUTH_REQUIRED`), `idempotency.ts` (`idempotency_record`, 24 h), `app-credential.ts` (`Authorization: Bearer <id>.<segredo>`, escopos, produto da credencial) — até T027 passar; registrar em `server/src/app/build-app.ts`
- [X] T029 Incorporar `specs/002-f01-identidade-contextos/contracts/openapi-f01.yaml` a `contracts/openapi.yaml` (versão 1.1.0), publicar `contracts/access-projection.md`, marcar em `contracts/capabilities.md` "Autenticar e encerrar sessão Pet", "Autorizar sessão e resolver instância" (como contrato de dados) e "vínculos locais" como **Especificada** e registrar `v1.1 — 2026-10-26` em `contracts/CHANGELOG.md`; criar `server/tests/support/contract.ts` com `expectMatchesContract(operationId, status, body)`, que valida o corpo contra o esquema de `contracts/openapi.yaml` com Ajv e falha se a operação ou o status não estiverem declarados

### Sementes

- [X] T030 Ampliar `server/seeds/f00.ts` (ou criar `server/seeds/f01.ts` chamado por `server/src/cli/db-seed.ts`): duas instâncias sintéticas `sparkref` com slugs `ref-a` e `ref-b` e bancos `_acc`; credencial de aplicação do `sparkref` com escopos `sessions,members` (segredo impresso uma vez e gravável em `SPARKREF_APP_CREDENTIAL`); contas `ana@example.test` (administrador em A), `bruno@example.test` (administrador em B), `carla@example.test` (colaborador em A e B) com senha `SEED_USER_PASSWORD`; idempotente; tudo com `[SINTÉTICO]` no nome de exibição

**Checkpoint**: esquema, primitivas e projeção prontos e testados; histórias podem começar

---

## Phase 3: User Story 1 — Primeiro acesso e login seguro do administrador (Priority: P1) 🎯 MVP

**Goal**: bootstrap, aceite de convite de plataforma com senha e TOTP, login em dois passos,
expiração e logout

**Independent Test**: quickstart §1

### Tests for User Story 1 ⚠️

- [X] T031 [P] [US1] Escrever testes de integração (devem falhar) em `server/tests/integration/identity/bootstrap-and-login.test.ts`: bootstrap gera um convite de 48 h e recusa (saída 3) com administrador ativo ou convite pendente válido; aceite exige senha conforme a política e cadastro de TOTP antes de concluir (`next = mfa_enrollment`); confirmação do TOTP devolve 10 códigos uma única vez; login com senha certa → `next = mfa` e sessão pré-MFA que só acessa `/api/v1/auth/mfa`; código válido → sessão plena; senha errada e e-mail inexistente → mesma resposta `401 AUTH_INVALID_CREDENTIALS`; 11ª tentativa após 10 falhas → `429` com `Retry-After`; inatividade > 30 min e absoluta > 8 h (relógio injetado) → `401`; logout invalida o cookie; código de recuperação entra uma vez e exige recadastrar TOTP; eventos de segurança gravados sem senha nem código
- [X] T032 [P] [US1] Escrever teste de contrato (deve falhar) em `server/tests/contract/auth-contract.test.ts` validando com `expectMatchesContract` as respostas de `login`, `confirmMfa`, `currentSession`, `startMfaEnrollment`, `confirmMfaEnrollment`, `inspectInvitation`, `acceptInvitation`, `logout`

### Implementation for User Story 1

- [X] T033 [US1] Implementar `server/src/modules/identity/accounts.ts` (criar conta, normalizar e-mail, `auth_revision`) e `server/src/modules/identity/invitations.ts` (criar/inspecionar/aceitar convite de plataforma com `FOR UPDATE`, expiração 48 h, reenvio revoga anterior)
- [X] T034 [US1] Implementar `server/src/cli/bootstrap-admin.ts` (`npm run bootstrap:admin -- <email>`, credencial do migrador, guarda de ambiente não aplicável — permitido em todos —, evento `actor_kind = 'sistema'`) e registrar o script no `package.json` raiz
- [X] T035 [US1] Implementar `server/src/modules/identity/core-sessions.ts` (criar com `mfa_confirmed_at` nulo até o segundo fator, validar, encerrar com `end_reason`) e `server/src/modules/identity/mfa.ts` (cadastro, confirmação, verificação com anti-reuso, códigos de recuperação)
- [X] T036 [US1] Implementar rotas em `server/src/modules/identity/routes.ts`: `POST /api/v1/auth/login`, `/auth/mfa`, `/auth/logout`, `GET /api/v1/session`, `POST /api/v1/account/mfa/enrollment`, `/enrollment/confirm`, `GET/POST /api/v1/invitations/:token[/accept]` — até T031 e T032 passarem; registrar em `server/src/app/modules.ts`
- [X] T037 [US1] Proteger `GET /api/v1/system/status` com sessão de administrador com MFA confirmado em `server/src/modules/system/routes.ts` (`/health/live` continua público); ajustar testes de F00 (`system-status.test.ts`, `openapi.test.ts`, E2E) para autenticar
- [X] T038 [US1] Criar a base de navegação autenticada da interface: `web/src/app/routes.tsx` (rotas de [ui-f01.md](./contracts/ui-f01.md)), `web/src/app/auth-guard.tsx` (consulta `GET /api/v1/session`; 401 → `/entrar`), `web/src/api/auth.ts`; mover a página de situação para rota protegida em `web/src/main.tsx`
- [X] T039 [P] [US1] Implementar páginas `web/src/pages/login/LoginPage.tsx`, `web/src/pages/mfa/MfaPage.tsx`, `web/src/pages/invitation/InvitationPage.tsx`, `web/src/pages/security/TotpEnrollmentPage.tsx` (QR com `qrcode`, segredo em texto, códigos exibidos uma vez com "Já guardei") com a matriz de estados de [ui-f01.md](./contracts/ui-f01.md), e testes de componente em `web/tests/component/auth-pages.test.tsx`
- [X] T040 [US1] Escrever E2E `web/tests/e2e/auth.spec.ts`: bootstrap pelo apoio de teste, aceite, cadastro de TOTP com código calculado no teste (RFC 6238), login em dois passos, logout; 360 e 1280 px; teclado; axe

**Checkpoint**: um administrador entra com MFA e vê a situação do sistema

---

## Phase 4: User Story 2 — Equipe de administração da plataforma (Priority: P1)

**Goal**: convidar, listar, inativar e reativar administradores, com reautenticação e proteção do
último ativo

**Independent Test**: quickstart §2

### Tests for User Story 2 ⚠️

- [X] T041 [P] [US2] Escrever testes de integração (devem falhar) em `server/tests/integration/identity/platform-admins.test.ts`: convite exige reautenticação de ≤ 5 min (`403 AUTH_REAUTH_REQUIRED` depois disso) e `Idempotency-Key`; lista mostra ativo/inativo/convite pendente sem segredos; inativar revoga sessões do Core do alvo; inativar o último ativo → `409 CONFLICT_LAST_ADMIN` (inclusive a si mesmo); reativar exige novo login; revogar convite de plataforma pendente o invalida (aceite → `404 INVITATION_INVALID`); auditoria com autor, alvo, valor anterior/novo, motivo; toda resposta exercitada passa por `expectMatchesContract`
- [X] T042 [P] [US2] Escrever teste de concorrência (deve falhar) em `server/tests/integration/identity/last-admin-concurrency.test.ts`: 100 rodadas de duas inativações simultâneas dos dois últimos ativos → sempre exatamente um ativo restante (CS-004)

### Implementation for User Story 2

- [X] T043 [US2] Implementar `server/src/modules/identity/platform-admins.ts` (listar, convidar, inativar/reativar com `SELECT … FOR UPDATE` sobre `platform_role` ativos, revogação de sessões do Core) e `POST /api/v1/auth/reauth` em `server/src/modules/identity/routes.ts` — até T041/T042 passarem
- [X] T044 [US2] Implementar rotas `GET /api/v1/platform-admins`, `POST /api/v1/platform-admins/invitations`, `/:accountId/deactivate`, `/:accountId/reactivate` com reautenticação e idempotência, e `POST /api/v1/invitations/:invitationId/revoke` para convites de plataforma (motivo; repetir sobre revogado → 204)
- [X] T045 [P] [US2] Implementar `web/src/pages/admins/AdminsPage.tsx` (`DataTable`, `DropdownButton` de ações incluindo "Revogar convite", `Dialog` de motivo, `Dialog` de reautenticação reutilizável em `web/src/components/ReauthDialog.tsx`, `Dialog` de link exibido uma vez em `web/src/components/OneTimeLinkDialog.tsx`) e testes de componente em `web/tests/component/admins-page.test.tsx`
- [X] T046 [US2] Estender `web/tests/e2e/auth.spec.ts` com convite de segundo administrador e tentativa de inativar o último

**Checkpoint**: a plataforma tem equipe rastreável e nunca fica sem administrador

---

## Phase 5: User Story 3 — Autenticação e autorização de produto por instância (Priority: P1)

**Goal**: login de produto pelo Core gravando sessão na projeção; validação local pelo produto de
referência; isolamento comprovado com A e B

**Independent Test**: quickstart §3

### Tests for User Story 3 ⚠️

- [X] T047 [P] [US3] Escrever testes de integração (devem falhar) em `server/tests/integration/access/instance-sessions.test.ts`: `POST /internal/v1/instances/ref-a/sessions` com credencial do `sparkref` cria sessão só em `ref-a_acc` e devolve `token`, `expiresAt` (+12 h), `idleTimeoutSeconds = 7200`, conta e papel; conta sem vínculo em B, senha errada, conta bloqueada e credencial de outro produto → mesma `401 AUTH_INVALID_CREDENTIALS`; credencial ausente/revogada/sem escopo → `401`; `touch` atualiza `last_seen_at` no máximo a cada 5 min; `clientIp` ausente → `422`; 50 falhas vindas de `clientIp` X bloqueiam só X (Y no mesmo produto continua entrando) e 10 falhas da mesma conta bloqueiam a conta; toda resposta de `createInstanceSession` e `touchInstanceSession` passa por `expectMatchesContract`
- [X] T048 [P] [US3] Escrever testes de integração (devem falhar) em `server/tests/integration/access/isolation.test.ts` usando o cliente de validação do produto de referência: token de A validado em B → inválido; corpo/cabeçalho com outro usuário, papel ou instância não alteram o resultado; sessão do Core não autentica `/internal/v1` e token de produto não autentica `/api/v1` (`CA-SC-001`); administrador da plataforma não consegue sessão de produto (FR-035); usuário `inst_*` de A não cria sessão nem desfaz revogação (privilégio); sessão com `last_seen_at` há mais de 2 h e sessão com `expires_at` passado → inválidas; logout pelo cliente torna a sessão inválida e o produto não consegue desfazê-lo; tarefa de sincronização de A não altera B e conexão do writer obtida para A nunca serve B (constituição I: tarefa e pool reutilizado)
- [X] T049 [P] [US3] Escrever teste (deve falhar) em `server/tests/integration/access/core-down.test.ts`: com o pool de identidade apontando para porta fechada, validação de sessões existentes pelo produto continua passando e o login responde `503 SYSTEM_IDENTITY_UNAVAILABLE` (CS-009)
- [X] T050 [P] [US3] Escrever teste de desempenho em `server/tests/integration/access/perf-access.test.ts`: 200 validações p95 ≤ 10 ms e 50 logins de produto p95 ≤ 1 s (CS-006), com resultado gravado para `evidence.md`

### Implementation for User Story 3

- [X] T051 [US3] Implementar `server/reference-product/client.ts`: validação pela consulta normativa de [access-projection.md](./contracts/access-projection.md) com a credencial `inst_*` da instância, logout (`INSERT IGNORE INTO access_session_logout`) e chamada de `touch` — referência para o Tuteli; sem regras de negócio
- [X] T052 [US3] Implementar `server/src/modules/internal-api/sessions.ts` com `POST /internal/v1/instances/:slug/sessions` e `/sessions/touch` (produto da credencial resolve a instância por `instance_ref`; limitação por `account:<uuid>` e `app-ip:<credencial>:<clientIp>`, nunca pelo IP do servidor do produto; evento de segurança) usando `access-projection/writer.ts` — até T047–T049 passarem
- [X] T053 [US3] Implementar `server/src/cli/app-credential.ts` (`create|revoke|list`, segredo exibido uma vez) e registrar `app-credential` no `package.json` raiz

**Checkpoint**: contrato de produto provado sem o Tuteli

---

## Phase 6: User Story 4 — Vínculos e convites para instâncias (Priority: P2)

**Goal**: plataforma e administrador local gerenciam vínculos com réplica imediata, versão
otimista e proteção do último administrador da instância

**Independent Test**: quickstart §4

### Tests for User Story 4 ⚠️

- [X] T054 [P] [US4] Escrever testes de integração (devem falhar) em `server/tests/integration/memberships/memberships.test.ts`: convite de instância (48 h, uso único, concede só aquele papel); conta existente aceita autenticando-se, sem trocar a senha e sem a instância ver outros vínculos; reenvio invalida o anterior; dois convites simultâneos ao mesmo e-mail/instância → um vínculo; mudança de papel com `version` desatualizada → `409 CONFLICT_VERSION`; revogação encerra sessões do vínculo em A e mantém B (`CA-SC-004`); revogar/rebaixar o último administrador de A → `409 CONFLICT_LAST_ADMIN`, inclusive em 100 rodadas concorrentes; convite inicial pendente válido conta como caminho de acesso e revogá-lo quando é o único caminho → `409 CONFLICT_LAST_ADMIN`; revogar convite de instância pendente o invalida; convidar membro, mudar papel e revogar vínculo pelo painel sem TOTP confirmado nos últimos 5 min → `403 AUTH_REAUTH_REQUIRED`; mudar papel e revogar repetidos com a mesma `Idempotency-Key` e o mesmo corpo devolvem o mesmo resultado, e com outro corpo `409 CONFLICT_IDEMPOTENCY_KEY_REUSED`; 10 falhas de senha atual no aceite de convite pela mesma conta → `429`; auditoria completa (`CA-SC-010`); toda resposta exercitada passa por `expectMatchesContract`
- [X] T055 [P] [US4] Escrever testes de integração (devem falhar) em `server/tests/integration/memberships/local-members-api.test.ts`: administrador local de A lista/convida/muda papel/revoga vínculo/revoga convite só em A via `/internal/v1/instances/ref-a/members` com `X-Instance-Session`; vínculo ou convite de B → `404`; colaborador → `403 AUTH_FORBIDDEN`; listagem sem e-mail de membros ativos; administrador da plataforma consultando vínculos não ganha papel em A (`COM-010`); mudar papel e revogar exigem `Idempotency-Key`; toda resposta das rotas `/internal/v1` exercitadas passa por `expectMatchesContract`

### Implementation for User Story 4

- [X] T056 [US4] Implementar `server/src/modules/memberships/memberships.ts` (convites de instância, aceite, revogação de convite com a regra do convite inicial, mudança de papel e revogação com `FOR UPDATE` nos administradores ativos e no convite inicial, versão otimista, replicação via `access-projection/sync.ts`) — até T054 passar
- [X] T057 [US4] Implementar rotas do painel `GET /api/v1/instances`, `GET /api/v1/instances/:id/members`, `POST /api/v1/instances/:id/invitations`, `/members/:membershipId/role`, `/members/:membershipId/revoke` (as duas com reautenticação e `Idempotency-Key`), a regra de instância em `POST /api/v1/invitations/:invitationId/revoke` e as internas `/internal/v1/instances/:slug/members`, `/invitations`, `/invitations/:id/revoke`, `/members/:id/role` e `/members/:id/revoke` (as duas últimas com `Idempotency-Key`) em `server/src/modules/memberships/routes.ts` e `server/src/modules/internal-api/members.ts` — até T055 passar
- [X] T058 [P] [US4] Implementar `web/src/pages/instances/InstancesPage.tsx` e `web/src/pages/instances/MembersPage.tsx` (`DataTable` com vínculos e convites pendentes, `Select` de papel, `Dialog` com motivo, "Revogar convite", `ReauthDialog` nas ações sensíveis, conflito de versão preservando o motivo digitado) e testes de componente em `web/tests/component/members-page.test.tsx`
- [X] T059 [US4] Escrever E2E `web/tests/e2e/members.spec.ts`: convidar colaborador em `ref-a` e copiar o link exibido uma vez, aceitar em contexto anônimo com conta nova, mudar papel com reautenticação, revogar vínculo e revogar convite pendente; 360 e 1280 px; teclado; axe

**Checkpoint**: ciclo de vida de acesso por instância completo

---

## Phase 7: User Story 5 — Recuperação de acesso e bloqueio global (Priority: P2)

**Goal**: pedido de recuperação neutro, link gerado pelo administrador, troca de senha que revoga
tudo, bloqueio global com prévia e pendências visíveis

**Independent Test**: quickstart §5

### Tests for User Story 5 ⚠️

- [X] T060 [P] [US5] Escrever testes de integração (devem falhar) em `server/tests/integration/identity/recovery-and-block.test.ts`: `POST /api/v1/recovery-requests` responde `202` igual para conta existente ou não e grava `recovery_request`; link gerado pelo administrador (reautenticação) vale 30 min e uma vez; novo link invalida os anteriores; troca de senha incrementa `auth_revision`, encerra sessões do Core e de produto em A e B e devolve `SyncOutcome`; prévia de bloqueio lista A e B; bloqueio exige motivo, reautenticação e `Idempotency-Key`, encerra tudo e devolve `{A: aplicada, B: aplicada}`; administrador local não tem rota para bloquear nem redefinir senha; bloquear o último administrador da plataforma → `409`; desbloqueio exige motivo, reautenticação e `Idempotency-Key`, devolve `SyncOutcome` com `account_status = 'ativa'` replicado e não reabre sessões; desbloquear conta não bloqueada → `409 CONFLICT_STATE`; `GET /api/v1/accounts?email=` só faz busca exata; `GET /api/v1/accounts/:id` traz vínculos e pedidos pendentes; `GET /api/v1/recovery-requests` lista pendentes e gerar link marca como atendidos os do mesmo e-mail; 6º pedido de recuperação do mesmo e-mail na mesma hora → `429` com a mesma mensagem, exista a conta ou não; toda resposta exercitada passa por `expectMatchesContract`
- [X] T061 [P] [US5] Escrever teste (deve falhar) em `server/tests/integration/access/access-sync-pending.test.ts`: com o `_acc` de B sem privilégio para o writer, bloqueio devolve `{A: aplicada, B: pendente}`, `GET /api/v1/access-sync/pending` lista B, e após restaurar o privilégio o trabalhador conclui e a pendência some

### Implementation for User Story 5

- [X] T062 [US5] Implementar `server/src/modules/identity/recovery.ts` (pedidos, emissão de link pelo administrador, conclusão com política de senha) e `server/src/modules/identity/blocking.ts` (prévia, bloqueio/desbloqueio com `bumpAccount` em todas as instâncias) e `server/src/modules/identity/account-lookup.ts` (busca exata, detalhe da conta) — até T060/T061 passarem
- [X] T063 [US5] Implementar rotas `POST /api/v1/recovery-requests`, `POST /api/v1/password-resets/:token`, `POST /api/v1/accounts/:id/password-reset`, `GET /api/v1/accounts/:id/block-preview`, `POST /api/v1/accounts/:id/block`, `POST /api/v1/accounts/:id/unblock`, `GET /api/v1/accounts`, `GET /api/v1/accounts/:id`, `GET /api/v1/recovery-requests`, `GET /api/v1/access-sync/pending`
- [X] T064 [P] [US5] Implementar `web/src/pages/recovery/RecoveryRequestPage.tsx`, `web/src/pages/recovery/PasswordResetPage.tsx`, `web/src/pages/accounts/AccountsPage.tsx` (busca por e-mail e fila de pedidos de recuperação), `web/src/pages/accounts/AccountPage.tsx` (vínculos, prévia de bloqueio, desbloquear, gerar link) e `web/src/pages/pending/PendingPage.tsx`, com testes de componente em `web/tests/component/recovery-and-accounts.test.tsx`
- [X] T065 [US5] Escrever E2E `web/tests/e2e/recovery-block.spec.ts`: pedido em `/recuperar`, pedido visível em `/contas`, gerar link e trocar a senha, prévia de bloqueio com A e B, bloquear com motivo e TOTP, desbloquear; 360 e 1280 px; teclado; axe

**Checkpoint**: todas as histórias funcionais e verificáveis isoladamente

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T066 [P] Registrar em `docs/design-system-updates.md` as lacunas da 0.2.0 observadas em F01 (campo de código de verificação, gerador de QR) e a dependência `qrcode`
- [X] T067 [P] Atualizar `README.md` e `contracts/commands.md` com `bootstrap:admin`, `app-credential` e `access:reconcile`, e `docs/CONTRIBUTING.md` com a política de credenciais de aplicação
- [X] T068 [P] Escrever `server/tests/integration/security/no-secrets.test.ts` (CS-008): executa bootstrap, aceite, cadastro de TOTP, login em dois passos, login de produto, criação de credencial de aplicação e troca de senha capturando a saída do pino, as linhas de `security_event` e as respostas; senha, segredo TOTP, códigos TOTP e de recuperação, `INSTANCE_TOKEN` e segredo da credencial de aplicação não aparecem em nenhum deles, exceto nas respostas de exibição única onde são esperados
- [X] T069 Executar o roteiro de [quickstart.md](./quickstart.md) e `npm run verify`, registrando resultados, p95 (T050) e limitações em `specs/002-f01-identidade-contextos/evidence.md`
- [X] T070 Remover o Sync Impact Report do topo de `.specify/memory/constitution.md` antes do commit e, com a evidência de T069, marcar `F01: concluida` em `docs/slices.yaml`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências; T006 antes de T010/T021
- **Foundational (Phase 2)**: depende do Setup — bloqueia todas as histórias. Dentro dela:
  esquema (T007–T010) → primitivas (T011–T019) e projeção (T020–T026) em paralelo → HTTP
  (T027–T029) → sementes (T030)
- **US1 (Phase 3)**: depende da Fase 2; T037 e T038 (proteção da situação do sistema e guarda de
  rota) vêm depois das rotas de autenticação (T036)
- **US2 (Phase 4)**: depende de US1 (login com MFA e reautenticação)
- **US3 (Phase 5)**: depende da Fase 2; independente de US1/US2 (usa sementes e credencial de
  aplicação)
- **US4 (Phase 6)**: depende de US3 (sessões de produto para o contrato local) e de US1 (painel)
- **US5 (Phase 7)**: depende de US1 e US3 (revogação alcança sessões de produto)
- **Polish (Phase 8)**: depende de todas

### User Story Dependencies

```text
Setup → Foundational ─┬─ US1 ─┬─ US2 ───────────────┐
                      │       ├─ US4 (com US3) ─────┼─ Polish
                      └─ US3 ─┴─ US5 (com US1) ─────┘
```

### Within Each User Story

- Testes escritos e observados falhando antes da implementação
- Módulo de domínio → rotas → interface → E2E

### Parallel Opportunities

- Setup: T002, T003, T004, T005
- Fase 2: T009 e T010 em paralelo a T007/T008; T011, T012, T013, T017, T019, T020, T023 e T027
  começam juntos (arquivos distintos)
- US1: T031, T032; T039 em paralelo às rotas; T038 depois de T036
- US3: T047–T050 juntos; US3 pode correr em paralelo a US1/US2
- US4: T054, T055; T058 em paralelo às rotas
- US5: T060, T061; T064 em paralelo às rotas

---

## Parallel Example: User Story 3

```text
Task: "Sessões de produto em server/tests/integration/access/instance-sessions.test.ts"
Task: "Isolamento em server/tests/integration/access/isolation.test.ts"
Task: "Core indisponível em server/tests/integration/access/core-down.test.ts"
Task: "Desempenho em server/tests/integration/access/perf-access.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US3)

1. Setup e Fundação
2. US1 (administrador com MFA) e US3 (contrato de produto com isolamento) — as duas P1 que
   destravam o painel e o futuro Tuteli
3. **STOP and VALIDATE**: quickstart §1 e §3

### Incremental Delivery

1. MVP → US2 (equipe) → US4 (vínculos) → US5 (recuperação e bloqueio) → Polish
2. Cada história fecha com sua suíte de integração verde e o E2E correspondente

---

## Notes

- Commits citam IDs (`COM-*`, `SC-*`, `FR-*`); branch `002-f01-identidade-contextos`
- Nenhuma tarefa toca o Tuteli; o cliente de validação do produto de referência é a
  implementação de referência do contrato de dados
