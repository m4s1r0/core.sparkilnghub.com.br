-- F08-Core: índice em security_event para consultas filtradas por instância (R-04).
-- Não destrutivo: só ADD INDEX.
ALTER TABLE security_event
  ADD KEY k_security_event_instance (instance_id, created_at);
