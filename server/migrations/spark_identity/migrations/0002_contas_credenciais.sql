-- F01: contas, credenciais de senha, fator TOTP, códigos de recuperação e papel de plataforma
-- (specs/002-f01-identidade-contextos/data-model.md). Segredos só como resumo ou cifrados.

CREATE TABLE account (
  id BINARY(16) NOT NULL PRIMARY KEY,
  -- trim + minúsculas; pontos e +sufixo preservados (COM-007). Comparação binária: a colação
  -- padrão (ai_ci) igualaria e-mails com e sem acento.
  email_normalized VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  email_display VARCHAR(254) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  status ENUM('ativa','inativa','bloqueada') NOT NULL DEFAULT 'ativa',
  -- Incrementa em troca de senha e bloqueio; sessões com revisão anterior deixam de valer.
  auth_revision INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY account_email (email_normalized),
  CONSTRAINT account_display_name CHECK (CHAR_LENGTH(display_name) BETWEEN 1 AND 120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_credential (
  account_id BINARY(16) NOT NULL PRIMARY KEY,
  -- Formato PHC do Argon2id (research.md R-01).
  hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  params_version TINYINT UNSIGNED NOT NULL,
  changed_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE totp_factor (
  account_id BINARY(16) NOT NULL PRIMARY KEY,
  -- AES-256-GCM: iv (12) + tag (16) + cifra; chave fora do banco (IDENTITY_SECRET_KEY).
  secret_enc VARBINARY(128) NOT NULL,
  key_version TINYINT UNSIGNED NOT NULL,
  enrolled_at DATETIME(6) NOT NULL,
  -- Nulo até o primeiro código válido.
  confirmed_at DATETIME(6) NULL,
  -- Último passo de 30 s aceito: impede reuso do mesmo código.
  last_step BIGINT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE recovery_code (
  id BINARY(16) NOT NULL PRIMARY KEY,
  account_id BINARY(16) NOT NULL,
  code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  used_at DATETIME(6) NULL,
  KEY recovery_code_account (account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE platform_role (
  account_id BINARY(16) NOT NULL PRIMARY KEY,
  role ENUM('administrador') NOT NULL,
  status ENUM('ativo','inativo') NOT NULL,
  granted_by BINARY(16) NULL,
  granted_at DATETIME(6) NOT NULL,
  changed_by BINARY(16) NULL,
  changed_at DATETIME(6) NOT NULL,
  change_reason VARCHAR(500) NULL,
  KEY platform_role_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
