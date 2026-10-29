-- F08-Core: tabelas de recepção de utilização e escopo de credencial
-- (specs/005-f08-core-auditoria-utilizacao/data-model.md)

-- Lotes recebidos do produto: auditoria e idempotência de batch_id.
CREATE TABLE instance_usage_batch (
  id               BINARY(16)    NOT NULL PRIMARY KEY,
  instance_id      BINARY(16)    NOT NULL,
  batch_id         VARCHAR(36)   NOT NULL,
  received_at      DATETIME(6)   NOT NULL,
  events_accepted  INT UNSIGNED  NOT NULL DEFAULT 0,
  events_discarded INT UNSIGNED  NOT NULL DEFAULT 0,
  UNIQUE KEY uq_instance_batch      (instance_id, batch_id),
  KEY        k_instance_usage_batch (instance_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Eventos de utilização individuais após deduplicação por (instance_id, event_id).
CREATE TABLE instance_usage_event (
  id           BINARY(16)   NOT NULL PRIMARY KEY,
  instance_id  BINARY(16)   NOT NULL,
  event_id     VARCHAR(36)  NOT NULL,
  occurred_at  DATETIME(6)  NOT NULL,
  received_at  DATETIME(6)  NOT NULL,
  kind         VARCHAR(48)  NOT NULL,
  count        INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY uq_instance_event            (instance_id, event_id),
  KEY        k_instance_event_period      (instance_id, occurred_at),
  KEY        k_instance_event_kind_period (kind, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Adiciona escopo 'utilizacao' à credencial de aplicação (R-02).
ALTER TABLE app_credential
  MODIFY scopes SET('sessions','members','connection','utilizacao') NOT NULL;

-- Credenciais de utilização são vinculadas a uma instância específica para isolamento (CA-SC-011).
-- Credenciais existentes (connection/sessions/members) mantêm instance_id = NULL (sem quebra).
ALTER TABLE app_credential
  ADD COLUMN instance_id BINARY(16) NULL AFTER product_code,
  ADD KEY k_app_credential_instance (instance_id);
