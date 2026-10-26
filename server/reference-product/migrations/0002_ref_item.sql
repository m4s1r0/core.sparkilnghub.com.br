-- Produto de referência sintético (sparkref), versão 2: tabela neutra que só prova a migração
-- v1 → v2. Não representa nenhum conceito do SparkPet.
CREATE TABLE ref_item (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY ref_item_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
