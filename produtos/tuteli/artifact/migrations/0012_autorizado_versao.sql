ALTER TABLE autorizado_retirada
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 CHECK (version > 0);
