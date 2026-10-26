-- Produto de referência sintético (sparkref), versão 1: marcador de identidade da instância.
-- A linha é inserida pelo aplicador logo após esta versão (contracts/migration-artifact.md).
CREATE TABLE _spark_instance (
  instance_uuid BINARY(16) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  owner_task_uuid BINARY(16) NULL,
  synthetic BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
