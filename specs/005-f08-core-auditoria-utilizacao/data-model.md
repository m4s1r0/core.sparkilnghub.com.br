# Data Model: F08-Core — Auditoria, utilização e painel do Core

**Branch**: `005-f08-core-auditoria-utilizacao` | **Date**: 2026-10-28

## Tabelas novas

### `instance_usage_batch` (spark_core)

Registra cada lote recebido do produto para fins de auditoria e idempotência.

```sql
CREATE TABLE instance_usage_batch (
  id            BINARY(16)    NOT NULL PRIMARY KEY,
  instance_id   BINARY(16)    NOT NULL,
  batch_id      VARCHAR(36)   NOT NULL,           -- UUID enviado pelo produto
  received_at   DATETIME(6)   NOT NULL,
  events_accepted  INT UNSIGNED NOT NULL DEFAULT 0,
  events_discarded INT UNSIGNED NOT NULL DEFAULT 0,
  UNIQUE KEY uq_instance_batch        (instance_id, batch_id),
  KEY        k_instance_usage_batch   (instance_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**Unicidade**: `(instance_id, batch_id)` — idempotência por lote.

**Retenção**: sem TTL automático no MVP; controlado pelo operador.

---

### `instance_usage_event` (spark_core)

Armazena os eventos de utilização individuais após deduplicação.

```sql
CREATE TABLE instance_usage_event (
  id           BINARY(16)   NOT NULL PRIMARY KEY,
  instance_id  BINARY(16)   NOT NULL,
  event_id     VARCHAR(36)  NOT NULL,          -- UUID do evento no produto
  occurred_at  DATETIME(6)  NOT NULL,          -- instante de ocorrência (fuso produto)
  received_at  DATETIME(6)  NOT NULL,          -- instante de recebimento pelo Core
  kind         VARCHAR(48)  NOT NULL,          -- tipo de evento (ver contrato)
  count        INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_instance_event            (instance_id, event_id),
  KEY        k_instance_event_period      (instance_id, occurred_at),
  KEY        k_instance_event_kind_period (kind, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**Unicidade**: `(instance_id, event_id)` — chave de deduplicação (R-01).

**`kind` válidos (contrato mínimo do produto de referência)**:

| kind | Significado |
|------|-------------|
| `atendimentos_iniciados` | Atendimentos abertos no período |
| `atendimentos_concluidos` | Atendimentos finalizados no período |
| `vendas_confirmadas` | Comandas confirmadas |
| `usuarios_ativos` | Usuários únicos com sessão no período |

O Core aceita `kind` fora desse conjunto (forward compatibility) com log de aviso; mudanças na
semântica de `kind` existentes exigem nova versão de contrato.

---

## Tabelas modificadas

### `app_credential.scopes` (spark_core) — migração 0006

Adicionar `'utilizacao'` ao `SET`:

```sql
ALTER TABLE app_credential
  MODIFY scopes SET('sessions','members','connection','utilizacao') NOT NULL;
```

O escopo `utilizacao` autoriza `POST /internal/v1/instances/{id}/usage-batches`.
Uma credencial pode acumular escopos; a credencial de conexão do produto existente pode
receber `utilizacao` ou uma credencial separada pode ser emitida.

---

### `security_event.ip` / `security_event.user_agent` (spark_identity) — sem alteração de schema

As colunas `ip VARCHAR(45) NULL` e `user_agent VARCHAR(300) NULL` já são `NULL`able (F01).
A limpeza de 180 dias é feita por `UPDATE ... SET ip = NULL, user_agent = NULL WHERE ...`
sem nenhuma alteração de schema (R-03).

---

## Índice novo

### `security_event` (spark_identity) — migração 0005

```sql
ALTER TABLE security_event
  ADD KEY k_security_event_instance (instance_id, created_at);
```

Necessário para as queries de consulta filtradas por instância (R-04).

---

## Migrações

| Banco | Versão atual | Nova versão | Arquivo |
|-------|-------------|-------------|---------|
| `spark_core` | 5 | 6 | `0006_auditoria_utilizacao.sql` |
| `spark_identity` | 3 | 4 | `0004_auditoria_index.sql` |

`spark_core` 0006 contém:
1. `CREATE TABLE instance_usage_batch`
2. `CREATE TABLE instance_usage_event`
3. `ALTER TABLE app_credential MODIFY scopes SET(..., 'utilizacao')`

`spark_identity` 0004 contém:
1. `ALTER TABLE security_event ADD KEY k_security_event_instance (instance_id, created_at)`

---

## Tabelas existentes lidas (sem alteração de schema)

| Tabela | Banco | Usada por |
|--------|-------|-----------|
| `security_event` | spark_identity | US3 (consulta acessos), US6 (limpeza IP) |
| `core_audit_event` | spark_core | US4 (consulta auditoria administrativa) |
| `instance` | spark_core | US2 (painel — estado, schema_version), US1 (validação de estado) |
| `instance_health_check` | spark_core | US2 (último check) |
| `instance_backup_record` | spark_core | US2 (último backup) |
| `admin_task` | spark_core | US2 (provisionamentos pendentes/falhos) |
| `app_credential` | spark_core | US1 (auth da credencial de utilização) |

---

## Invariantes

- **I-01**: Nenhum evento de utilização de instância `A` pode ter `instance_id` de instância `B`;
  verificado pelo confronto da credencial com o `instance_id` do path (constituição I).
- **I-02**: `(instance_id, event_id)` é único em `instance_usage_event`; o Core nunca expõe uma
  contagem maior que o número de eventos únicos recebidos (`CA-SC-011`).
- **I-03**: `security_event` e `core_audit_event` são somente-inserção pela aplicação; nenhuma
  `UPDATE` ou `DELETE` é executado pela aplicação sobre esses registros, exceto a limpeza de
  `ip`/`user_agent` em `security_event` (`SC-035`, `SC-033`).
- **I-04**: A limpeza de IP/agente nunca apaga o evento; `id`, `type`, `actor_account_id`,
  `result`, `created_at` e demais campos permanecem intactos após a limpeza (`SC-033`).
