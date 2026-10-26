---
id: D-05
title: Stack do servidor, acesso a dados, migrações e verificação
status: confirmada
date: 2026-10-26
owner: Marcelo da Silva Rosas (responsável técnico)
requirements: [COM-002, COM-003, NFR-011]
---

## Contexto

Os escopos fixam Node.js (`COM-002`) e MySQL (`COM-003`) e deixam para o plano técnico de F00 a
escolha de framework, acesso a dados, ferramenta de migração e versões (diretrizes §2.2, D-05).
A análise completa está em `specs/001-f00-base-decisoes/research.md` (R-01 a R-12). Plano de F00
aprovado pelo responsável técnico em 2026-10-26, após a validação registrada em
`specs/001-f00-base-decisoes/evidence.md` (tarefa T087).

## Decisão

| Área             | Escolha (versão do lockfile em 2026-10-26)                                      |
| ---------------- | ------------------------------------------------------------------------------- |
| Runtime          | Node.js 24 LTS (24.18), ESM                                                     |
| Linguagem        | TypeScript 5.9.3, `strict`                                                      |
| HTTP             | Fastify 5.12 + `@fastify/type-provider-typebox` 6.3 + TypeBox 1.4               |
| Acesso a dados   | `mysql2` 3.24 + Kysely 0.29; um pool por banco e credencial                     |
| Migrações        | Migrador próprio com manifesto e sha256, que também aplica artefatos de produto |
| Banco            | MySQL 8.4 LTS (`mysql:8.4`), utf8mb4, UTC                                       |
| Logs             | pino 10 em JSON, com redação de campos sensíveis                                |
| Interface        | Vite 7.3, React 19.3, React Router 7.18, TanStack Query 5, Tailwind CSS 4.3     |
| Design system    | `@sparkling-hub/design-system` 0.2.0 via `.tgz` em `vendor/`                    |
| Testes           | Vitest 5, Ajv contra OpenAPI, Playwright 1.64, MySQL real                       |
| Análise estática | ESLint 10.13 + typescript-eslint 8.72, Prettier 3.9, gitleaks                   |
| CI               | GitHub Actions, jobs `static`, `secrets`, `test`, `e2e`                         |

Desvio em relação ao plano: o plano citava ESLint 9; na instalação o ESLint 9 já estava marcado
como sem suporte, e foi adotado o ESLint 10 (compatível com typescript-eslint 8.72). Vite 7 foi
fixado também na raiz para não haver duas versões entre Vitest e a interface.

## Alternativas rejeitadas

- **Express 5**: sem validação e serialização por esquema nativas.
- **NestJS**: camadas e injeção de dependência sem necessidade no MVP (constituição VII).
- **Prisma / TypeORM**: dificultam pools dinâmicos por instância, DDL administrativo e travas
  explícitas.
- **Flyway / Liquibase / dbmate / Atlas**: runtime ou binário externo; não cobrem artefatos de
  outros produtos com manifesto e checksum.
- **MariaDB ou MySQL 9 Innovation**: não é a versão LTS adotada; evidência deixaria de valer.
- **Next.js/SSR**: servidor de interface separado sem ganho para painel interno.

## Consequências

- Versões exatas ficam no `package-lock.json`; atualização relevante exige revisão desta ADR.
- O migrador é código do domínio do Core e precisa de testes próprios contra MySQL real.
- O mesmo MySQL 8.4 roda localmente (Docker Compose) e na CI (service container).
