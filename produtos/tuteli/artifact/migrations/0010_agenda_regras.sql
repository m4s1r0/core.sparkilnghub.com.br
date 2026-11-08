-- Regra de recurso obrigatório por serviço (specs/006-agenda-agendamentos).
ALTER TABLE servico
  ADD COLUMN exige_recurso BOOLEAN NOT NULL DEFAULT FALSE;
