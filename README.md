# SparkCore

Sistema interno da Sparkling Hub que administra contratantes, usuários, catálogo de SaaS e o ciclo
de vida das instâncias. É a plataforma de que o SparkPet depende para identidade, autorização,
provisionamento, suspensão e telemetria. Monólito modular em Node.js + TypeScript, MySQL 8.4 e
interface React sobre o design system `@sparkling-hub/design-system`.

Estado atual: fatia **F00 — Base e decisões** (`specs/001-f00-base-decisoes/`).

## Pré-requisitos

- Node.js 24 LTS (`.nvmrc`) e npm 11
- Docker com Compose v2 (MySQL de desenvolvimento)
- Git; Windows (PowerShell) ou Linux

## Começar

```powershell
Copy-Item .env.example .env   # Linux: cp .env.example .env — preencha as senhas locais
npm ci
npm run dev:up
```

`dev:up` sobe o MySQL, aplica migrações e dados sintéticos e inicia servidor, trabalhador e
interface. Ao terminar, mostra "SparkCore saudável" e os endereços:

- Interface: <http://127.0.0.1:5173/>
- Situação do sistema: <http://127.0.0.1:3000/api/v1/system/status>

O roteiro completo de validação está em
[`specs/001-f00-base-decisoes/quickstart.md`](specs/001-f00-base-decisoes/quickstart.md).

## Comandos

| Comando                       | Efeito                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| `npm run dev:up` / `dev:down` | Sobe / para o ambiente local (volume preservado)                        |
| `npm run dev:reset`           | Recria os bancos de desenvolvimento (só `development`)                  |
| `npm run db:migrate`          | Aplica as migrações de `spark_core` e `spark_identity`                  |
| `npm run db:seed`             | Carrega dados sintéticos (só `development`/`homologation`)              |
| `npm run ref:validate`        | Valida o artefato do produto de referência                              |
| `npm run gate -- <fatia>`     | Verifica se a fatia pode entrar em implementação (decisões confirmadas) |
| `npm run verify`              | Todas as etapas da CI, localmente                                       |
| `npm run test:*` / `check:*`  | Etapas isoladas (ver `scripts/verify.ts`)                               |

Contrato dos comandos: [`contracts/commands.md`](specs/001-f00-base-decisoes/contracts/commands.md).

## Onde está cada coisa

| Caminho                           | Conteúdo                                                          |
| --------------------------------- | ----------------------------------------------------------------- |
| `server/`                         | API (Fastify) e trabalhador — mesmo pacote, dois entrypoints      |
| `server/migrations/`              | Migrações do Core, com manifesto e sha256                         |
| `server/reference-product/`       | Produto de referência sintético (`sparkref`)                      |
| `web/`                            | Interface React + Tailwind sobre o design system                  |
| `packages/contracts/`             | Esquemas e tipos compartilhados entre API e interface             |
| `contracts/`                      | Contratos publicados (convenções, OpenAPI, capacidades, artefato) |
| `docs/adr/`, `docs/slices.yaml`   | Decisões de arquitetura e portão de prontidão das fatias          |
| `docs/escopos/`                   | Cópia versionada dos escopos de produto                           |
| `docs/CONTRIBUTING.md`            | Fluxo de branches, revisão, design system e proteção de `main`    |
| `.specify/memory/constitution.md` | Constituição do SparkCore                                         |
