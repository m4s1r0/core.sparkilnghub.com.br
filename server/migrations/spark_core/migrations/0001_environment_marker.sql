-- Marcador do ambiente deste conjunto de bancos (data-model.md). Linha única, gravada pelo
-- db:migrate na primeira aplicação e nunca alterada pela aplicação.
CREATE TABLE environment_marker (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  environment ENUM('development','homologation','production') NOT NULL,
  synthetic_data BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL,
  CONSTRAINT environment_marker_singleton CHECK (id = 1),
  CONSTRAINT environment_marker_synthetic CHECK (synthetic_data = FALSE OR environment <> 'production')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
