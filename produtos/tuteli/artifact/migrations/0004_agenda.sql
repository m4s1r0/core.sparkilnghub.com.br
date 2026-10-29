-- Agenda: agendamento com snapshot de preço/duração (SP-029..SP-037, seção 5.2).
CREATE TABLE agendamento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  animal_id BINARY(16) NOT NULL,
  tutor_id BINARY(16) NOT NULL,
  profissional_id BINARY(16) NOT NULL,
  recurso_id BINARY(16) NULL,
  inicio DATETIME(6) NOT NULL,
  fim DATETIME(6) NOT NULL,
  status ENUM('agendado','confirmado','cancelado','faltou','compareceu') NOT NULL
    DEFAULT 'agendado',
  encaixe BOOLEAN NOT NULL DEFAULT FALSE,
  preco_previsto_centavos INT UNSIGNED NOT NULL,
  observacao VARCHAR(500) NULL,
  motivo_cancelamento VARCHAR(300) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY agendamento_profissional (profissional_id, inicio, fim),
  KEY agendamento_recurso (recurso_id, inicio, fim),
  KEY agendamento_animal (animal_id, inicio, fim),
  KEY agendamento_status (status, inicio),
  CONSTRAINT agendamento_intervalo CHECK (fim > inicio),
  CONSTRAINT agendamento_animal_fk FOREIGN KEY (animal_id) REFERENCES animal (id),
  CONSTRAINT agendamento_tutor_fk FOREIGN KEY (tutor_id) REFERENCES tutor (id),
  CONSTRAINT agendamento_profissional_fk FOREIGN KEY (profissional_id)
    REFERENCES profissional (id),
  CONSTRAINT agendamento_recurso_fk FOREIGN KEY (recurso_id) REFERENCES recurso (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-023: snapshot do serviço/variante no momento do agendamento.
CREATE TABLE agendamento_item (
  id BINARY(16) NOT NULL PRIMARY KEY,
  agendamento_id BINARY(16) NOT NULL,
  servico_id BINARY(16) NOT NULL,
  variante_id BINARY(16) NULL,
  nome_snapshot VARCHAR(120) NOT NULL,
  preco_snapshot_centavos INT UNSIGNED NOT NULL,
  duracao_snapshot_min SMALLINT UNSIGNED NOT NULL,
  KEY agendamento_item_agendamento (agendamento_id),
  CONSTRAINT agendamento_item_agendamento_fk FOREIGN KEY (agendamento_id)
    REFERENCES agendamento (id),
  CONSTRAINT agendamento_item_servico_fk FOREIGN KEY (servico_id) REFERENCES servico (id),
  CONSTRAINT agendamento_item_variante_fk FOREIGN KEY (variante_id)
    REFERENCES servico_variante (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
