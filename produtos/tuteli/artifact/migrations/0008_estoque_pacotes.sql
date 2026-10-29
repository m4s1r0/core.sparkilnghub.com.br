-- Movimentos de estoque e pacotes pré-pagos com livro de créditos (seções 8 e 9).
CREATE TABLE estoque_movimento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  item_id BINARY(16) NOT NULL,
  quantidade_assinada DECIMAL(12,3) NOT NULL,
  tipo ENUM('entrada','venda','consumo','perda','ajuste','compensacao','devolucao') NOT NULL,
  origem_tipo VARCHAR(40) NOT NULL,
  origem_id BINARY(16) NULL,
  usuario_id BINARY(16) NOT NULL,
  instante DATETIME(6) NOT NULL,
  motivo VARCHAR(300) NULL,
  referencia_compra VARCHAR(120) NULL,
  KEY estoque_movimento_item (item_id, instante),
  -- RN-SP-007: nenhuma baixa/reserva/consumo/compensação se repete para a mesma origem.
  UNIQUE KEY estoque_movimento_origem (tipo, origem_tipo, origem_id),
  CONSTRAINT estoque_movimento_item_fk FOREIGN KEY (item_id) REFERENCES estoque_item (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-068/SP-069: pacote vendido com snapshot imutável do modelo; ativação única ao quitar.
CREATE TABLE pacote_vendido (
  id BINARY(16) NOT NULL PRIMARY KEY,
  pacote_modelo_id BINARY(16) NOT NULL,
  animal_id BINARY(16) NOT NULL,
  tutor_financeiro_id BINARY(16) NOT NULL,
  comanda_id BINARY(16) NOT NULL,
  snapshot_nome VARCHAR(120) NOT NULL,
  snapshot_quantidade SMALLINT UNSIGNED NOT NULL,
  snapshot_preco_centavos INT UNSIGNED NOT NULL,
  snapshot_validade_dias SMALLINT UNSIGNED NOT NULL,
  situacao ENUM('aguardando_quitacao','ativo','esgotado','expirado','bloqueado','cancelado')
    NOT NULL DEFAULT 'aguardando_quitacao',
  primeira_quitacao_at DATETIME(6) NULL,
  validade_fim DATE NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY pacote_vendido_animal (animal_id, situacao),
  KEY pacote_vendido_tutor (tutor_financeiro_id),
  KEY pacote_vendido_comanda (comanda_id),
  CONSTRAINT pacote_vendido_modelo_fk FOREIGN KEY (pacote_modelo_id)
    REFERENCES pacote_modelo (id),
  CONSTRAINT pacote_vendido_animal_fk FOREIGN KEY (animal_id) REFERENCES animal (id),
  CONSTRAINT pacote_vendido_tutor_fk FOREIGN KEY (tutor_financeiro_id) REFERENCES tutor (id),
  CONSTRAINT pacote_vendido_comanda_fk FOREIGN KEY (comanda_id) REFERENCES comanda (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-071/SP-074: livro de créditos (concessão, reserva, liberação, consumo, reversão).
CREATE TABLE pacote_credito_lancamento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  pacote_vendido_id BINARY(16) NOT NULL,
  atendimento_id BINARY(16) NULL,
  tipo ENUM('concessao','reserva','liberacao','consumo','reversao') NOT NULL,
  quantidade SMALLINT NOT NULL,
  origem VARCHAR(120) NULL,
  usuario_id BINARY(16) NOT NULL,
  instante DATETIME(6) NOT NULL,
  KEY pacote_credito_lancamento_pacote (pacote_vendido_id, instante),
  KEY pacote_credito_lancamento_atendimento (atendimento_id),
  CONSTRAINT pacote_credito_lancamento_pacote_fk FOREIGN KEY (pacote_vendido_id)
    REFERENCES pacote_vendido (id),
  CONSTRAINT pacote_credito_lancamento_atendimento_fk FOREIGN KEY (atendimento_id)
    REFERENCES atendimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
