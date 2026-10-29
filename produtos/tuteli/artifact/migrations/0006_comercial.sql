-- Comanda, itens e conta a receber (SP-049..SP-059, seção 7).
CREATE TABLE comanda (
  id BINARY(16) NOT NULL PRIMARY KEY,
  tutor_id BINARY(16) NULL,
  atendimento_id BINARY(16) NULL,
  status ENUM('rascunho','confirmada','cancelada') NOT NULL DEFAULT 'rascunho',
  desconto_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  total_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  confirmed_at DATETIME(6) NULL,
  canceled_at DATETIME(6) NULL,
  canceled_reason VARCHAR(300) NULL,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY comanda_atendimento (atendimento_id),
  UNIQUE KEY comanda_idempotency (created_by, idempotency_key),
  KEY comanda_tutor (tutor_id, status),
  KEY comanda_status (status, created_at),
  CONSTRAINT comanda_tutor_fk FOREIGN KEY (tutor_id) REFERENCES tutor (id),
  CONSTRAINT comanda_atendimento_fk FOREIGN KEY (atendimento_id) REFERENCES atendimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-049/SP-055: item de serviço avulso, produto, venda de pacote ou utilização de crédito.
CREATE TABLE comanda_item (
  id BINARY(16) NOT NULL PRIMARY KEY,
  comanda_id BINARY(16) NOT NULL,
  tipo ENUM('servico','produto','pacote_venda','pacote_uso') NOT NULL,
  referencia_id BINARY(16) NOT NULL,
  nome_snapshot VARCHAR(120) NOT NULL,
  quantidade DECIMAL(10,3) NOT NULL DEFAULT 1,
  preco_unitario_centavos INT UNSIGNED NOT NULL,
  desconto_centavos INT UNSIGNED NOT NULL DEFAULT 0,
  total_centavos INT UNSIGNED NOT NULL,
  origem VARCHAR(120) NULL,
  KEY comanda_item_comanda (comanda_id),
  KEY comanda_item_referencia (tipo, referencia_id),
  CONSTRAINT comanda_item_comanda_fk FOREIGN KEY (comanda_id) REFERENCES comanda (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-083: débito por comanda; vencimento único definido na confirmação.
CREATE TABLE conta_receber (
  id BINARY(16) NOT NULL PRIMARY KEY,
  comanda_id BINARY(16) NOT NULL,
  responsavel_tutor_id BINARY(16) NOT NULL,
  valor_devido_centavos INT UNSIGNED NOT NULL,
  vencimento DATE NOT NULL,
  situacao ENUM('aberta','parcial','quitada','cancelada') NOT NULL DEFAULT 'aberta',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY conta_receber_comanda (comanda_id),
  KEY conta_receber_responsavel (responsavel_tutor_id, situacao),
  KEY conta_receber_vencimento (situacao, vencimento),
  CONSTRAINT conta_receber_comanda_fk FOREIGN KEY (comanda_id) REFERENCES comanda (id),
  CONSTRAINT conta_receber_tutor_fk FOREIGN KEY (responsavel_tutor_id) REFERENCES tutor (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
