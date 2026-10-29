-- Atendimento: chegada, execução por etapas, pronto e entrega (SP-038..SP-048, seção 6).
CREATE TABLE atendimento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  agendamento_id BINARY(16) NULL,
  animal_id BINARY(16) NOT NULL,
  tutor_id BINARY(16) NOT NULL,
  status ENUM('aguardando','em_atendimento','pronto','entregue','interrompido') NOT NULL
    DEFAULT 'aguardando',
  custodia_aberta BOOLEAN NOT NULL DEFAULT TRUE,
  checklist_entrada JSON NOT NULL,
  usuario_entrada_id BINARY(16) NOT NULL,
  instante_entrada DATETIME(6) NOT NULL,
  instante_pronto DATETIME(6) NULL,
  instante_entregue DATETIME(6) NULL,
  usuario_entrega_id BINARY(16) NULL,
  pessoa_retirou VARCHAR(120) NULL,
  motivo_interrupcao VARCHAR(300) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY atendimento_agendamento (agendamento_id),
  KEY atendimento_animal (animal_id, status),
  KEY atendimento_status (status, instante_entrada),
  CONSTRAINT atendimento_agendamento_fk FOREIGN KEY (agendamento_id)
    REFERENCES agendamento (id),
  CONSTRAINT atendimento_animal_fk FOREIGN KEY (animal_id) REFERENCES animal (id),
  CONSTRAINT atendimento_tutor_fk FOREIGN KEY (tutor_id) REFERENCES tutor (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-040/SP-041: linha do tempo de execução por etapa, interrupção e retomada.
CREATE TABLE atendimento_evento (
  id BINARY(16) NOT NULL PRIMARY KEY,
  atendimento_id BINARY(16) NOT NULL,
  tipo ENUM('chegada','inicio_etapa','fim_etapa','pronto','interrupcao','retomada','entrega')
    NOT NULL,
  etapa ENUM('banho','secagem','tosa','finalizacao') NULL,
  usuario_id BINARY(16) NOT NULL,
  instante DATETIME(6) NOT NULL,
  observacao VARCHAR(300) NULL,
  KEY atendimento_evento_atendimento (atendimento_id, instante),
  CONSTRAINT atendimento_evento_atendimento_fk FOREIGN KEY (atendimento_id)
    REFERENCES atendimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-045: aviso de retirada manual (texto revisável); nunca envio automático no MVP.
CREATE TABLE aviso_retirada (
  atendimento_id BINARY(16) NOT NULL PRIMARY KEY,
  texto VARCHAR(500) NOT NULL,
  situacao ENUM('nao_registrado','aviso_manual_registrado') NOT NULL DEFAULT 'nao_registrado',
  instante DATETIME(6) NULL,
  usuario_id BINARY(16) NULL,
  CONSTRAINT aviso_retirada_atendimento_fk FOREIGN KEY (atendimento_id)
    REFERENCES atendimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-017: ciência do alerta vigente por atendimento; mudança de revisão exige nova ciência.
CREATE TABLE animal_alerta_ciencia (
  id BINARY(16) NOT NULL PRIMARY KEY,
  alerta_id BINARY(16) NOT NULL,
  atendimento_id BINARY(16) NOT NULL,
  revisao_lida INT UNSIGNED NOT NULL,
  usuario_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY animal_alerta_ciencia_unica (alerta_id, atendimento_id),
  CONSTRAINT animal_alerta_ciencia_alerta_fk FOREIGN KEY (alerta_id)
    REFERENCES animal_alerta (id),
  CONSTRAINT animal_alerta_ciencia_atendimento_fk FOREIGN KEY (atendimento_id)
    REFERENCES atendimento (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
