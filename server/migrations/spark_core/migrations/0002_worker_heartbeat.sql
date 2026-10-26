-- Sinal de vida do trabalhador de tarefas, usado pela situação operacional (FR-012).
CREATE TABLE worker_heartbeat (
  worker_id BINARY(16) NOT NULL PRIMARY KEY,
  hostname VARCHAR(200) NOT NULL,
  app_version VARCHAR(40) NOT NULL,
  started_at DATETIME(6) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  KEY worker_heartbeat_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
