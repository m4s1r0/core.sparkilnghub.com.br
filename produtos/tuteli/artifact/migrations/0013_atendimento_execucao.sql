-- Atendimento: dados de execução (feature 013, R-01). Profissional executor, recurso, início real,
-- fim previsto, etapa atual, previsão de retirada e motivo de encerramento, mais os tipos de evento
-- da linha do tempo. A tabela `atendimento` ainda não tem linhas em nenhuma instância, então as
-- colunas NOT NULL entram sem valor padrão.
ALTER TABLE atendimento ADD COLUMN profissional_id BINARY(16) NOT NULL;
ALTER TABLE atendimento ADD COLUMN recurso_id BINARY(16) NULL;
ALTER TABLE atendimento ADD COLUMN inicio_real DATETIME(6) NULL;
ALTER TABLE atendimento ADD COLUMN fim_previsto DATETIME(6) NOT NULL;
ALTER TABLE atendimento ADD COLUMN etapa_atual ENUM('banho','secagem','tosa','finalizacao') NULL;
ALTER TABLE atendimento ADD COLUMN previsao_retirada DATETIME(6) NULL;
ALTER TABLE atendimento ADD COLUMN motivo_encerramento VARCHAR(300) NULL;
ALTER TABLE atendimento ADD KEY atendimento_execucao_profissional (status, profissional_id);
ALTER TABLE atendimento ADD KEY atendimento_execucao_recurso (status, recurso_id);
ALTER TABLE atendimento ADD CONSTRAINT atendimento_profissional_fk FOREIGN KEY (profissional_id) REFERENCES profissional (id);
ALTER TABLE atendimento ADD CONSTRAINT atendimento_recurso_fk FOREIGN KEY (recurso_id) REFERENCES recurso (id);

ALTER TABLE atendimento_evento ADD COLUMN providencia VARCHAR(300) NULL;
ALTER TABLE atendimento_evento MODIFY COLUMN tipo ENUM('chegada','inicio_etapa','fim_etapa','pronto','interrupcao','retomada','entrega','inicio','intercorrencia','autorizacao_retirada','troca_profissional','extensao','aviso_manual') NOT NULL;
