-- Pacote sold snapshots, credit history origins, reservation state, and package-linked sale lines.

ALTER TABLE comanda_item
  ADD COLUMN pacote_modelo_id BINARY(16) NULL;
ALTER TABLE comanda_item
  ADD COLUMN pacote_animal_id BINARY(16) NULL;
ALTER TABLE comanda_item
  ADD UNIQUE KEY comanda_item_id_comanda (id, comanda_id);
ALTER TABLE comanda_item
  ADD KEY comanda_item_pacote_modelo (pacote_modelo_id);
ALTER TABLE comanda_item
  ADD KEY comanda_item_pacote_animal (pacote_animal_id);
ALTER TABLE comanda_item
  ADD CONSTRAINT comanda_item_pacote_modelo_fk FOREIGN KEY (pacote_modelo_id)
    REFERENCES pacote_modelo (id);
ALTER TABLE comanda_item
  ADD CONSTRAINT comanda_item_pacote_animal_fk FOREIGN KEY (pacote_animal_id)
    REFERENCES animal (id);

CREATE TABLE pacote_reserva (
  id BINARY(16) NOT NULL PRIMARY KEY,
  pacote_vendido_id BINARY(16) NOT NULL,
  agendamento_item_id BINARY(16) NOT NULL,
  situacao ENUM('reservado','liberado','consumido') NOT NULL,
  agendamento_item_reservado BINARY(16)
    GENERATED ALWAYS AS (
      CASE WHEN situacao = 'reservado' THEN agendamento_item_id ELSE NULL END
    ) STORED,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  UNIQUE KEY pacote_reserva_ativa_item (agendamento_item_reservado),
  UNIQUE KEY pacote_reserva_id_pacote (id, pacote_vendido_id),
  KEY pacote_reserva_pacote_situacao (pacote_vendido_id, situacao, updated_at),
  KEY pacote_reserva_agendamento_item (agendamento_item_id, situacao),
  CONSTRAINT pacote_reserva_pacote_fk FOREIGN KEY (pacote_vendido_id)
    REFERENCES pacote_vendido (id),
  CONSTRAINT pacote_reserva_agendamento_item_fk FOREIGN KEY (agendamento_item_id)
    REFERENCES agendamento_item (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE comanda_item
  ADD COLUMN pacote_reserva_id BINARY(16) NULL;
ALTER TABLE comanda_item
  ADD KEY comanda_item_pacote_reserva (pacote_reserva_id);
ALTER TABLE comanda_item
  ADD CONSTRAINT comanda_item_pacote_reserva_fk FOREIGN KEY (pacote_reserva_id)
    REFERENCES pacote_reserva (id);
ALTER TABLE comanda_item
  ADD CONSTRAINT comanda_item_pacote_contexto CHECK (
    (tipo = 'pacote_venda'
      AND pacote_modelo_id IS NOT NULL
      AND pacote_animal_id IS NOT NULL
      AND pacote_reserva_id IS NULL
      AND referencia_id = pacote_modelo_id)
    OR
    (tipo = 'pacote_uso'
      AND pacote_modelo_id IS NULL
      AND pacote_animal_id IS NULL
      AND pacote_reserva_id IS NOT NULL
      AND preco_unitario_centavos = 0
      AND desconto_centavos = 0
      AND total_centavos = 0)
    OR
    (tipo NOT IN ('pacote_venda','pacote_uso')
      AND pacote_modelo_id IS NULL
      AND pacote_animal_id IS NULL
      AND pacote_reserva_id IS NULL)
  );

ALTER TABLE pacote_vendido
  ADD COLUMN comanda_item_id BINARY(16) NULL;
ALTER TABLE pacote_vendido
  ADD UNIQUE KEY pacote_vendido_comanda_item (comanda_item_id);
ALTER TABLE pacote_vendido
  ADD KEY pacote_vendido_item_comanda (comanda_item_id, comanda_id);
ALTER TABLE pacote_vendido
  ADD CONSTRAINT pacote_vendido_item_comanda_fk
    FOREIGN KEY (comanda_item_id, comanda_id)
    REFERENCES comanda_item (id, comanda_id);

ALTER TABLE pacote_credito_lancamento
  ADD COLUMN origem_tipo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL;
ALTER TABLE pacote_credito_lancamento
  ADD COLUMN origem_id BINARY(16) NULL;
ALTER TABLE pacote_credito_lancamento
  ADD COLUMN pacote_reserva_id BINARY(16) NULL;
ALTER TABLE pacote_credito_lancamento
  ADD COLUMN motivo VARCHAR(300) NULL;

UPDATE pacote_credito_lancamento
SET origem_tipo = 'legacy', origem_id = id
WHERE origem_tipo IS NULL OR origem_id IS NULL;

ALTER TABLE pacote_credito_lancamento
  MODIFY COLUMN tipo ENUM(
    'concessao','reserva','liberacao','consumo','reversao',
    'bloqueio','reativacao','cancelamento'
  ) NOT NULL;
ALTER TABLE pacote_credito_lancamento
  MODIFY COLUMN origem_tipo VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
ALTER TABLE pacote_credito_lancamento
  MODIFY COLUMN origem_id BINARY(16) NOT NULL;
ALTER TABLE pacote_credito_lancamento
  MODIFY COLUMN quantidade INT NOT NULL;
ALTER TABLE pacote_credito_lancamento
  ADD UNIQUE KEY pacote_credito_origem (tipo, pacote_vendido_id, origem_tipo, origem_id);
ALTER TABLE pacote_credito_lancamento
  ADD KEY pacote_credito_reserva (pacote_reserva_id, instante);
ALTER TABLE pacote_credito_lancamento
  ADD CONSTRAINT pacote_credito_reserva_fk
    FOREIGN KEY (pacote_reserva_id, pacote_vendido_id)
    REFERENCES pacote_reserva (id, pacote_vendido_id);
