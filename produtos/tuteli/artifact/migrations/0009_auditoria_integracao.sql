-- Auditoria operacional e outbox de utilização agregada para o SparkCore (SP-096..SP-098).
CREATE TABLE auditoria_evento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  ator_usuario_id BINARY(16) NULL,
  ator_sistema BOOLEAN NOT NULL DEFAULT FALSE,
  acao VARCHAR(48) NOT NULL,
  objeto_tipo VARCHAR(32) NOT NULL,
  objeto_id VARCHAR(64) NOT NULL,
  antes JSON NULL,
  depois JSON NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  instante DATETIME(6) NOT NULL,
  KEY auditoria_evento_objeto (objeto_tipo, objeto_id, instante),
  KEY auditoria_evento_instante (instante)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-098: eventos agregados de utilização; sem valores financeiros ou dados pessoais.
CREATE TABLE utilizacao_outbox (
  id BINARY(16) NOT NULL PRIMARY KEY,
  evento_tipo VARCHAR(48) NOT NULL,
  quantidade INT UNSIGNED NOT NULL DEFAULT 1,
  ocorrido_em DATETIME(6) NOT NULL,
  estado ENUM('pendente','enviado','falha') NOT NULL DEFAULT 'pendente',
  tentativas INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL,
  enviado_em DATETIME(6) NULL,
  KEY utilizacao_outbox_estado (estado, ocorrido_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
