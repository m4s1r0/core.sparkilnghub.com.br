-- Projeção de acesso v2 (specs/003-f02-catalogo-provisionamento/contracts/access-projection-v2.md):
-- estado 'pronta' para instância provisionada e ainda não ativada. Compatível com a v1: a regra
-- normativa de validação continua exigindo state = 'ativa'.
ALTER TABLE access_instance
  MODIFY state ENUM('pronta','ativa','suspensa','manutencao') NOT NULL;
