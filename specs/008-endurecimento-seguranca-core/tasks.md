# Tasks: Endurecimento de segurança — parte SparkCore

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/internal-v1.4.md](./contracts/internal-v1.4.md)

**Tests**: obrigatórios — cada SEC tem teste escrito antes e visto falhando (CS-SEC-010).
Testes novos em `server/tests/{unit,integration/security}/hardening/`.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Configuração nova em `server/src/platform/config/schema.ts` e `load.ts`: `TRUSTED_PROXIES`, `MYSQL_TLS`, `MYSQL_TLS_CA`, `INSTANCE_DB_USER_HOST`; `.env.example` documentado
- [X] T002 [P] Tipos novos de evento (`instancia_divergente`, `login_bloqueado`) em `server/src/modules/identity/security-events.ts`

## Phase 2: Foundational

- [X] T003 Suporte de teste: `appCredential(env, product, scopes, instanceId?)` em `server/tests/support/product.ts`; credencial por instância nos testes existentes que usam `/connection`, `/sessions`, `/members`

## Phase 3: US1 — Credencial por instância (P1) 🎯 MVP — SEC-01

- [X] T004 [US1] Teste `server/tests/integration/security/hardening/instance-credential-isolation.test.ts`: credencial de A pede `/connection`, `/sessions`, `/sessions/touch`, `/members` de B → resposta idêntica à de slug inexistente + evento `instancia_divergente`; credencial por produto recusada
- [X] T005 [US1] `server/src/platform/http/app-credential.ts`: recusar credencial sem instância nos escopos de instância (+ evento)
- [X] T006 [US1] `server/src/modules/internal-api/sessions.ts` `instanceForCredential`: exigir `instance.id === credential.instanceId`; evento de divergência
- [X] T007 [US1] `server/src/modules/app-credentials/app-credentials.ts`: `resolveCredentialInstance`, `bindAppCredential`, listagem com instância
- [X] T008 [US1] `server/src/cli/app-credential.ts`: `--instance`, `bind`, listagem marcando por produto; teste `server/tests/integration/security/hardening/app-credential-cli.test.ts`

## Phase 4: US2 — Papel no touch (P1) — SEC-04

- [X] T009 [US2] Teste `…/hardening/touch-role.test.ts`: touch → 200 `{role, membershipStatus}`; rebaixamento visto no próximo touch
- [X] T010 [US2] `sessions.ts` touch 200 com corpo; `server/reference-product/client.ts` lê o papel

## Phase 5: US3 — Login resistente (P2) — SEC-02, 13, 14

- [X] T011 [P] [US3] Teste `…/hardening/product-login-limits.test.ts`: `clientIp` inválido → 422; teto por credencial → 429 antes do Argon2
- [X] T012 [P] [US3] Teste `…/hardening/trust-proxy.test.ts`: proxy listado → IP do cliente no evento; não listado → socket
- [X] T013 [P] [US3] Teste `…/hardening/progressive-throttle.test.ts`: 10 falhas de X não bloqueiam Y; atraso crescente; 100 falhas → bloqueio + `login_bloqueado`
- [X] T014 [US3] `server/src/modules/identity/throttle.ts`: regra progressiva, `loginPair`, `appCredential`, `loginEmail` 100; `registerFailure` informa regras recém-bloqueadas
- [X] T015 [US3] `login.ts` e `sessions.ts`: regras novas, aviso de bloqueio; `clientIp` ipv4/ipv6
- [X] T016 [US3] `server/src/app/build-app.ts`: `trustProxy` a partir de `TRUSTED_PROXIES`
- [X] T017 [US3] Ajustar `server/tests/integration/identity/throttle.test.ts` à regra nova

## Phase 6: US4 — Só-inserção (P2) — SEC-12

- [X] T018 [US4] Teste `…/hardening/append-only-grants.test.ts`: `UPDATE`/`DELETE` em tabela só-inserção e em `_spark_instance` → erro de privilégio; `INSERT`/`SELECT` ok; tabela nova após migração recebe DML
- [X] T019 [US4] `manifest.ts` + `artifact-validator.ts`: `appendOnlyTables`; testes unitários
- [X] T020 [US4] `server/src/platform/db/grants.ts` `syncOperationalGrants`; chamadas em `apply-artifact.ts`, `provisioning/steps.ts`, `provisioning/migration-steps.ts`
- [X] T021 [US4] CLI `server/src/cli/instances-sync-grants.ts` + script `instances:sync-grants`
- [X] T022 [US4] `produtos/tuteli/artifact/manifest.json` e produto de referência declaram `auditoria`/tabela de teste só-inserção

## Phase 7: US5 — MySQL com TLS e host restrito (P2) — SEC-15

- [X] T023 [US5] Testes `server/tests/unit/hardening/config-tls.test.ts` (fora de dev sem TLS → erro) e `…/hardening/mysql-tls.test.ts` (usuário `REQUIRE SSL` recusa conexão sem TLS)
- [X] T024 [US5] `pools.ts` `ssl`; conta `'user'@'host'` e `REQUIRE SSL` em `grants.ts`/provisionamento; `/connection.tls`
- [X] T025 [US5] `compose.yaml` em `127.0.0.1`

## Phase 8: US6 — Logs, CSV, cabeçalhos, dependências (P3) — SEC-16, 21, 22, 09

- [X] T026 [P] [US6] Teste `server/tests/unit/hardening/log-redaction.test.ts` + serializer em `logger.ts`
- [X] T027 [P] [US6] Teste `server/tests/unit/hardening/csv.test.ts` + `csv.ts`
- [X] T028 [P] [US6] Teste de cabeçalhos em `server/tests/contract/http-security.test.ts` + `server/src/app/plugins/security-headers.ts`
- [X] T029 [US6] `audit:deps` em `package.json`, `scripts/verify.ts`, CI; corrigir achados

## Phase 9: Polish

- [X] T030 Contrato v1.4: `contracts/openapi.yaml`, `CHANGELOG.md`, `access-projection.md`, `commands.md`, `migration-artifact.md`
- [X] T031 [P] `docs/operacao/credenciais-aplicacao.md` (plano de rotação, TLS, proxies)
- [X] T032 `docs/ecossistema/06-conformidade-produtos.md` e `05-baseline-seguranca.md` (situação do Core)
- [X] T033 typecheck, lint, format, unit, integration, contract verdes

## Dependencies

T001–T003 antes de tudo; US1 antes de US2 (mesmo arquivo `sessions.ts`); US3–US6 independentes
entre si; Polish por último.

## Phase 10: Convergence

Avaliação de 2026-11-15 contra spec, plan e tasks (`/speckit-converge`).

- [X] T034 [US1] Edge case "credencial vinculada a instância ENCERRADA ≡ inexistente" (spec, Edge Cases; F03 FR-026): `GET /internal/v1/instances/{slug}/connection` de instância `ENCERRADA` ainda entrega a senha operacional — responder `404 NOT_FOUND` idêntico a slug inexistente em `server/src/modules/internal-api/connection.ts`, com teste em `server/tests/integration/security/hardening/instance-credential-isolation.test.ts` (gap: partial, severidade HIGH)
