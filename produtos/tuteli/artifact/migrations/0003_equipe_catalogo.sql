-- Equipe (profissionais/recursos), catálogo de serviços, estoque e modelos de pacote
-- (seções 4.4, 4.5, 5.1, 9.1 do escopo).
CREATE TABLE recurso (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nome VARCHAR(80) NOT NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY recurso_situacao (situacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-006: profissional separado de usuário; pode não ter login.
CREATE TABLE profissional (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  vinculo_usuario_id BINARY(16) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY profissional_situacao (situacao),
  KEY profissional_usuario (vinculo_usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Expediente padrão e bloqueios pontuais/recorrentes de profissional ou recurso (SP-035).
CREATE TABLE expediente_padrao (
  id BINARY(16) NOT NULL PRIMARY KEY,
  profissional_id BINARY(16) NULL,
  recurso_id BINARY(16) NULL,
  dia_semana TINYINT UNSIGNED NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim TIME NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY expediente_padrao_profissional (profissional_id, dia_semana),
  KEY expediente_padrao_recurso (recurso_id, dia_semana),
  CONSTRAINT expediente_padrao_dia CHECK (dia_semana BETWEEN 0 AND 6),
  CONSTRAINT expediente_padrao_horario CHECK (hora_fim > hora_inicio),
  CONSTRAINT expediente_padrao_titular
    CHECK ((profissional_id IS NULL) <> (recurso_id IS NULL)),
  CONSTRAINT expediente_padrao_profissional_fk FOREIGN KEY (profissional_id)
    REFERENCES profissional (id),
  CONSTRAINT expediente_padrao_recurso_fk FOREIGN KEY (recurso_id) REFERENCES recurso (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE agenda_bloqueio (
  id BINARY(16) NOT NULL PRIMARY KEY,
  profissional_id BINARY(16) NULL,
  recurso_id BINARY(16) NULL,
  inicio DATETIME(6) NOT NULL,
  fim DATETIME(6) NOT NULL,
  motivo VARCHAR(300) NULL,
  recorrente BOOLEAN NOT NULL DEFAULT FALSE,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY agenda_bloqueio_profissional (profissional_id, inicio, fim),
  KEY agenda_bloqueio_recurso (recurso_id, inicio, fim),
  CONSTRAINT agenda_bloqueio_intervalo CHECK (fim > inicio),
  CONSTRAINT agenda_bloqueio_titular CHECK ((profissional_id IS NULL) <> (recurso_id IS NULL)),
  CONSTRAINT agenda_bloqueio_profissional_fk FOREIGN KEY (profissional_id)
    REFERENCES profissional (id),
  CONSTRAINT agenda_bloqueio_recurso_fk FOREIGN KEY (recurso_id) REFERENCES recurso (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-020/SP-021: serviço com variação por porte/pelagem; regra padrão explícita.
CREATE TABLE servico (
  id BINARY(16) NOT NULL PRIMARY KEY,
  codigo VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome VARCHAR(120) NOT NULL,
  descricao VARCHAR(500) NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  preco_base_centavos INT UNSIGNED NOT NULL,
  duracao_base_min SMALLINT UNSIGNED NOT NULL,
  prazo_retorno_dias SMALLINT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY servico_codigo (codigo),
  KEY servico_situacao (situacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE servico_variante (
  id BINARY(16) NOT NULL PRIMARY KEY,
  servico_id BINARY(16) NOT NULL,
  porte ENUM('padrao','pequeno','medio','grande') NOT NULL DEFAULT 'padrao',
  pelagem ENUM('padrao','curta','media','longa') NOT NULL DEFAULT 'padrao',
  preco_centavos INT UNSIGNED NOT NULL,
  duracao_min SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY servico_variante_regra (servico_id, porte, pelagem),
  CONSTRAINT servico_variante_servico_fk FOREIGN KEY (servico_id) REFERENCES servico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE profissional_servico (
  profissional_id BINARY(16) NOT NULL,
  servico_id BINARY(16) NOT NULL,
  PRIMARY KEY (profissional_id, servico_id),
  CONSTRAINT profissional_servico_profissional_fk FOREIGN KEY (profissional_id)
    REFERENCES profissional (id),
  CONSTRAINT profissional_servico_servico_fk FOREIGN KEY (servico_id) REFERENCES servico (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-025/SP-026: item de estoque; SKU pertence a um único tipo.
CREATE TABLE estoque_item (
  id BINARY(16) NOT NULL PRIMARY KEY,
  sku VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome VARCHAR(120) NOT NULL,
  tipo ENUM('revenda','insumo') NOT NULL,
  unidade ENUM('un','ml','g') NOT NULL,
  preco_venda_centavos INT UNSIGNED NULL,
  custo_centavos INT UNSIGNED NULL,
  estoque_minimo DECIMAL(12,3) NOT NULL DEFAULT 0,
  codigo_barras VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  categoria VARCHAR(80) NULL,
  marca VARCHAR(80) NULL,
  fornecedor_referencia VARCHAR(120) NULL,
  observacao VARCHAR(300) NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY estoque_item_sku (sku),
  UNIQUE KEY estoque_item_codigo_barras (codigo_barras),
  KEY estoque_item_tipo (tipo, situacao),
  CONSTRAINT estoque_item_preco_revenda
    CHECK (tipo <> 'revenda' OR preco_venda_centavos IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-067: modelo de pacote (um animal, um serviço elegível).
CREATE TABLE pacote_modelo (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  servico_id BINARY(16) NOT NULL,
  quantidade_creditos SMALLINT UNSIGNED NOT NULL,
  preco_centavos INT UNSIGNED NOT NULL,
  validade_dias SMALLINT UNSIGNED NOT NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY pacote_modelo_servico (servico_id, situacao),
  CONSTRAINT pacote_modelo_servico_fk FOREIGN KEY (servico_id) REFERENCES servico (id),
  CONSTRAINT pacote_modelo_quantidade CHECK (quantidade_creditos > 0),
  CONSTRAINT pacote_modelo_preco CHECK (preco_centavos > 0),
  CONSTRAINT pacote_modelo_validade CHECK (validade_dias BETWEEN 1 AND 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
