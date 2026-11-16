-- Tarefa de migração guarda a versão de schema da instância no pedido, para o painel listar
-- exatamente as migrações do artefato que a tarefa aplica (de from_version+1 até artifact_version).
-- Nulo em provisionamento e em tarefas de migração anteriores a esta coluna.
ALTER TABLE admin_task
  ADD COLUMN from_version INT UNSIGNED NULL AFTER artifact_version;
