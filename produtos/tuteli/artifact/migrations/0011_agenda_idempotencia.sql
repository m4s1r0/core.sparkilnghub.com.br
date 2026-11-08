-- Respostas idempotentes locais ao banco da instância (COM-026, specs/006-agenda-agendamentos).
CREATE TABLE request_idempotency (
  id BINARY(16) NOT NULL PRIMARY KEY,
  actor_id BINARY(16) NOT NULL,
  operation VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  response_body JSON NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  UNIQUE KEY request_idempotency_scope (actor_id, operation, idempotency_key),
  KEY request_idempotency_expiry (expires_at),
  CONSTRAINT request_idempotency_status CHECK (response_status BETWEEN 100 AND 599),
  CONSTRAINT request_idempotency_ttl CHECK (expires_at >= DATE_ADD(created_at, INTERVAL 24 HOUR))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
