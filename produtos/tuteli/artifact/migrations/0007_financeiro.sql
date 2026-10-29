-- Caixa simples e recebimentos (SP-077..SP-088, seção 10).
CREATE TABLE caixa_sessao (
  id BINARY(16) NOT NULL PRIMARY KEY,
  data_operacional DATE NOT NULL,
  status ENUM('aberto','fechado') NOT NULL DEFAULT 'aberto',
  -- Único caixa aberto por estabelecimento (SP-084); fechado não ocupa o slot único.
  aberto_marcador TINYINT UNSIGNED AS (IF(status = 'aberto', 1, NULL)) STORED,
  abertura_centavos INT UNSIGNED NOT NULL,
  usuario_abertura_id BINARY(16) NOT NULL,
  instante_abertura DATETIME(6) NOT NULL,
  contagem_fechamento_centavos INT UNSIGNED NULL,
  esperado_fechamento_centavos INT NULL,
  diferenca_centavos INT NULL,
  justificativa VARCHAR(300) NULL,
  usuario_fechamento_id BINARY(16) NULL,
  instante_fechamento DATETIME(6) NULL,
  UNIQUE KEY caixa_sessao_aberto (aberto_marcador),
  KEY caixa_sessao_data (data_operacional)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-085: suprimento e sangria, só pelo administrador, sem gerar venda ou pagamento.
CREATE TABLE caixa_lancamento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  caixa_sessao_id BINARY(16) NOT NULL,
  tipo ENUM('suprimento','sangria') NOT NULL,
  valor_centavos INT UNSIGNED NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  usuario_id BINARY(16) NOT NULL,
  instante DATETIME(6) NOT NULL,
  KEY caixa_lancamento_sessao (caixa_sessao_id, instante),
  CONSTRAINT caixa_lancamento_sessao_fk FOREIGN KEY (caixa_sessao_id)
    REFERENCES caixa_sessao (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-077/SP-081: recebimento manual; estorno é novo lançamento, nunca edição do original.
CREATE TABLE recebimento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  comanda_id BINARY(16) NOT NULL,
  caixa_sessao_id BINARY(16) NOT NULL,
  meio ENUM('dinheiro','pix','debito','credito') NOT NULL,
  valor_centavos INT UNSIGNED NOT NULL,
  valor_entregue_centavos INT UNSIGNED NULL,
  troco_centavos INT UNSIGNED NULL,
  usuario_id BINARY(16) NOT NULL,
  instante DATETIME(6) NOT NULL,
  situacao ENUM('registrado','estornado') NOT NULL DEFAULT 'registrado',
  estorno_de_id BINARY(16) NULL,
  motivo_estorno VARCHAR(300) NULL,
  KEY recebimento_comanda (comanda_id, situacao),
  KEY recebimento_caixa (caixa_sessao_id, instante),
  CONSTRAINT recebimento_comanda_fk FOREIGN KEY (comanda_id) REFERENCES comanda (id),
  CONSTRAINT recebimento_caixa_fk FOREIGN KEY (caixa_sessao_id) REFERENCES caixa_sessao (id),
  CONSTRAINT recebimento_estorno_fk FOREIGN KEY (estorno_de_id) REFERENCES recebimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
