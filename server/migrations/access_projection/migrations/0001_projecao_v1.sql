-- Projeção de acesso da instância, contrato de dados v1 (contracts/access-projection.md, D-04).
-- Aplicada pelo Core no banco <instância>_acc, com histórico _spark_access_history.
-- Escrita só pelo Core (spark_access_writer); o produto lê tudo e só insere logout.

CREATE TABLE access_session (
  -- sha256 hex do INSTANCE_TOKEN; o token nunca é armazenado.
  id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  membership_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  idle_timeout_seconds INT UNSIGNED NOT NULL,
  auth_revision INT UNSIGNED NOT NULL,
  -- Encerramento gravado pelo Core; a invalidação vem das colunas de access_member e
  -- access_instance, que o produto não altera.
  ended_at DATETIME(6) NULL,
  end_reason VARCHAR(32) NULL,
  KEY access_session_membership (membership_id),
  KEY access_session_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Logout pelo produto: só inserção, nunca desfeito.
CREATE TABLE access_session_logout (
  id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  ended_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_member (
  membership_id BINARY(16) NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  role ENUM('administrador','colaborador') NOT NULL,
  status ENUM('ativo','revogado') NOT NULL,
  account_status ENUM('ativa','inativa','bloqueada') NOT NULL,
  account_auth_revision INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  active_account BINARY(16) AS (IF(status = 'ativo', account_id, NULL)) STORED,
  UNIQUE KEY access_member_active_account (active_account),
  KEY access_member_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE access_instance (
  instance_id BINARY(16) NOT NULL PRIMARY KEY,
  state ENUM('ativa','suspensa','manutencao') NOT NULL,
  authorization_revision INT UNSIGNED NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  -- Linha única.
  singleton TINYINT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY access_instance_singleton (singleton),
  CONSTRAINT access_instance_single CHECK (singleton = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
