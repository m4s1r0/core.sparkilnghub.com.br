-- F02: instante em que o link do convite foi exibido (research.md R-12). Nulo = convite inicial
-- preparado pela tarefa de provisionamento, ainda sem link emitido. Convites de F01 foram exibidos
-- ao serem criados.
ALTER TABLE invitation ADD link_issued_at DATETIME(6) NULL AFTER is_initial;
UPDATE invitation SET link_issued_at = created_at;
