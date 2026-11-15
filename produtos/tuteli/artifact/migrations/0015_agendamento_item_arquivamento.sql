-- Mantem itens de agenda referenciados por reservas como historico, sem exibi-los como ativos.
ALTER TABLE agendamento_item
  ADD COLUMN arquivado_em DATETIME(6) NULL,
  ADD KEY agendamento_item_ativos (agendamento_id, arquivado_em);
