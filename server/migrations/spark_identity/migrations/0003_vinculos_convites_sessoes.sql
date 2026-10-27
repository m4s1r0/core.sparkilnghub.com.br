-- F01: vínculos (fonte), convites, sessões do Core, recuperação, limitação de tentativas,
-- idempotência e eventos de segurança (specs/002-f01-identidade-contextos/data-model.md).

CREATE TABLE membership (
  id BINARY(16) NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  instance_id BINARY(16) NOT NULL,
  role ENUM('administrador','colaborador') NOT NULL,
  status ENUM('ativo','revogado') NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  changed_by BINARY(16) NULL,
  changed_at DATETIME(6) NOT NULL,
  change_reason VARCHAR(500) NULL,
  -- Um vínculo ativo por (conta, instância); revogados não entram na unicidade.
  active_key VARBINARY(32) AS (IF(status = 'ativo', CONCAT(account_id, instance_id), NULL)) STORED,
  UNIQUE KEY membership_active (active_key),
  KEY membership_instance (instance_id, status, role),
  KEY membership_account (account_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE invitation (
  id BINARY(16) NOT NULL PRIMARY KEY,
  target ENUM('plataforma','instancia') NOT NULL,
  instance_id BINARY(16) NULL,
  role VARCHAR(32) NOT NULL,
  email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pendente','aceito','revogado','expirado') NOT NULL,
  -- Convite inicial da instância: conta como caminho de acesso até expirar (FR-021).
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at DATETIME(6) NOT NULL,
  created_by BINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  accepted_by BINARY(16) NULL,
  accepted_at DATETIME(6) NULL,
  revoked_by BINARY(16) NULL,
  revoked_at DATETIME(6) NULL,
  revoke_reason VARCHAR(500) NULL,
  UNIQUE KEY invitation_token (token_hash),
  KEY invitation_target (target, instance_id, email_normalized, status),
  CONSTRAINT invitation_instance CHECK ((target = 'instancia') = (instance_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sessões do painel do Core. IP e agente ficam só em security_event (FR-031).
CREATE TABLE core_session (
  id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  -- Nulo enquanto o segundo fator não foi confirmado (sessão pré-MFA).
  mfa_confirmed_at DATETIME(6) NULL,
  auth_revision INT UNSIGNED NOT NULL,
  ended_at DATETIME(6) NULL,
  end_reason VARCHAR(32) NULL,
  KEY core_session_account (account_id, ended_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_reset (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  used_at DATETIME(6) NULL,
  KEY password_reset_account (account_id, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Fila de pedidos de recuperação para o administrador (D-07). Sem IP (FR-031).
CREATE TABLE recovery_request (
  id BINARY(16) NOT NULL PRIMARY KEY,
  email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  account_id BINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  handled_at DATETIME(6) NULL,
  handled_by BINARY(16) NULL,
  KEY recovery_request_pending (handled_at, created_at),
  KEY recovery_request_email (email_normalized, handled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Limitação de tentativas (research.md R-06). Chaves de origem guardam o sha256 do IP.
CREATE TABLE auth_throttle (
  throttle_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  failures INT UNSIGNED NOT NULL,
  window_started_at DATETIME(6) NOT NULL,
  locked_until DATETIME(6) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotência (COM-026). A resposta fica cifrada porque pode conter link exibido uma vez.
CREATE TABLE idempotency_record (
  scope_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_code SMALLINT UNSIGNED NOT NULL,
  response_enc MEDIUMBLOB NULL,
  key_version TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  KEY idempotency_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Eventos de segurança (FR-030). Somente inserção pela aplicação.
CREATE TABLE security_event (
  id BINARY(16) NOT NULL PRIMARY KEY,
  type VARCHAR(48) NOT NULL,
  actor_account_id BINARY(16) NULL,
  actor_kind ENUM('usuario','sistema','aplicacao') NOT NULL,
  target_account_id BINARY(16) NULL,
  instance_id BINARY(16) NULL,
  result ENUM('sucesso','falha','negado') NOT NULL,
  detail JSON NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(300) NULL,
  created_at DATETIME(6) NOT NULL,
  KEY security_event_created (created_at),
  KEY security_event_target (target_account_id, created_at),
  KEY security_event_type (type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
