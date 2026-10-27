-- F02: contratantes, catálogo, instância completa (ex-instance_ref), recursos, transições,
-- tarefas de provisionamento e auditoria administrativa
-- (specs/003-f02-catalogo-provisionamento/data-model.md).

CREATE TABLE contractor (
  id BINARY(16) NOT NULL PRIMARY KEY,
  legal_name VARCHAR(200) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  -- Derivado de legal_name para alertar homônimos (research.md R-13); nunca vem do cliente.
  name_key VARCHAR(200) NOT NULL,
  person_type ENUM('fisica','juridica') NOT NULL,
  document_type ENUM('cpf','cnpj') NULL,
  document_normalized VARCHAR(14) CHARACTER SET ascii COLLATE ascii_bin NULL,
  contact_name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(13) CHARACTER SET ascii COLLATE ascii_bin NULL,
  address JSON NULL,
  status ENUM('ativo','inativo') NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by BINARY(16) NULL,
  updated_by BINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY contractor_document (document_type, document_normalized),
  KEY contractor_name_key (name_key),
  KEY contractor_status (status, display_name),
  CONSTRAINT contractor_document_type CHECK (
    (document_type IS NULL AND document_normalized IS NULL)
    OR (document_type = 'cpf' AND person_type = 'fisica')
    OR (document_type = 'cnpj' AND person_type = 'juridica'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Catálogo. Provisionador e artefato vêm do código implantado (research.md R-14).
CREATE TABLE product (
  code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(280) NOT NULL,
  status ENUM('ativo','inativo') NOT NULL,
  reference_only BOOLEAN NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  updated_by BINARY(16) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO product (code, name, description, status, reference_only, version, created_at, updated_at)
VALUES ('sparkpet', 'SparkPet', 'Gestão de pet shops: agenda, atendimento, comanda e estoque.',
        'ativo', FALSE, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));

-- Produto e contratante de referência só onde já existem instâncias sintéticas de F01
-- (o marcador de ambiente de F00 impede dados sintéticos em produção).
INSERT INTO product (code, name, description, status, reference_only, version, created_at, updated_at)
SELECT 'sparkref', '[SINTÉTICO] Produto de referência',
       'Produto sintético que prova os contratos do Core; não é oferecido como SaaS.',
       'ativo', TRUE, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
  FROM DUAL WHERE EXISTS (SELECT 1 FROM instance_ref WHERE synthetic = TRUE);

INSERT INTO contractor (id, legal_name, display_name, name_key, person_type, contact_name, email,
                        status, version, created_at, updated_at)
SELECT UNHEX('0192f6000000700080000000000000c1'), '[SINTÉTICO] Contratante de referência',
       '[SINTÉTICO] Contratante de referência', 'sintetico contratante de referencia', 'juridica',
       '[SINTÉTICO] Contato', 'contato@example.test', 'ativo', 1, UTC_TIMESTAMP(6),
       UTC_TIMESTAMP(6)
  FROM DUAL WHERE EXISTS (SELECT 1 FROM instance_ref WHERE synthetic = TRUE);

RENAME TABLE instance_ref TO instance;

ALTER TABLE instance
  RENAME INDEX instance_ref_slug TO instance_slug,
  RENAME INDEX instance_ref_database TO instance_database,
  MODIFY product_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD contractor_id BINARY(16) NULL AFTER id,
  ADD timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo' AFTER display_name,
  ADD initial_admin_email VARCHAR(254) NULL AFTER timezone,
  ADD state ENUM('CADASTRADA','PROVISIONANDO','FALHA_PROVISIONAMENTO','PRONTA','ATIVA','SUSPENSA',
                 'MANUTENCAO','ENCERRADA') NOT NULL DEFAULT 'CADASTRADA' AFTER initial_admin_email,
  ADD schema_version INT UNSIGNED NULL AFTER authorization_revision,
  ADD notes TEXT NULL,
  ADD valid_from DATE NULL,
  ADD valid_until DATE NULL,
  ADD version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD created_by BINARY(16) NULL,
  ADD updated_at DATETIME(6) NULL,
  ADD KEY instance_contractor (contractor_id, state),
  ADD KEY instance_state (state, created_at),
  ADD KEY instance_product (product_code, state),
  ADD CONSTRAINT instance_validity CHECK (valid_until IS NULL OR valid_from IS NULL
                                          OR valid_until >= valid_from);

-- Instâncias sintéticas de F01 já operavam sessões: ficam ATIVA (research.md R-18).
UPDATE instance
   SET contractor_id = UNHEX('0192f6000000700080000000000000c1'), state = 'ATIVA',
       updated_at = created_at
 WHERE synthetic = TRUE;
UPDATE instance SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE instance
  MODIFY contractor_id BINARY(16) NOT NULL,
  MODIFY state ENUM('CADASTRADA','PROVISIONANDO','FALHA_PROVISIONAMENTO','PRONTA','ATIVA','SUSPENSA',
                    'MANUTENCAO','ENCERRADA') NOT NULL,
  MODIFY updated_at DATETIME(6) NOT NULL,
  ADD CONSTRAINT instance_contractor_fk FOREIGN KEY (contractor_id) REFERENCES contractor (id),
  ADD CONSTRAINT instance_product_fk FOREIGN KEY (product_code) REFERENCES product (code);

-- Tarefa estrutural persistente (research.md R-03, R-04).
CREATE TABLE admin_task (
  id BINARY(16) NOT NULL PRIMARY KEY,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instance_id BINARY(16) NOT NULL,
  kind ENUM('provisionamento') NOT NULL,
  status ENUM('pendente','em_execucao','aguardando_repeticao','concluida','falhou') NOT NULL,
  -- Uma tarefa estrutural ativa por instância (RN-SC-002).
  active_instance_key BINARY(16) AS (
    IF(status IN ('pendente','em_execucao','aguardando_repeticao'), instance_id, NULL)) STORED,
  current_step VARCHAR(32) NULL,
  run_number INT UNSIGNED NOT NULL DEFAULT 1,
  attempt INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at DATETIME(6) NOT NULL,
  lease_until DATETIME(6) NULL,
  worker_id BINARY(16) NULL,
  artifact_code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  artifact_version INT UNSIGNED NOT NULL,
  manifest_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_by BINARY(16) NOT NULL,
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(300) NULL,
  created_at DATETIME(6) NOT NULL,
  started_at DATETIME(6) NULL,
  finished_at DATETIME(6) NULL,
  UNIQUE KEY admin_task_seq (seq),
  UNIQUE KEY admin_task_active (active_instance_key),
  UNIQUE KEY admin_task_idempotency (requested_by, idempotency_key),
  KEY admin_task_due (status, next_attempt_at),
  KEY admin_task_instance (instance_id, created_at),
  CONSTRAINT admin_task_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Uma linha por tentativa de etapa; linhas fechadas nunca são alteradas.
CREATE TABLE admin_task_step_run (
  id BINARY(16) NOT NULL PRIMARY KEY,
  task_id BINARY(16) NOT NULL,
  run_number INT UNSIGNED NOT NULL,
  step ENUM('validar','reservar','criar_bancos','criar_credencial','aplicar_migracoes','configurar',
            'preparar_convite','verificar','concluir') NOT NULL,
  attempt INT UNSIGNED NOT NULL,
  status ENUM('em_execucao','concluida','falhou','interrompida','ignorada') NOT NULL,
  worker_id BINARY(16) NULL,
  started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL,
  duration_ms INT UNSIGNED NULL,
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(300) NULL,
  KEY admin_task_step_run_task (task_id, run_number, started_at),
  CONSTRAINT admin_task_step_run_task_fk FOREIGN KEY (task_id) REFERENCES admin_task (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Recursos físicos da instância, com intenção gravada antes de cada efeito (research.md R-06).
CREATE TABLE instance_resource (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  kind ENUM('banco_operacional','banco_acesso','usuario_mysql') NOT NULL,
  identifier VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pretendido','criado','verificado') NOT NULL,
  -- Só usuario_mysql: senha cifrada com INSTANCE_SECRET_KEY, AAD = UUID da instância (R-09).
  secret_enc VARBINARY(512) NULL,
  secret_key_version TINYINT UNSIGNED NULL,
  owner_task_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY instance_resource_kind (instance_id, kind),
  UNIQUE KEY instance_resource_identifier (identifier, kind),
  CONSTRAINT instance_resource_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id),
  CONSTRAINT instance_resource_task_fk FOREIGN KEY (owner_task_id) REFERENCES admin_task (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Transições de estado (RN-SC-001). Só inclusão pela aplicação.
CREATE TABLE instance_transition (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  from_state VARCHAR(24) NULL,
  to_state VARCHAR(24) NOT NULL,
  actor_kind ENUM('usuario','sistema') NOT NULL,
  actor_id BINARY(16) NULL,
  reason VARCHAR(500) NULL,
  task_id BINARY(16) NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(6) NOT NULL,
  KEY instance_transition_instance (instance_id, created_at),
  CONSTRAINT instance_transition_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO instance_transition (id, instance_id, from_state, to_state, actor_kind, reason,
                                 created_at)
SELECT UNHEX(REPLACE(UUID(), '-', '')), id, NULL, 'ATIVA', 'sistema', 'migracao_f01',
       UTC_TIMESTAMP(6)
  FROM instance WHERE synthetic = TRUE;

-- Auditoria administrativa do Core (SC-034, research.md R-16). Só inclusão pela aplicação.
CREATE TABLE core_audit_event (
  id BINARY(16) NOT NULL PRIMARY KEY,
  actor_kind ENUM('usuario','sistema') NOT NULL,
  actor_id BINARY(16) NULL,
  action VARCHAR(48) NOT NULL,
  object_type VARCHAR(32) NOT NULL,
  object_id VARCHAR(64) NOT NULL,
  changes JSON NULL,
  reason VARCHAR(500) NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(6) NOT NULL,
  KEY core_audit_event_object (object_type, object_id, created_at),
  KEY core_audit_event_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Escopo do contrato de conexão da instância (research.md R-10).
ALTER TABLE app_credential MODIFY scopes SET('sessions','members','connection') NOT NULL;
