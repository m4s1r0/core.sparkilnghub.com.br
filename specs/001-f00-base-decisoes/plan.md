# Implementation Plan: F00 — Base e decisões do SparkCore

**Branch**: `001-f00-base-decisoes` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-f00-base-decisoes/spec.md`

## Summary

Montar a fundação do SparkCore: registro das decisões `D-01` a `D-05` com portão de prontidão,
monorepo npm com servidor Node.js/TypeScript (API e trabalhador no mesmo artefato), interface
React 19 + Tailwind v4 sobre `@sparkling-hub/design-system` 0.2.0, MySQL 8.4 local por Docker
Compose com bancos e credenciais separados, migrador próprio com checksums (que também aplicará
artefatos de produto em F02), produto de referência sintético em duas versões, dados sintéticos
com guarda de ambiente, convenções de contrato e o contrato completo de situação operacional,
e verificação automática no GitHub Actions reproduzível localmente. Escolhas de `D-05` e
alternativas em [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (`strict`, ESM) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5 + TypeBox; `mysql2` + Kysely; pino; Vite 7, React 19,
React Router 7, TanStack Query 5, Tailwind CSS v4; `@sparkling-hub/design-system` 0.2.0 (`.tgz`
em `vendor/`)

**Storage**: MySQL 8.4 LTS — `spark_core`, `spark_identity`, `sparkref_<uuid>` (referência)

**Testing**: Vitest 5 (regra, integração com MySQL real, componente), Ajv contra OpenAPI,
Playwright (E2E, 360/1280 px), ESLint 9 + typescript-eslint, Prettier, gitleaks

**Target Platform**: servidor Linux em contêiner (produção futura); desenvolvimento em Windows e
Linux; navegadores evergreen (`NFR-015` homologado em F10)

**Project Type**: aplicação web (API + trabalhador + SPA) em monólito modular

**Performance Goals**: `/api/v1/system/status` p95 ≤ 300 ms local com dependências saudáveis;
verificação completa da CI ≤ 15 min (CS-004)

**Constraints**: sem segredos versionados; credencial web sem DDL; mesma imagem MySQL local e
CI; nenhuma cópia de estilos do design system; nenhum trabalho de SparkPet

**Scale/Scope**: 1 tela, 2 endpoints, 3 bancos lógicos, 5 identidades MySQL, 8 comandos de
repositório, 5 ADRs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio / regra | Como F00 atende | Resultado |
|---|---|---|
| I. Isolamento por instância | Bancos de instância nomeados pelo UUID (`sparkref_<32hex>`); credencial de instância restrita ao próprio banco; pool por banco/credencial; teste de privilégios com duas instâncias de referência | ✅ |
| II. Identidade no servidor | Fora do escopo funcional de F00; nenhuma decisão de acesso no cliente; `/system/status` será protegido em F01 (registrado no OpenAPI) | ✅ (n/a funcional) |
| III. Contratos versionados e mínimos | Convenções v1, catálogo de capacidades, OpenAPI do status validado na CI; artefato de migração especificado e exercido pelo produto de referência | ✅ |
| IV. Idempotência/retomada | Regra publicada nas convenções; migrador registra `falha` e recusa continuar sem verificação; sementes idempotentes | ✅ (implementação plena em F01/F02) |
| V. MySQL real e falhas | Integração e migrações contra MySQL 8.4 real; cenários de indisponibilidade, checksum e sequência testados; testes de alto risco (privilégios, guarda de ambiente, migrador) escritos antes | ✅ |
| VI. Rastreabilidade e privacidade | Requisitos citados em spec, ADRs e testes; logs JSON com correlação e redação; dados sintéticos marcados; gitleaks | ✅ |
| VII. Monólito e escopo | Um pacote de servidor com dois entrypoints; sem broker, microserviços ou orquestrador; nada do SparkPet; complexidade nova justificada abaixo | ✅ |
| VIII. Design system | Pacote 0.2.0 fixado via `.tgz`; página base só com componentes públicos; verificação de duplicação de tokens/CSS; estados mapeados | ✅ |
| Restrições técnicas (`COM-001`–`COM-006`) | React+TS+Tailwind; Node.js; MySQL; monólito; banco por instância (referência); `spark_identity` separado | ✅ |
| D-01..D-04 antes de identidade/provisionamento | D-01..D-03 confirmadas; D-04 proposta bloqueia F01/F02 pelo portão; F00 não implementa nenhum dos dois | ✅ |
| DoR de F00 | Requisitos, decisões da fatia (D-05 neste plano), estados (saúde, ADR), contratos, migrações e cenários definidos | ✅ |

**Pós-design (após Phase 1)**: reavaliado com data-model, contratos e quickstart — sem novas
violações. O migrador próprio é a única peça nova não trivial e está justificado abaixo.

## Project Structure

### Documentation (this feature)

```text
specs/001-f00-base-decisoes/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — inclui D-05
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── conventions.md
│   ├── capabilities.md
│   ├── openapi.yaml
│   ├── migration-artifact.md
│   ├── commands.md
│   └── ui-base-page.md
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
.github/workflows/verify.yml        # jobs static, secrets, test, e2e
compose.yaml                        # mysql:8.4 (porta 3307) + volume
docker/mysql/init/                  # bancos e usuários de desenvolvimento
.env.example
package.json                        # workspaces: server, web, packages/*
contracts/                          # fonte publicada: conventions.md, capabilities.md,
                                    # openapi.yaml, migration-artifact.md (copiados deste plano)
docs/
├── adr/0001-…0005-*.md             # D-01..D-05
├── slices.yaml                     # portão de prontidão
├── escopos/                        # cópia versionada dos escopos 1.0 (FR-004)
└── CONTRIBUTING.md                 # fluxo de branch e revisão (FR-005)
vendor/design-system/sparkling-hub-design-system-0.2.0.tgz
packages/contracts/src/             # tipos/esquemas TypeBox compartilhados (status, erro)
server/
├── src/
│   ├── app/                        # entrypoint HTTP (Fastify), plugins de correlação/erro/log
│   ├── worker/                     # entrypoint do trabalhador (heartbeat em F00)
│   ├── modules/system/             # situação operacional
│   └── platform/
│       ├── config/                 # esquema de ambiente, SPARK_ENV, guarda
│       ├── db/                     # pools por banco/credencial, Kysely
│       └── migrations/             # migrador + validador de artefato
├── migrations/spark_core/          # manifest.json + 0001_*.sql …
├── migrations/spark_identity/
├── reference-product/              # artefato sparkref v1/v2 (contrato migration-artifact)
├── seeds/
└── tests/{unit,integration,contract}/
web/
├── src/{main.tsx,app/,pages/system-status/,api/}
└── tests/{component,e2e}/
scripts/                            # dev-up, dev-reset, gate, verify, check-adr, check-ds
```

**Structure Decision**: monólito modular em npm workspaces. `server/` gera um único artefato com
dois entrypoints (`app`, `worker`) — FR-009/`COM-004`. `web/` é construída para arquivos
estáticos servidos pelo mesmo servidor em produção. `packages/contracts` evita divergência de
tipos entre API e interface. Os contratos deste diretório de especificação são copiados para
`contracts/` na raiz, que passa a ser a fonte publicada validada pela CI.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Migrador próprio (em vez de ferramenta pronta) | O Core precisa aplicar artefatos de *outros produtos* em N bancos, com manifesto, checksum, recusa de construções proibidas e retomada (F02) | Flyway/Liquibase acrescentam runtime Java; dbmate/Atlas exigem binário externo orquestrado por processo filho; migrador do Kysely não tem checksum nem manifesto |
| Três workspaces npm | Separar dependências de build da interface do servidor e compartilhar tipos de contrato | Pacote único mistura toolchains; Nx/Turborepo são mais pesados |

## Riscos e pontos de atenção

- **D-04 em aberto** bloqueia implementação de F01/F02; convém decidir enquanto F00 é
  implementada.
- **Design system em evolução rápida** (0.1.0 → 0.2.0 no mesmo dia): fixar 0.2.0 e atualizar só
  por mudança revisada (governança).
- **Grants com curinga de banco no MySQL 8.4** (`sparkref\_%`) devem ser provados no teste de
  privilégios; se `partial_revokes` estiver ativo, o comportamento muda — manter desativado e
  testado.
- **Windows × Linux**: scripts em Node, finais de linha normalizados (`.gitattributes` com
  `eol=lf` para `.sql`, para o checksum ser estável).
