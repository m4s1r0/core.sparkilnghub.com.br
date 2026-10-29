-- Tuteli (código imutável do catálogo: sparkpet), versão 1: marcador de identidade da
-- instância (contracts/migration-artifact.md) e configuração do estabelecimento (seção 4.1 do
-- escopo). O aplicador insere a linha de `_spark_instance` logo após esta versão.
CREATE TABLE _spark_instance (
  instance_uuid BINARY(16) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  owner_task_uuid BINARY(16) NULL,
  synthetic BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Configuração do estabelecimento (SP-007, SP-008). Dados administrativos do contratante e
-- estado da instância permanecem sob controle do Core; aqui só operação local.
CREATE TABLE instancia_config (
  instance_uuid BINARY(16) NOT NULL PRIMARY KEY,
  nome_exibicao VARCHAR(120) NOT NULL,
  contato VARCHAR(254) NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  expediente JSON NULL,
  bloqueios_recorrentes JSON NULL,
  meios_pagamento_permitidos SET('dinheiro','pix','debito','credito') NOT NULL
    DEFAULT 'dinheiro,pix,debito,credito',
  estoque_minimo_padrao DECIMAL(12,3) NOT NULL DEFAULT 0,
  prazo_retorno_padrao_dias SMALLINT UNSIGNED NULL,
  identificacao_comprovante VARCHAR(200) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  CONSTRAINT instancia_config_instance_fk FOREIGN KEY (instance_uuid)
    REFERENCES _spark_instance (instance_uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
