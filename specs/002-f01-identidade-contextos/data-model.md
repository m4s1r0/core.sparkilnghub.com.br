# Data Model — F01 Identidade e contextos

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

Convenções de F00: UUID v7 em `BINARY(16)`, instantes `DATETIME(6)` UTC, `utf8mb4`, segredos só
como resumo (sha256) ou cifrados com chave externa (AES-256-GCM). Sem chaves estrangeiras entre
bancos; referências entre bancos são UUIDs verificados na aplicação.

## Bancos envolvidos

| Banco | Conteúdo em F01 | Quem escreve |
|---|---|---|
| `spark_identity` | contas, credenciais, MFA, papéis de plataforma, vínculos (fonte), convites, sessões do Core, recuperação, limitação de tentativas, eventos de segurança, idempotência | Core (`spark_core_web`) |
| `spark_core` | `instance_ref`, `app_credential`, `access_sync_job` | Core (web e trabalhador) |
| `<instância>_acc` | projeção de acesso: sessões de produto, réplica de vínculos, estado/revisão da instância | Core (`spark_access_writer`); produto lê e encerra sessões |
| `<instância>` | dados operacionais do produto (inalterado) | produto |

## `spark_identity`

### `account`

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | UUID v7 |
| `email_normalized` | `VARCHAR(254)` UNIQUE | `trim` + minúsculas; pontos e `+sufixo` preservados (`COM-007`) |
| `email_display` | `VARCHAR(254)` | como digitado |
| `display_name` | `VARCHAR(120)` | obrigatório, 1–120 |
| `status` | `ENUM('ativa','inativa','bloqueada')` | ver transições |
| `auth_revision` | `INT UNSIGNED` | incrementa em troca de senha/bloqueio; sessões anteriores ficam inválidas |
| `created_at`, `updated_at` | `DATETIME(6)` | |

Transições: `ativa → bloqueada` (bloqueio global, só plataforma) · `bloqueada → ativa` (plataforma,
com motivo) · `ativa → inativa` (sem vínculos e sem papel de plataforma ativos) · `inativa → ativa`
(novo convite aceito).

### `password_credential`

`account_id` PK · `hash` `VARCHAR(255)` (PHC Argon2id) · `changed_at` · `params_version`.

### `totp_factor`

`account_id` PK · `secret_enc` `VARBINARY(128)` (AES-256-GCM: iv+tag+cifra) · `key_version` ·
`enrolled_at` · `last_step` `BIGINT` (anti-reuso). Pendente de confirmação até o primeiro código
válido: `confirmed_at` nulo.

### `recovery_code`

`id` PK · `account_id` · `code_hash` `CHAR(64)` · `used_at` nulo · índice (`account_id`).

### `platform_role`

`account_id` PK · `role` `ENUM('administrador')` · `status` `ENUM('ativo','inativo')` · `granted_by`
· `granted_at` · `changed_by` · `changed_at` · `change_reason`. Regra: nunca zero linhas `ativo` depois da primeira ativação —
verificada com `SELECT … FOR UPDATE` sobre todas as linhas ativas na mesma transação da inativação
(`COM-020`, `T-05`).

### `membership` (fonte dos vínculos)

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `account_id` | `BINARY(16)` | |
| `instance_id` | `BINARY(16)` | existe em `spark_core.instance_ref` (verificado) |
| `role` | `ENUM('administrador','colaborador')` | papéis de produto (`SP-001`, `SP-002`) |
| `status` | `ENUM('ativo','revogado')` | revogado é terminal; voltar exige novo convite |
| `version` | `INT UNSIGNED` | versão otimista (`COM-027`); replicada |
| `created_by`, `created_at`, `changed_by`, `changed_at`, `change_reason` | | auditoria (`SC-011`) |

Único: (`account_id`, `instance_id`) entre vínculos `ativo`. Regra do último administrador da
instância: revogar/rebaixar trava (`FOR UPDATE`) os vínculos `administrador ativo` da instância e o
convite inicial pendente; recusa se restaria zero caminhos de acesso (`COM-020`, FR-021).

### `invitation`

| Campo | Tipo | Regras |
|---|---|---|
| `id` | `BINARY(16)` PK | |
| `target` | `ENUM('plataforma','instancia')` | |
| `instance_id` | `BINARY(16)` NULL | obrigatório se `instancia` |
| `role` | `VARCHAR(32)` | `administrador` (plataforma) ou papel de produto |
| `email_normalized` | `VARCHAR(254)` | |
| `token_hash` | `CHAR(64)` UNIQUE | sha256 do segredo de 32 bytes |
| `status` | `ENUM('pendente','aceito','revogado','expirado')` | |
| `is_initial` | `BOOLEAN` | convite inicial da instância (conta para o último admin) |
| `expires_at` | `DATETIME(6)` | +48 h |
| `created_by`, `created_at`, `accepted_by`, `accepted_at` | | |
| `revoked_by`, `revoked_at`, `revoke_reason` | | revogação manual ou por reenvio |

Reenvio: o convite pendente anterior do mesmo alvo/e-mail vira `revogado` na mesma transação
(FR-016). Aceite: `FOR UPDATE` no convite; só `pendente` e não expirado.

### `core_session`

`id_hash` `CHAR(64)` PK · `account_id` · `created_at` · `last_seen_at` · `expires_at` (absoluta
+8 h) · `mfa_confirmed_at` · `auth_revision` (da conta na criação) · `ended_at`, `end_reason`
(`logout`, `expirada`, `revogada`, `senha_trocada`, `bloqueio`, `inativacao`). IP e agente ficam só
em `security_event` (FR-031).
Válida se `ended_at` nulo, agora < `expires_at`, agora − `last_seen_at` ≤ 30 min,
`auth_revision` = conta, papel de plataforma ativo.

### `password_reset`

`token_hash` PK · `account_id` · `created_by` · `created_at` · `expires_at` (+30 min) · `used_at`.
Gerar novo invalida os anteriores não usados da conta.

### `recovery_request`

`id` PK · `email_normalized` · `account_id` (nulo se não houver conta) · `created_at` · `handled_at` ·
`handled_by`. Sem IP (FR-031). Só para fila do administrador;
não revela existência da conta. Gerar link de recuperação para a conta preenche `handled_at` dos
pedidos pendentes do mesmo e-mail.

### `auth_throttle`

`throttle_key` `VARCHAR(160)` PK · `failures` · `window_started_at` · `locked_until` (R-06). Chaves de
origem e de e-mail guardam só o resumo (sha256 truncado), nunca o IP ou o e-mail.

### `idempotency_record`

`scope_key` `CHAR(64)` PK (sha256 de ator+contexto+operação+chave) · `request_hash` `CHAR(64)` ·
`status_code` · `response_enc` (AES-256-GCM: a resposta pode conter link exibido uma vez) ·
`key_version` · `created_at` · `expires_at` (+24 h) (`COM-026`).

### `security_event`

`id` PK · `type` (enum de FR-030) · `actor_account_id` NULL · `actor_kind`
(`usuario`/`sistema`/`aplicacao`) · `target_account_id` NULL · `instance_id` NULL · `result`
(`sucesso`/`falha`/`negado`) · `detail` `JSON` (sem segredos) · `correlation_id` · `ip` ·
`user_agent` · `created_at`. Somente inserção pela aplicação: nenhum caminho de código faz
UPDATE/DELETE nesta tabela, verificado por teste. Não é imutabilidade contra um administrador de
infraestrutura (`SC-035`); privilégio por tabela não subtrai o DML que `spark_core_web` tem no banco.

## `spark_core`

### `instance_ref` (mínimo; ampliado em F02)

`id` `BINARY(16)` PK · `product_code` · `slug` `VARCHAR(63)` · `display_name` · `database_name` ·
`access_database_name` · `authorization_revision` `INT UNSIGNED` · `synthetic` · `created_at`.
Único (`product_code`, `slug`).

### `app_credential`

`id` `BINARY(16)` PK · `product_code` · `label` · `secret_hash` `CHAR(64)` · `scopes` `SET('sessions','members')`
· `created_at` · `expires_at` NULL · `revoked_at` NULL · `last_used_at`.

### `access_sync_job`

`id` PK · `instance_id` · `kind` (`revogar_sessoes_conta`, `revogar_vinculo`, `replicar_vinculo`,
`revisao_instancia`, `reconciliar`) · `payload` `JSON` (nunca define a instância alvo: o
trabalhador usa `instance_id` e recusa payload que cite outra instância) · `status` (`pendente`, `em_execucao`, `concluido`,
`falhou`) · `attempts` · `next_attempt_at` · `lease_until` · `last_error` (sanitizado) ·
`created_at`, `finished_at`. Uma linha por instância afetada; o trabalhador processa com lease.

## Banco de acesso da instância — `<instância>_acc` (contrato de dados v1)

Criado pelo artefato `server/migrations/access_projection/` (histórico
`_spark_access_history`). Detalhe normativo em
[contracts/access-projection.md](./contracts/access-projection.md).

| Tabela | Campos principais |
|---|---|
| `access_session` | `id_hash` PK, `account_id`, `membership_id`, `created_at`, `last_seen_at`, `expires_at`, `ended_at`, `end_reason`, `auth_revision` |
| `access_member` | `membership_id` PK, `account_id` (único entre ativos), `display_name`, `role`, `status`, `version`, `account_status`, `account_auth_revision`, `updated_at` |
| `access_session_logout` | `id_hash` PK, `ended_at` — logout do produto, só inserção |
| `access_instance` | linha única: `instance_id`, `state` (`ativa` em F01; F03 acrescenta `suspensa`/`manutencao`), `authorization_revision`, `updated_at` |

Validação pelo produto (uma consulta): sessão com `ended_at` nulo e sem linha em
`access_session_logout`, dentro das expirações
(inatividade 2 h, absoluta 12 h), `auth_revision` igual à do membro, membro `ativo` com
`account_status = 'ativa'` e `access_instance.state = 'ativa'`. Toda revogação do Core é
refletida em coluna que o produto não altera; `ended_at` nunca é a única barreira.

## Estado e regras transversais

- Qualquer revogação incrementa `account.auth_revision` (conta) ou marca o vínculo `revogado`, e é
  replicada em `access_member`/`access_session` de cada instância afetada (R-10).
- Divergência entre réplica e fonte é corrigida a favor da fonte por reconciliação (FR-033, R-10).
- Convite pendente pode ser revogado (`pendente → revogado`); o convite inicial que é o único
  caminho de acesso da instância não pode (FR-021).
- `display_name` é replicado; e-mail nunca é replicado (FR-026).
- Exclusão física: nenhuma; contas e vínculos são inativados/revogados (`COM-028`).
