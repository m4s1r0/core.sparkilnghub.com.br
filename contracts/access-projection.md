# Contrato de dados — projeção de acesso da instância, v1

Decisão D-04; constituição v1.2.0, princípios I, II e III. Este é o contrato que o SparkPet (e,
em F01, o produto de referência) usa para validar cada requisição **sem chamar o Core**. Mudança
incompatível exige `v2` e convivência com `v1` (convenções §1).

## Onde fica

Cada instância tem dois bancos exclusivos, com nomes derivados do mesmo UUID:

| Banco       | Exemplo                  | Conteúdo         |
| ----------- | ------------------------ | ---------------- |
| operacional | `sparkref_0192…0f00`     | dados do produto |
| acesso      | `sparkref_0192…0f00_acc` | esta projeção    |

O banco de acesso é criado pelo provisionador e estruturado pelo artefato do Core
`server/migrations/access_projection/` (histórico `_spark_access_history`), nunca por migração do
produto.

## Privilégios

| Credencial                             | Privilégios no banco de acesso                                           |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `spark_access_writer` (Core)           | `SELECT, INSERT, UPDATE, DELETE` em todas as tabelas                     |
| usuário operacional `inst_*` (produto) | `SELECT` em todas as tabelas; `INSERT` apenas em `access_session_logout` |

O produto **não** consegue criar sessão, alterar vínculo, mudar estado da instância nem desfazer
revogação ou logout (FR-034); tentativas falham por privilégio. O logout do produto só acrescenta
linhas (`INSERT`); sem `UPDATE` nem `DELETE`, um encerramento nunca é desfeito. _(Alternativa
rejeitada: `UPDATE (ended_at, end_reason)` em `access_session` — o MySQL restringe colunas, não
valores, e o produto poderia gravar `ended_at = NULL`.)_

## Tabelas (v1)

### `access_session`

| Coluna                 | Tipo               | Significado                                                                                                           |
| ---------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `id_hash`              | `CHAR(64)` PK      | sha256 hex do `INSTANCE_TOKEN` (o token nunca é armazenado)                                                           |
| `account_id`           | `BINARY(16)`       | conta (UUID)                                                                                                          |
| `membership_id`        | `BINARY(16)`       | vínculo que originou a sessão                                                                                         |
| `created_at`           | `DATETIME(6)` UTC  |                                                                                                                       |
| `last_seen_at`         | `DATETIME(6)` UTC  | o produto pode atualizar? **não** — ver "Atividade"                                                                   |
| `expires_at`           | `DATETIME(6)` UTC  | criação + 12 h (absoluta)                                                                                             |
| `idle_timeout_seconds` | `INT UNSIGNED`     | 7200 em v1                                                                                                            |
| `auth_revision`        | `INT UNSIGNED`     | revisão da conta na criação                                                                                           |
| `ended_at`             | `DATETIME(6)` NULL | encerramento gravado pelo Core (registro; a invalidação vem das colunas do Core em `access_member`/`access_instance`) |
| `end_reason`           | `VARCHAR(32)` NULL | `senha_trocada`, `bloqueio`, `vinculo_revogado`, `suspensao`                                                          |

### `access_session_logout`

| Coluna     | Tipo              | Significado                            |
| ---------- | ----------------- | -------------------------------------- |
| `id_hash`  | `CHAR(64)` PK     | sessão encerrada pelo produto (logout) |
| `ended_at` | `DATETIME(6)` UTC | instante do logout                     |

Logout pelo produto: `INSERT IGNORE INTO access_session_logout (id_hash, ended_at) VALUES
(SHA2(?, 256), UTC_TIMESTAMP(6))`.

### `access_member`

| Coluna                  | Tipo                                  | Significado                   |
| ----------------------- | ------------------------------------- | ----------------------------- |
| `membership_id`         | `BINARY(16)` PK                       |                               |
| `account_id`            | `BINARY(16)`                          | único entre membros `ativo`   |
| `display_name`          | `VARCHAR(120)`                        | nome de exibição (sem e-mail) |
| `role`                  | `ENUM('administrador','colaborador')` |                               |
| `status`                | `ENUM('ativo','revogado')`            |                               |
| `account_status`        | `ENUM('ativa','inativa','bloqueada')` | estado global da conta        |
| `account_auth_revision` | `INT UNSIGNED`                        | revisão atual da conta        |
| `version`               | `INT UNSIGNED`                        | versão do vínculo na fonte    |
| `updated_at`            | `DATETIME(6)` UTC                     |                               |

### `access_instance` (linha única)

| Coluna                   | Tipo                                    | Significado                          |
| ------------------------ | --------------------------------------- | ------------------------------------ |
| `instance_id`            | `BINARY(16)` PK                         | UUID da instância                    |
| `state`                  | `ENUM('ativa','suspensa','manutencao')` | F01 grava `ativa`; F03 usa os demais |
| `authorization_revision` | `INT UNSIGNED`                          | incrementa em suspensão/reativação   |
| `updated_at`             | `DATETIME(6)` UTC                       |                                      |

## Regra de validação (normativa)

Uma requisição com `INSTANCE_TOKEN` é autorizada se, e somente se, a consulta abaixo retornar uma
linha (pseudo-SQL, parâmetros em `?`):

```sql
SELECT s.account_id, m.display_name, m.role, m.membership_id, i.authorization_revision
  FROM access_session s
  JOIN access_member m ON m.membership_id = s.membership_id
  JOIN access_instance i ON TRUE
 WHERE s.id_hash = SHA2(?, 256)          -- ou sha256 calculado no produto
   AND s.ended_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM access_session_logout l WHERE l.id_hash = s.id_hash)
   AND s.expires_at > UTC_TIMESTAMP(6)
   AND s.last_seen_at > UTC_TIMESTAMP(6) - INTERVAL s.idle_timeout_seconds SECOND
   AND s.auth_revision = m.account_auth_revision
   AND m.status = 'ativo'
   AND m.account_status = 'ativa'
   AND i.state = 'ativa';
```

Qualquer outro resultado → `401` (sessão inválida) sem distinguir o motivo ao navegador.

## Atividade (inatividade de 2 h)

Em v1 o produto **não** escreve `last_seen_at`. A inatividade é medida pelo Core: o produto chama
`POST /internal/v1/instances/{slug}/sessions/touch` com o token no máximo uma vez a cada 5 minutos
por sessão, e o Core atualiza `last_seen_at`. Se o Core estiver indisponível, a sessão segue válida
até a janela de inatividade vencer (FR-028). _(Alternativa avaliada e rejeitada: conceder ao produto
`UPDATE (last_seen_at)` — permitiria estender sessões indefinidamente.)_

## Garantias do Core

1. Sessão só é criada depois de conferir senha, vínculo `ativo`, conta `ativa` e instância `ativa`.
2. Revogação de vínculo grava `access_member.status = 'revogado'` e encerra as sessões daquele
   vínculo **antes** de a operação ser dada como concluída para a instância. Toda revogação do
   Core é refletida em coluna que o produto não altera (`access_member.status`,
   `account_status`, `account_auth_revision`, `access_instance.state`); `ended_at` nunca é a
   única barreira.
3. Troca de senha e bloqueio incrementam `account_auth_revision`/`account_status` em todas as
   instâncias onde a conta tem vínculo, invalidando sessões existentes pela regra acima.
4. Instância inacessível: pendência em `access_sync_job`, repetida pelo trabalhador, visível no
   painel; nunca informada como concluída antes de gravada.
5. Divergência entre a projeção e a fonte é corrigida a favor da fonte por reconciliação
   (`npm run access:reconcile -- <slug>` ou tarefa `reconciliar`), com registro. A restauração de
   backup da instância (`T-16`, fatia de restauração) usará a reconciliação antes de liberar acesso.
6. Escritas na projeção usam uma conexão por banco de acesso, sem `USE`; uma tarefa de
   sincronização nunca escreve fora da instância a que pertence.
