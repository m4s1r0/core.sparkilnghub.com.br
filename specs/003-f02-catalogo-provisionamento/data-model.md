# Data Model — F02 Catálogo e provisionamento

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Convenções de F00/F01: UUID v7 em `BINARY(16)`, instantes `DATETIME(6)` UTC, `utf8mb4` com
`utf8mb4_0900_ai_ci`, segredos só como resumo (sha256) ou cifrados com chave externa (AES-256-GCM,
`KeyRing`). Sem chaves estrangeiras entre bancos; dentro de `spark_core`, integridade referencial
normal.

## Bancos envolvidos

| Banco | Mudança em F02 | Quem escreve |
|---|---|---|
| `spark_core` | migração 0004: contratantes, catálogo, instância completa, recursos, transições, tarefas, auditoria; escopo `connection` | web (cadastros, solicitação, emissão) e trabalhador (etapas, transições) |
| `spark_identity` | migração 0004: `invitation.link_issued_at` | web (emissão) e trabalhador (convite inicial preparado) |
| `<prefixo><uuid>` | criado pelo provisionador; artefato do produto + `_spark_instance` | trabalhador (`spark_provisioner`) |
| `<prefixo><uuid>_acc` | criado pelo provisionador; projeção de acesso **v2** | trabalhador (criação), `spark_access_writer` (conteúdo) |

## `spark_core`

### `contractor` (novo)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | UUID v7 |
| `legal_name` | `VARCHAR(200)` | obrigatório, 2–200, nome ou razão social |
| `display_name` | `VARCHAR(120)` | obrigatório, 2–120 |
| `name_key` | `VARCHAR(200)` INDEX | derivado de `legal_name` (R-13); nunca enviado pelo cliente |
| `person_type` | `ENUM('fisica','juridica')` | obrigatório |
| `document_type` | `ENUM('cpf','cnpj')` NULL | igual a `cpf` se física, `cnpj` se jurídica, quando houver documento |
| `document_normalized` | `VARCHAR(14)` NULL | CPF 11 dígitos; CNPJ 14 posições (12 alfanuméricas + 2 dígitos); maiúsculas |
| `contact_name` | `VARCHAR(120)` | obrigatório |
| `email` | `VARCHAR(254)` | obrigatório, formato de e-mail; **não** é único |
| `phone` | `VARCHAR(13)` NULL | só dígitos, 10–13 |
| `address` | `JSON` NULL | `{cep, logradouro, numero, complemento, bairro, cidade, uf}`, todos texto curto; `uf` em 27 siglas |
| `status` | `ENUM('ativo','inativo')` | ver transições |
| `version` | `INT UNSIGNED` | versão otimista (`COM-027`) |
| `created_by`, `updated_by` | `BINARY(16)` | conta do administrador (`NULL` só para dados de migração) |
| `created_at`, `updated_at` | `DATETIME(6)` | |

Índices: `UNIQUE (document_type, document_normalized)` (nulos permitidos), `KEY (name_key)`,
`KEY (status, display_name)`.

Transições: `ativo → inativo` somente se nenhuma instância do contratante está `ATIVA`
(`SC-006`; verificado com `SELECT … FOR UPDATE` nas instâncias do contratante, na mesma transação)
· `inativo → ativo` (com motivo). Ambas auditadas.

### `product` (novo)

| Campo | Tipo | Regras |
|---|---|---|
| `code` | `VARCHAR(16)` PK | `^[a-z][a-z0-9]{2,15}$`, imutável; igual ao `productCode` do artefato |
| `name` | `VARCHAR(80)` | obrigatório |
| `description` | `VARCHAR(280)` | descrição curta |
| `status` | `ENUM('ativo','inativo')` | inativo bloqueia novas solicitações (`SC-008`) |
| `reference_only` | `BOOLEAN` | `TRUE` para `sparkref`; filtrado em produção (R-14) |
| `version` | `INT UNSIGNED` | versão otimista |
| `created_at`, `updated_at`, `updated_by` | | |

Campos **calculados** na leitura (não gravados): `provisioner` (identificador do registro em
código ou `null`), `deployedVersion` (maior versão do artefato implantado),
`supportedSchemaVersion` (mesma versão; F03 poderá distinguir), `provisionable` e
`notProvisionableReason` (`SEM_PROVISIONADOR`, `ARTEFATO_INVALIDO`, `PRODUTO_INATIVO`,
`AMBIENTE_NAO_PERMITIDO`).

Dados iniciais (migração 0004): `sparkpet` (`SparkPet`, ativo, sem provisionador). `sparkref` só
quando existem instâncias sintéticas de F01; as sementes o criam nos demais ambientes sintéticos.

### `instance` (renomeada de `instance_ref` e ampliada)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | UUID v7 gerado pelo servidor; imutável |
| `contractor_id` | `BINARY(16)` FK `contractor.id` | obrigatório; imutável (`RN-SC-005`) |
| `product_code` | `VARCHAR(16)` FK `product.code` | imutável |
| `slug` | `VARCHAR(63)` ascii_bin | normalizado (R-05); imutável após criação; `UNIQUE (product_code, slug)` |
| `display_name` | `VARCHAR(120)` | editável com auditoria |
| `timezone` | `VARCHAR(64)` | identificador IANA da lista suportada; padrão `America/Sao_Paulo` |
| `initial_admin_email` | `VARCHAR(254)` | normalizado como em F01 (`COM-007`) |
| `state` | `ENUM('CADASTRADA','PROVISIONANDO','FALHA_PROVISIONAMENTO','PRONTA','ATIVA','SUSPENSA','MANUTENCAO','ENCERRADA')` | só pelo serviço de transição (R-02) |
| `database_name` | `VARCHAR(64)` ascii_bin UNIQUE | `<prefixo><uuid sem hífens>`, definido na criação |
| `access_database_name` | `VARCHAR(64)` ascii_bin | `<database_name>_acc` |
| `authorization_revision` | `INT UNSIGNED` | F01 |
| `schema_version` | `INT UNSIGNED` NULL | última versão do artefato aplicada |
| `notes` | `TEXT` NULL | anotações administrativas, até 4 000 caracteres |
| `valid_from`, `valid_until` | `DATE` NULL | vigência opcional; `valid_until ≥ valid_from` |
| `synthetic` | `BOOLEAN` | F01 |
| `version` | `INT UNSIGNED` | versão otimista de `display_name`, `notes` e vigência |
| `created_by` | `BINARY(16)` NULL | administrador que solicitou (`NULL` em dados de migração) |
| `created_at`, `updated_at` | `DATETIME(6)` | |

Índices novos: `KEY (contractor_id, state)`, `KEY (state, created_at)`, `KEY (product_code,
state)`. "Pendência de vigência" é calculada: `valid_until < data local de hoje` no fuso da
instância.

#### Máquina de estados (F02)

```text
CADASTRADA ──(trabalhador assume a tarefa)──▶ PROVISIONANDO ──(verificação ok)──▶ PRONTA
                                                   │                                 │
                                    (falha não transitória ou                    (F03: ativar,
                                     tentativas esgotadas)                         encerrar)
                                                   ▼
                                       FALHA_PROVISIONAMENTO ──(nova execução, MFA)──▶ PROVISIONANDO
```

`ATIVA`, `SUSPENSA`, `MANUTENCAO` e `ENCERRADA` existem no tipo, mas só as instâncias sintéticas de
F01 (por migração e sementes) chegam a `ATIVA` nesta fatia. Login de produto exige `ATIVA`.

### `instance_resource` (novo)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `instance_id` | `BINARY(16)` FK | |
| `kind` | `ENUM('banco_operacional','banco_acesso','usuario_mysql')` | `UNIQUE (instance_id, kind)` |
| `identifier` | `VARCHAR(64)` ascii_bin UNIQUE | nome do banco ou do usuário, derivado do UUID |
| `status` | `ENUM('pretendido','criado','verificado')` | intenção gravada **antes** do efeito (R-06) |
| `secret_enc` | `VARBINARY(512)` NULL | só `usuario_mysql`: senha cifrada (R-09) |
| `secret_key_version` | `TINYINT UNSIGNED` NULL | versão da `INSTANCE_SECRET_KEY` |
| `owner_task_id` | `BINARY(16)` FK `admin_task.id` | tarefa que registrou a intenção |
| `created_at`, `updated_at` | | |

Um recurso pertence a uma única instância (`SC-021`, FR-032). Nunca é apagado pela aplicação.

### `instance_transition` (novo, só inclusão)

`id` · `instance_id` FK · `from_state` (NULL na criação) · `to_state` · `actor_kind`
`ENUM('usuario','sistema')` · `actor_id` `BINARY(16)` NULL (conta ou tarefa) · `reason`
`VARCHAR(500)` · `task_id` NULL · `correlation_id` · `created_at`. Índice `(instance_id,
created_at)`.

### `admin_task` (novo)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `seq` | `BIGINT UNSIGNED` AUTO_INCREMENT UNIQUE | protocolo `PRV-` + 6 dígitos |
| `instance_id` | `BINARY(16)` FK | |
| `kind` | `ENUM('provisionamento')` | F03 amplia (`migracao`, `restauracao`) |
| `status` | `ENUM('pendente','em_execucao','aguardando_repeticao','concluida','falhou')` | ver abaixo |
| `active_instance_key` | `BINARY(16)` AS (IF(status IN ('pendente','em_execucao','aguardando_repeticao'), instance_id, NULL)) STORED, UNIQUE | uma tarefa estrutural ativa por instância (`RN-SC-002`) |
| `current_step` | `VARCHAR(32)` NULL | etapa em andamento ou que falhou |
| `run_number` | `INT UNSIGNED` | 1 na criação; +1 a cada nova execução manual |
| `attempt` | `INT UNSIGNED` | tentativa da etapa atual nesta execução (máx. `PROVISIONING_MAX_ATTEMPTS`, padrão 5) |
| `next_attempt_at` | `DATETIME(6)` | espera progressiva (R-08) |
| `lease_until` | `DATETIME(6)` NULL | 60 s, renovado a cada 20 s |
| `worker_id` | `BINARY(16)` NULL | trabalhador com o lease (F00 `worker_heartbeat`) |
| `artifact_code`, `artifact_version`, `manifest_sha256` | | fixados na criação (R-07) |
| `requested_by` | `BINARY(16)` | conta que solicitou |
| `idempotency_key` | `CHAR(36)` | `UNIQUE (requested_by, idempotency_key)` (R-04) |
| `request_hash` | `CHAR(64)` | sha256 do corpo canônico |
| `error_code` | `VARCHAR(64)` NULL | código estável da última falha |
| `error_message` | `VARCHAR(300)` NULL | texto seguro; sem SQL, nomes de usuário MySQL ou senha |
| `created_at`, `started_at`, `finished_at` | | |

Transições: `pendente → em_execucao` (lease obtido) · `em_execucao → aguardando_repeticao` (falha
transitória com tentativas restantes) → `em_execucao` · `em_execucao → concluida` · `em_execucao →
falhou` (não transitória ou tentativas esgotadas) · `falhou → pendente` (nova execução manual,
`run_number + 1`, `attempt = 0`). Lease vencido em `em_execucao` → outro trabalhador assume.

### `admin_task_step_run` (novo, só inclusão + fechamento)

`id` · `task_id` FK · `run_number` · `step` `ENUM('validar','reservar','criar_bancos',
'criar_credencial','aplicar_migracoes','configurar','preparar_convite','verificar','concluir')` ·
`attempt` · `status` `ENUM('em_execucao','concluida','falhou','interrompida','ignorada')`
(`ignorada` = efeito já verificado na retomada) · `worker_id` · `started_at` · `finished_at` ·
`duration_ms` · `error_code` · `error_message`. Uma linha por tentativa; linhas de execuções
anteriores nunca são alteradas depois de fechadas. Índice `(task_id, run_number, started_at)`.

### `core_audit_event` (novo, só inclusão)

`id` · `actor_kind` `ENUM('usuario','sistema')` · `actor_id` NULL · `action` `VARCHAR(48)`
(`contratante.criado`, `contratante.editado`, `contratante.inativado`, `contratante.reativado`,
`produto.editado`, `produto.inativado`, `produto.reativado`, `instancia.solicitada`,
`instancia.editada`, `provisionamento.repetido`, `instancia.transicao`,
`convite_inicial.emitido`) · `object_type` · `object_id` · `changes` JSON (`{campo: [anterior,
novo]}`, nunca segredo, documento só mascarado `***.***.***-12`) · `reason` NULL ·
`correlation_id` · `created_at`. Índices `(object_type, object_id, created_at)` e `(created_at)`.

### `app_credential` (alterada)

`scopes` passa a `SET('sessions','members','connection')`. Credenciais existentes não ganham o
novo escopo automaticamente; `npm run app-credential -- create sparkref … --scopes
sessions,members,connection`.

## `spark_identity`

### `invitation` (alterada)

| Campo novo | Tipo | Regras |
|---|---|---|
| `link_issued_at` | `DATETIME(6)` NULL | `NULL` = convite inicial preparado pela tarefa, link nunca exibido; preenchido na emissão. Convites criados por pessoas (F01) recebem o instante da criação. |

Situação do convite inicial exibida no painel (calculada): `aguardando_emissao` (pendente e
`link_issued_at` nulo) · `emitido` (pendente, emitido, não expirado) · `expirado` (pendente e
`expires_at ≤ agora`, ou `expirado`) · `aceito` · `revogado`.

## Banco operacional da instância (`<prefixo><uuid>`)

Inalterado em relação ao contrato do artefato v1 (F00). A linha de `_spark_instance` passa a
receber `owner_task_uuid` = tarefa de provisionamento. Configuração obrigatória do produto de
referência = o próprio marcador (UUID, produto, sintético); o fuso e o nome de exibição ficam no
Core (o SparkPet definirá no seu artefato as configurações que exige, no mesmo passo 6).

## Banco de acesso (`<prefixo><uuid>_acc`) — projeção v2

| Mudança | Detalhe |
|---|---|
| `access_instance.state` | `ENUM('pronta','ativa','suspensa','manutencao')`; o provisionamento grava `pronta` |

Compatível com a v1: a regra normativa de validação continua exigindo `state = 'ativa'`
([access-projection-v2.md](./contracts/access-projection-v2.md)).

## Validações (resumo, FR → regra)

| FR | Regra | Onde |
|---|---|---|
| FR-002 | CPF/CNPJ (inclusive alfanumérico) com DV válido; único | servidor (`contractors/document.ts`) + índice único |
| FR-005 | inativar só sem instância `ATIVA` | transação com `FOR UPDATE` |
| FR-008 | produto provisionável | registro de provisionadores + `validateArtifact` |
| FR-012 | slug normalizado, 3–63, reservado recusado, único por produto | servidor + índice único |
| FR-015 | fuso na lista suportada | servidor |
| FR-016 | `valid_until ≥ valid_from` | servidor + `CHECK` |
| FR-018 | mesma chave e mesmo resumo → mesmo resultado; resumo diferente → 409 | `admin_task` |
| FR-019 | uma instância por `(produto, slug)` | índice único |
| FR-024 | uma tarefa estrutural ativa por instância | índice único sobre coluna gerada + lease |
| FR-037 | versão otimista | `UPDATE … WHERE version = ?` |
