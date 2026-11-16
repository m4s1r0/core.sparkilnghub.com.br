-- Cortivo v2: cadastro minimo de profissionais e integridade do perfil de colaborador.
CREATE TABLE profissional (
  profissional_id BINARY(16) NOT NULL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  apelido VARCHAR(40) NULL,
  telefone VARCHAR(16) NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  criado_em DATETIME(6) NOT NULL,
  atualizado_em DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE perfil_colaborador
  ADD UNIQUE KEY uq_perfil_colaborador_profissional (profissional_id),
  ADD CONSTRAINT fk_perfil_colaborador_profissional
    FOREIGN KEY (profissional_id) REFERENCES profissional (profissional_id),
  ADD CONSTRAINT perfil_colaborador_profissional_por_perfil
    CHECK ((FIND_IN_SET('barbeiro', perfis) > 0) = (profissional_id IS NOT NULL));
