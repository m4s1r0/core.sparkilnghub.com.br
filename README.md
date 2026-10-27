# SparkCore

Sistema interno da Sparkling Hub que administra contratantes, usuários, catálogo de SaaS e o ciclo
de vida das instâncias. É a plataforma de que o SparkPet depende para identidade, autorização,
provisionamento, suspensão e telemetria. Monólito modular em Node.js + TypeScript, MySQL 8.4 e
interface React sobre o design system `@sparkling-hub/design-system`.

Estado atual: fatia **F01 — Identidade e contextos** (`specs/002-f01-identidade-contextos/`),
sobre a base de F00 (`specs/001-f00-base-decisoes/`).

## Pré-requisitos

- Node.js 24 LTS (`.nvmrc`) e npm 11
- Docker com Compose v2 (MySQL de desenvolvimento)
- Git; Windows (PowerShell) ou Linux

## Começar

PowerShell:

```powershell
Copy-Item .env.example .env   # depois troque cada __defina__ por uma senha local (8+ caracteres)
npm ci                        # instala e compila packages/contracts
npm run dev:up
```

bash (Linux, macOS ou Git Bash no Windows):

```bash
cp .env.example .env          # depois troque cada __defina__ por uma senha local (8+ caracteres)
npm ci
npm run dev:up
```

As senhas do `.env` só são aplicadas quando o volume do MySQL é criado. Se você trocá-las depois,
recrie o volume com `docker compose down -v` (apaga os dados locais, todos sintéticos).

`dev:up` sobe o MySQL, aplica migrações e dados sintéticos e inicia servidor, trabalhador e
interface. Ao terminar, mostra "SparkCore saudável" e os endereços:

- Interface: <http://127.0.0.1:5173/> (pede login desde F01)
- Situação do sistema: <http://127.0.0.1:3000/api/v1/system/status> (exige sessão de administrador)

Primeiro acesso ao painel (F01): gere o convite do primeiro administrador e abra o link impresso
para definir senha e cadastrar o aplicativo autenticador (TOTP):

```bash
npm run bootstrap:admin -- voce@example.test
```

As sementes criam as instâncias sintéticas A e B do produto de referência e as contas
`ana`, `bruno` e `carla@example.test` (senha em `SEED_USER_PASSWORD` do `.env`), além de uma
credencial de aplicação do `sparkref` impressa uma única vez pelo `db:seed`.

Ao atualizar um ambiente criado em F00: rode `npm run dev:up` (reaplica o init do MySQL e cria o
usuário `spark_access_writer`) e acrescente ao `.env` as variáveis novas do `.env.example`
(`MYSQL_ACCESS_WRITER_PASSWORD`, `IDENTITY_SECRET_KEY`, `PUBLIC_ORIGIN`, `SEED_USER_PASSWORD`).

Roteiros de validação: F00 em
[`specs/001-f00-base-decisoes/quickstart.md`](specs/001-f00-base-decisoes/quickstart.md) e F01 em
[`specs/002-f01-identidade-contextos/quickstart.md`](specs/002-f01-identidade-contextos/quickstart.md).

## Comandos

| Comando                                          | Efeito                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm run dev:up` / `dev:down`                    | Sobe / para o ambiente local (volume preservado)                        |
| `npm run dev:reset`                              | Recria os bancos de desenvolvimento (só `development`)                  |
| `npm run db:migrate`                             | Aplica as migrações de `spark_core` e `spark_identity`                  |
| `npm run db:seed`                                | Carrega dados sintéticos (só `development`/`homologation`)              |
| `npm run ref:validate`                           | Valida o artefato do produto de referência                              |
| `npm run gate -- <fatia>`                        | Verifica se a fatia pode entrar em implementação (decisões confirmadas) |
| `npm run bootstrap:admin -- <email>`             | Convite do primeiro administrador da plataforma (link exibido uma vez)  |
| `npm run app-credential -- create\|revoke\|list` | Credenciais de aplicação dos contratos internos                         |
| `npm run access:reconcile -- <slug>`             | Recalcula a projeção de acesso de uma instância a partir da fonte       |
| `npm run verify`                                 | Todas as etapas da CI, localmente                                       |
| `npm run test:*` / `check:*`                     | Etapas isoladas (ver `scripts/verify.ts`)                               |

Contrato dos comandos: [`contracts/commands.md`](contracts/commands.md).

## Onde está cada coisa

| Caminho                                | Conteúdo                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `server/`                              | API (Fastify) e trabalhador — mesmo pacote, dois entrypoints                                    |
| `server/migrations/`                   | Migrações do Core, com manifesto e sha256                                                       |
| `server/reference-product/`            | Produto de referência sintético (`sparkref`) e cliente de validação                             |
| `server/migrations/access_projection/` | Projeção de acesso aplicada no banco `<instância>_acc` (D-04)                                   |
| `web/`                                 | Interface React + Tailwind sobre o design system                                                |
| `packages/contracts/`                  | Esquemas e tipos compartilhados entre API e interface                                           |
| `contracts/`                           | Contratos publicados (convenções, OpenAPI, capacidades, artefato, projeção de acesso, comandos) |
| `docs/adr/`, `docs/slices.yaml`        | Decisões de arquitetura e portão de prontidão das fatias                                        |
| `docs/escopos/`                        | Cópia versionada dos escopos de produto                                                         |
| `docs/CONTRIBUTING.md`                 | Fluxo de branches, revisão, design system e proteção de `main`                                  |
| `.specify/memory/constitution.md`      | Constituição do SparkCore                                                                       |
