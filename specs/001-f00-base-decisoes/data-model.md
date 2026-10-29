# Data Model — F00 Base e decisões do SparkCore

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

F00 cria apenas a estrutura mínima para saúde, migrações, ambiente e produto de referência.
Contratantes, produtos, instâncias e tarefas pertencem a F02; contas e sessões, a F01.
Convenções gerais: UUID v7 em `BINARY(16)`; instantes em `DATETIME(6)` UTC; `utf8mb4`.

## Bancos lógicos

| Banco | Dono | Conteúdo em F00 |
|---|---|---|
| `spark_core` | Core | `_spark_schema_history`, `environment_marker`, `worker_heartbeat` |
| `spark_identity` | Core (módulo identidade) | `_spark_schema_history` apenas (baseline vazio) |
| `sparkref_<32hex>` | produto de referência | `_spark_schema_history`, `_spark_instance`, `ref_item` (v2) |

Sem chaves estrangeiras entre bancos.

## Entidades persistidas

### `_spark_schema_history` (em cada banco)

| Campo | Tipo | Regras |
|---|---|---|
| `version` | `INT UNSIGNED` PK | sequencial a partir de 1, sem lacunas |
| `name` | `VARCHAR(120)` | igual ao manifesto |
| `checksum` | `CHAR(64)` | sha256 hex do arquivo SQL normalizado (LF, sem BOM) |
| `artifact` | `VARCHAR(64)` | `spark_core`, `spark_identity` ou código do produto (`sparkref`) |
| `status` | `ENUM('aplicada','falha')` | `falha` bloqueia novas versões até verificação |
| `started_at` / `finished_at` | `DATETIME(6)` | UTC |
| `applied_by` | `VARCHAR(64)` | usuário MySQL e identificador do processo |

Validação: na abertura, o migrador compara histórico × manifesto. Versão registrada ausente no
manifesto, checksum divergente ou status `falha` → recusa com motivo (FR-019, US6 cenário 3).

### `environment_marker` (`spark_core`, linha única)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `TINYINT` PK | sempre 1 |
| `environment` | `ENUM('development','homologation','production')` | gravado na primeira migração a partir de `SPARK_ENV`; imutável depois |
| `synthetic_data` | `BOOLEAN` | `true` somente em development/homologation |
| `created_at` | `DATETIME(6)` | UTC |

Regra: carregar dados sintéticos ou reinicializar exige `SPARK_ENV` e `environment_marker`
coerentes e diferentes de `production`; reinicializar exige `development` (FR-011, FR-028).
Divergência entre variável e marcador → recusa e registro (US7 cenário 3).

### `worker_heartbeat` (`spark_core`)

| Campo | Tipo | Regras |
|---|---|---|
| `worker_id` | `BINARY(16)` PK | UUID v7 gerado na partida do processo |
| `hostname` | `VARCHAR(255)` | |
| `app_version` | `VARCHAR(40)` | versão do artefato |
| `started_at` / `last_seen_at` | `DATETIME(6)` | `last_seen_at` atualizado a cada 10 s |

Derivação de estado do trabalhador na saúde: `SAUDAVEL` se algum `last_seen_at` ≤ 30 s;
`DEGRADADA` se o mais recente estiver entre 30 s e 120 s; `INDISPONIVEL` acima de 120 s ou sem
linhas; `DESCONHECIDA` se o banco não responder. Linhas com mais de 24 h são removidas pelo
próprio trabalhador.

Derivação dos bancos: `INDISPONIVEL` com `DB_UNREACHABLE` se não responder em 2 s;
`INDISPONIVEL` com `SCHEMA_FAILED`, `SCHEMA_CHECKSUM_MISMATCH` ou `SCHEMA_UNKNOWN_VERSION` se o
histórico for incompatível com o manifesto; `DEGRADADA` com `SCHEMA_BEHIND` se a versão aplicada
for menor que a esperada; senão `SAUDAVEL`. O servidor é `SAUDAVEL` sempre que responde.

Estado geral: componentes essenciais são `server`, `spark_core` e `spark_identity`.
`INDISPONIVEL` (HTTP `503`) se algum essencial estiver `INDISPONIVEL` ou `DESCONHECIDA`;
`DEGRADADA` (HTTP `200`) se algum essencial estiver `DEGRADADA` **ou** se o trabalhador não
estiver `SAUDAVEL` — inclusive `INDISPONIVEL`, já que F00 não processa tarefas; senão
`SAUDAVEL`. F02 reavalia o peso do trabalhador quando houver tarefas persistentes.

### `_spark_instance` (banco de instância do produto de referência)

| Campo | Tipo | Regras |
|---|---|---|
| `instance_uuid` | `BINARY(16)` PK | igual ao sufixo do nome do banco |
| `product_code` | `VARCHAR(32)` | `sparkref` |
| `owner_task_uuid` | `BINARY(16)` NULL | preenchido pelo provisionador de F02; nulo em F00 |
| `synthetic` | `BOOLEAN` | `true` em todo banco criado por F00 |
| `created_at` | `DATETIME(6)` | UTC |

Criada pela versão 1 do artefato de referência; o valor é inserido pelo aplicador logo após a
versão 1 (o SQL do artefato não contém UUIDs fixos). É o marcador de propriedade usado em F02.

### `ref_item` (banco de instância, versão 2 do artefato de referência)

Tabela neutra (`id`, `label`, `created_at`) que existe apenas para provar a migração v1 → v2
(US6 cenário 2). Não representa conceito do Tuteli (FR-027).

## Entidades em arquivo (repositório)

### Registro de decisão — `docs/adr/NNNN-<slug>.md`

Frontmatter YAML obrigatório:

| Campo | Regras |
|---|---|
| `id` | `D-01` … ou `ADR-NNNN` para decisões novas |
| `title` | texto |
| `status` | `proposta` · `confirmada` · `substituída` |
| `date` | ISO `YYYY-MM-DD`; obrigatório se `confirmada` |
| `owner` | responsável; obrigatório se `confirmada` |
| `supersedes` / `superseded_by` | ids; `substituída` exige `superseded_by` |
| `requirements` | lista de ids (`COM-*`, `SC-*`, `NFR-*`, `T-*`) |
| `impacts` | lista de especificações e requisitos a revisar (ex.: `[specs/00X-…/spec.md, COM-018]`); obrigatória quando `status: substituída` |

Quais fatias exigem cada decisão fica **apenas** em `docs/slices.yaml` (`requires`), fonte única
do portão; as ADRs não repetem essa informação.

Seções obrigatórias: Contexto, Decisão, Alternativas rejeitadas, Consequências.

Transições: `proposta → confirmada`, `proposta → substituída`, `confirmada → substituída`. A
validação falha para campos ausentes, transição inválida, `confirmada` sem data/responsável ou
`substituída` sem `superseded_by` e `impacts`.

Estado inicial em F00: `D-01`, `D-02`, `D-03` confirmadas (2026-10-26); `D-04` proposta (exigida
por F01 e F02 em `slices.yaml`); `D-05` proposta até aprovação deste plano, depois confirmada.

### Portão de prontidão — `docs/slices.yaml`

Lista de fatias (`F00`, `F01`, `F02`, `F03`, `F08-Core`) com `status`
(`especificando`/`pronta`/`em-implementacao`/`concluida`) e `requires` (ids de decisão).
Validação: uma fatia com status `pronta` ou posterior cujo `requires` contenha decisão não
confirmada → falha (FR-003, US1 cenário 2).

### Manifesto de artefato de migração — `manifest.json`

Ver [contracts/migration-artifact.md](./contracts/migration-artifact.md).

### Conjunto de dados sintéticos — `server/seeds/`

Em F00: marcador de ambiente e uma instância de referência sintética
(`sparkref_<uuid>` com `_spark_instance.synthetic = true`) criada pelo provisionador de
desenvolvimento. Idempotência por UUID fixo de semente declarado no arquivo de seed.
Dados textuais usam domínio reservado `example.test` e o prefixo `[SINTÉTICO]`.
