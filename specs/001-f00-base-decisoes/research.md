# Research — F00 Base e decisões do SparkCore

**Data**: 2026-10-26 · **Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Este documento resolve os itens abertos do Technical Context e materializa a decisão `D-05`
(tecnologias do servidor, acesso a dados e migrações). `D-05` fica em estado **proposta** até o
responsável técnico aprovar este plano; a aprovação é registrada no ADR `0005` durante a
implementação de F00 (FR-001, CS-002). Versões abaixo são de linha (major/minor); as versões
exatas são fixadas no lockfile na primeira instalação e passam a valer para testes e CI.

## R-01 — Runtime e linguagem do servidor (D-05)

- **Decision**: Node.js 24 LTS, TypeScript 5.9 em modo `strict`, módulos ESM. Execução de
  TypeScript em desenvolvimento por `tsx`; build de produção por `tsc` para JavaScript.
- **Rationale**: `COM-002` exige Node.js; 24 é a LTS ativa e a versão validada pelo design
  system (24.18 na máquina de referência). TypeScript no servidor é a referência de `D-05` e
  permite compartilhar tipos de contrato com a interface.
- **Alternatives considered**: Node 26 (ainda sem histórico LTS suficiente na data); Bun/Deno
  (fora de `COM-002`); executar TS nativamente com type stripping do Node (ainda limitado para
  enums/decorators e sem checagem de tipos — continua necessário `tsc`).

## R-02 — Framework HTTP (D-05)

- **Decision**: Fastify 5 com type provider TypeBox.
- **Rationale**: esquemas JSON por rota validam entrada e serializam saída, e os mesmos esquemas
  geram o OpenAPI e são validados contra o contrato publicado (FR-014, User Story 5); hooks de
  ciclo de vida permitem correlação e tratamento de erro padronizado em um ponto (FR-013, FR-015,
  FR-016); logger pino integrado com redação de campos sensíveis.
- **Alternatives considered**: Express 5 (sem validação/serialização por esquema nativa, exigiria
  montar o mesmo conjunto com mais peças); NestJS (camadas de módulo, DI e decorators acrescentam
  abstração sem necessidade no MVP — princípio VII); Hono (bom, mas ecossistema de plugins de
  servidor Node menor para cookies/sessões de F01).

## R-03 — Acesso a dados MySQL (D-05)

- **Decision**: driver `mysql2` com Kysely 0.28 como construtor de consultas tipado; SQL explícito
  quando necessário (`sql` template). Um pool por par banco/credencial.
- **Rationale**: o Core precisa de pools dinâmicos por instância (princípio I), comandos
  administrativos (`CREATE DATABASE`, `CREATE USER`, `GRANT`) e travas explícitas
  (`SELECT … FOR UPDATE`, `GET_LOCK`) para F02 — tudo direto em Kysely/mysql2, sem engine oculta.
  Tipos gerados a partir do schema evitam divergência entre código e banco.
- **Alternatives considered**: Prisma (cliente gerado por schema único; conexões dinâmicas por
  banco de instância e DDL administrativo ficam fora do modelo); Drizzle (viável, mas o próprio
  migrador não atende aos requisitos de checksum/artefato por produto, ver R-04); Knex (sem
  tipagem forte); TypeORM (padrões ativos/Unit of Work escondem transações e travas).

## R-04 — Migrações e artefato de produto (D-05)

- **Decision**: migrador próprio e pequeno (`server/src/platform/migrations`), que aplica arquivos
  `.sql` ordenados de um diretório com `manifest.json` (versão, nome, sha256), registra em
  `_spark_schema_history` de cada banco e recusa checksum divergente, versão fora de sequência ou
  histórico com versão desconhecida. O mesmo migrador aplica as migrações próprias do Core
  (`spark_core`, `spark_identity`) e os artefatos de produto (referência agora; Tuteli depois).
- **Rationale**: o provisionador de F02 precisa aplicar o artefato de *outro* produto em N bancos,
  com checksum e retomada; isso é o núcleo do domínio do Core, não uma conveniência de
  desenvolvimento. Ferramentas externas resolvem só a metade "migrações do próprio app".
  Constituição: "O Core só executa versões cadastradas, sem aceitar SQL livre".
- **Alternatives considered**: Flyway/Liquibase (runtime Java adicional no artefato de
  implantação); dbmate/Atlas (binários Go adicionais; o Core teria de orquestrá-los por processo
  filho para cada instância); migrador do Kysely (sem checksum nem manifesto de artefato).
- **Restrição registrada**: MySQL faz commit implícito em DDL; cada arquivo de migração é uma
  unidade e o histórico é gravado após o sucesso do arquivo. Migração interrompida deixa a versão
  como `falha` no histórico; a retomada exige verificação (Edge Case "migração interrompida").

## R-05 — MySQL e ambiente local

- **Decision**: MySQL 8.4 LTS (imagem oficial `mysql:8.4`), charset `utf8mb4`, collation
  `utf8mb4_0900_ai_ci`, `sql_mode` padrão estrito, fuso da sessão `+00:00`. Local por Docker
  Compose; CI por service container da mesma imagem.
- **Rationale**: LTS com suporte longo e documentação de referência dos escopos (commit
  implícito, 8.4). Mesma imagem em local e CI garante evidência comparável (FR-021, edge case de
  versão divergente). Docker 26 disponível na máquina de referência.
- **Alternatives considered**: MySQL 9.x Innovation (sem suporte longo); MariaDB (não é MySQL —
  diferenças em JSON, locks e privilégios invalidariam evidências de `COM-003`); instalação nativa
  no Windows (difícil de reproduzir no CI Linux).

## R-06 — Credenciais e privilégios

- **Decision**: cinco identidades MySQL, criadas pelo script de inicialização local e documentadas
  para produção:

  | Usuário | Uso | Privilégios |
  |---|---|---|
  | `spark_core_migrator` | migrações do Core | DDL/DML em `spark_core` e `spark_identity` |
  | `spark_core_web` | servidor HTTP | `SELECT/INSERT/UPDATE/DELETE` em `spark_core` e `spark_identity`; sem DDL |
  | `spark_core_worker` | trabalhador (tarefas, heartbeat) | DML em `spark_core`; sem DDL |
  | `spark_provisioner` | provisionamento de instâncias | `CREATE USER`; todos os privilégios com `GRANT OPTION` apenas em bancos `sparkref\_%` e `sparkpet\_%` |
  | `inst_<hex12>` | operação de uma instância | DML apenas no banco da instância; criado pelo provisionador |

- **Rationale**: FR-008 e constituição ("credencial operacional MUST NOT criar bancos nem alterar
  estrutura"). O padrão de nome nos `GRANT` limita o provisionador aos bancos de produto.
- **Alternatives considered**: um usuário único para tudo (viola FR-008); provisionador com
  privilégio global (risco desnecessário sobre `spark_identity`).

## R-07 — Interface

- **Decision**: Vite 7 + React 19 + TypeScript 5.9 + Tailwind CSS v4 (`@tailwindcss/vite`),
  React Router 7 (modo declarativo) e TanStack Query 5 para estado de servidor. Design system
  `@sparkling-hub/design-system` **0.2.0**, consumido pelo `.tgz` gerado com `npm pack`, copiado
  para `vendor/design-system/` e referenciado como dependência `file:` (integridade no lockfile).
  Em produção o build estático da interface é servido pelo próprio servidor Fastify
  (`@fastify/static`), mesma origem da API.
- **Rationale**: alinhado às peer dependencies e ao toolchain do design system (React 19,
  Tailwind 4, Vite 7) — princípio VIII. Mesma origem simplifica cookies `HttpOnly` de F01 e evita
  CORS. TanStack Query dá estados de carregando/erro/repetição explícitos para a matriz de estados.
- **Alternatives considered**: Next.js/SSR (exigiria fronteira `'use client'`, servidor Node
  separado para a interface e não traz ganho para um painel interno autenticado); depender do
  caminho `../../UX/design-system` (quebra no CI, que só clona este repositório); registro npm
  privado (ainda não existe; pode substituir o `.tgz` sem mudar imports).

## R-08 — Testes e verificação

- **Decision**:
  - Vitest 5 (mesma linha do design system) para testes de regra e integração do servidor e testes de componente da interface
    (Testing Library), alinhado ao design system.
  - Integração contra MySQL real: cada execução cria bancos temporários `t_<runid>_*` com o
    usuário migrador/provisionador e remove somente bancos com esse prefixo e marcador de teste.
  - Contrato: o OpenAPI publicado em `contracts/openapi.yaml` é carregado e as respostas reais são
    validadas com Ajv (formato 2020-12) nos testes de integração.
  - E2E: Playwright — Chromium no CI, Edge local opcional (`channel: msedge`), viewports 360 px e
    1280 px, verificação axe como sinal adicional (sem alegar conformidade).
  - Análise estática: ESLint 9 (flat config) + typescript-eslint em modo type-checked; Prettier.
  - Segredos: gitleaks no CI e por comando local (contêiner).
  - Verificações do repositório (scripts Node): ADRs completos, portão de prontidão por fatia,
    imutabilidade de migrações publicadas (comparação com `main`), duplicação de tokens/estilos do
    design system em `web/src`.
- **Rationale**: FR-017 a FR-021 e princípio V. Testcontainers foi evitado para não ter dois
  mecanismos de banco (compose local + service no CI).
- **Alternatives considered**: Jest (mais lento com ESM/TS); Testcontainers (bom isolamento, mas
  sobrepõe o compose e é mais lento no Windows); Cypress (o design system já usa Playwright).

## R-09 — CI

- **Decision**: GitHub Actions no remoto `m4s1r0/core.sparkilnghub.com.br`, em `pull_request` e
  `push` para `main`, com jobs paralelos: `static` (tipos, lint, formatação, ADR/portão,
  duplicação DS), `secrets` (gitleaks), `test` (unidade + integração + contratos + migrações com
  MySQL 8.4), `e2e` (build, servidor com MySQL, Playwright). Branch protection em `main` exigindo
  os quatro jobs — configuração manual no GitHub, documentada no quickstart.
- **Rationale**: remoto já é GitHub; jobs paralelos mantêm CS-004 (≤ 15 min). O comando local
  `npm run verify` executa as mesmas etapas em sequência (FR-020).
- **Alternatives considered**: CI só local com hook de pre-push (não impede integração sem
  verificação); outro provedor de CI (sem motivo).

## R-10 — Configuração, correlação e logs

- **Decision**: configuração exclusivamente por variáveis de ambiente, validada na inicialização
  com esquema TypeBox; `.env` local ignorado pelo git e `.env.example` versionado sem segredos.
  `SPARK_ENV` ∈ {`development`, `homologation`, `production`} define o que scripts podem fazer.
  Correlação pelo cabeçalho `X-Correlation-Id` (aceito se for UUID válido; senão gerado),
  devolvido em toda resposta e incluído em todo log. Logs JSON (pino) com redação de
  `authorization`, `cookie`, `password`, `secret`, `token`, `dsn`.
- **Rationale**: FR-010, FR-015, FR-016, princípio VI.
- **Alternatives considered**: arquivos de configuração por ambiente versionados (risco de
  segredo no repositório); aceitar qualquer valor de correlação do cliente (permite injeção em
  logs).

## R-11 — Identificadores

- **Decision**: UUID v7 gerado pela aplicação para entidades, armazenado como `BINARY(16)` e
  exposto como texto canônico; nomes de banco de instância usam o UUID sem hífens
  (`sparkref_<32hex>`, `sparkpet_<32hex>`); usuários de instância usam `inst_<12 primeiros hex>`
  mais sufixo de verificação (limite de 32 caracteres do MySQL).
- **Rationale**: ordenação temporal ajuda índices; nome de banco derivado do UUID validado
  (`SC-016`, princípio I), nunca de texto livre.
- **Alternatives considered**: auto-incremento (expõe volume e não serve entre bancos); UUID v4
  em `CHAR(36)` (índices maiores e aleatórios).

## R-12 — Organização do repositório

- **Decision**: npm workspaces com `server/` (API e trabalhador, mesmo pacote e build, dois
  entrypoints), `web/` (interface) e `packages/contracts/` (tipos TypeScript e esquemas
  compartilhados entre servidor e interface). Sem ferramenta de monorepo adicional.
- **Rationale**: `COM-004` e FR-009 (mesmo artefato para servidor e trabalhador); workspaces
  nativos bastam para três pacotes.
- **Alternatives considered**: um único pacote (mistura dependências de build da interface com o
  servidor); Nx/Turborepo (complexidade sem ganho com três pacotes).

## Itens abertos que não bloqueiam F00

- `D-04` permanece proposta (Clarifications da spec); bloqueia implementação de F01/F02.
- Hospedagem de produção, armazenamento de segredos de produção e backup: fora de F00.
- Atualizar o design system além de 0.2.0 segue a regra de governança (registro + testes).
