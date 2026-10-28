-- F03: ciclo e operação da instância — admin_task ganha o tipo de tarefa "migracao" e as etapas
-- correspondentes; três tabelas novas só inclusão (saúde, backup, encerramento)
-- (specs/004-f03-ciclo-operacao-instancia/data-model.md). `instance.state`, `admin_task` e
-- `admin_task_step_run` já existem desde F02; aqui só ampliamos os ENUMs.

ALTER TABLE admin_task
  MODIFY kind ENUM('provisionamento','migracao') NOT NULL;

ALTER TABLE admin_task_step_run
  MODIFY step ENUM('validar','reservar','criar_bancos','criar_credencial','aplicar_migracoes',
                    'configurar','preparar_convite','verificar','concluir',
                    'confirmar_manutencao','confirmar_backup_previo',
                    'aplicar_migracoes_instancia','verificar_pos_migracao') NOT NULL;

-- Última checagem de saúde por instância (SC-042, FR-014). Só inclusão pela aplicação.
CREATE TABLE instance_health_check (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  checked_at DATETIME(6) NOT NULL,
  healthy BOOLEAN NOT NULL,
  schema_version INT UNSIGNED NULL,
  reason VARCHAR(300) NULL,
  origin ENUM('painel','saida_manutencao') NOT NULL,
  KEY instance_health_check_instance (instance_id, checked_at),
  CONSTRAINT instance_health_check_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Resultado de backup relatado pela ferramenta que realmente o executa (SC-042, research.md
-- R-05). Só inclusão; nenhuma rota HTTP escreve aqui, só o comando `instances:report-backup`.
CREATE TABLE instance_backup_record (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  taken_at DATETIME(6) NOT NULL,
  result ENUM('sucesso','falha') NOT NULL,
  origin VARCHAR(80) NOT NULL,
  detail VARCHAR(300) NULL,
  reported_at DATETIME(6) NOT NULL,
  KEY instance_backup_record_instance (instance_id, taken_at),
  CONSTRAINT instance_backup_record_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Registro do encerramento (SC-031, RN-SC-004). Nenhum campo aqui altera instance_resource.
CREATE TABLE instance_termination (
  id BINARY(16) NOT NULL PRIMARY KEY,
  instance_id BINARY(16) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  export_reference VARCHAR(300) NULL,
  retention_policy VARCHAR(300) NOT NULL,
  actor_id BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY instance_termination_instance (instance_id),
  CONSTRAINT instance_termination_instance_fk FOREIGN KEY (instance_id) REFERENCES instance (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
