# Data model — Endurecimento de segurança (Core)

Sem migração de schema: as colunas necessárias já existem.

## `spark_core.app_credential` (existente)

| Campo | Mudança |
| --- | --- |
| `instance_id` | Passa a ser **obrigatório na prática** para escopos `connection`, `sessions`, `members` (validado na CLI e na autenticação). Deve apontar para instância do mesmo `product_code`. |

Regras: `bind` só grava `instance_id` se estiver nulo e a instância for do produto da credencial.

## `spark_identity.auth_throttle` (existente)

Chaves novas (resumo sha256 de e-mail/IP, como hoje):

| Chave | Regra |
| --- | --- |
| `login-pair:<digest(email)>:<digest(origem)>` | progressiva: a partir de 5 falhas consecutivas, `locked_until = now + min(15 min, 1 s·2^(n−5))` |
| `login:<digest(email)>` | 100 falhas consecutivas → 15 min (antes: 10) |
| `app-cred:<credencialId>` | 300 falhas em 15 min → 15 min |

## `spark_identity.security_event` (existente, `type VARCHAR(48)`)

Tipos novos: `instancia_divergente` (credencial pediu instância que não é a sua), `login_bloqueado`
(bloqueio total de conta por volume; `target_account_id` = titular). `credencial_aplicacao` ganha
uso com `result = negado` e `detail.motivo = "sem_instancia"`.

## Manifesto do artefato (`manifest.json`, formatVersion 1)

| Campo | Regras |
| --- | --- |
| `appendOnlyTables` | opcional; lista de nomes `^[a-z][a-z0-9_]{0,63}$`, sem repetição, sem prefixo `_spark_`; cada tabela precisa aparecer em `CREATE TABLE` de alguma migração |

## Privilégios da credencial operacional `inst_*` no banco da instância

| Objeto | Antes | Depois |
| --- | --- | --- |
| `<db>.*` | `SELECT, INSERT, UPDATE, DELETE` | `SELECT` |
| tabela comum | — | `INSERT, UPDATE, DELETE` |
| tabela só-inserção | — | `INSERT` |
| `_spark_*` | (pelo nível de banco) | só `SELECT` (do nível de banco) |
| conta | `'inst_x'@'%'` | `'inst_x'@'<INSTANCE_DB_USER_HOST>'`, `REQUIRE SSL` se `MYSQL_TLS ≠ off` |
