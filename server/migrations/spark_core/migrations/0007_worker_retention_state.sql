-- F08-Core US6: estado persistente do job de retenção de IP para o painel (T013, T042)
ALTER TABLE worker_heartbeat
  ADD COLUMN cleanup_last_run   DATETIME(6)  NULL,
  ADD COLUMN cleanup_last_count INT UNSIGNED NULL;
