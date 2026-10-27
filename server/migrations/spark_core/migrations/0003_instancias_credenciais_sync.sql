-- F01: referência mínima de instância (ampliada em F02), credenciais de aplicação e tarefas de
-- sincronização da projeção de acesso (specs/002-f01-identidade-contextos/data-model.md).

CREATE TABLE instance_ref (
  id BINARY(16) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  slug VARCHAR(63) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  database_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  access_database_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authorization_revision INT UNSIGNED NOT NULL DEFAULT 1,
  synthetic BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY instance_ref_slug (product_code, slug),
  UNIQUE KEY instance_ref_database (database_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Credenciais dos contratos internos (research.md R-09). Só o sha256 do segredo.
CREATE TABLE app_credential (
  id BINARY(16) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  label VARCHAR(120) NOT NULL,
  secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scopes SET('sessions','members') NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  last_used_at DATETIME(6) NULL,
  KEY app_credential_product (product_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Revogações e réplicas pendentes por instância (research.md R-10), processadas pelo
-- trabalhador com lease. A instância alvo é sempre instance_id, nunca o payload.
CREATE TABLE access_sync_job (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  kind ENUM('revogar_sessoes_conta','revogar_vinculo','replicar_vinculo','revisao_instancia','reconciliar') NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pendente','em_execucao','concluido','falhou') NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  lease_until DATETIME(6) NULL,
  last_error VARCHAR(500) NULL,
  created_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  KEY access_sync_job_due (status, next_attempt_at),
  KEY access_sync_job_instance (instance_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
