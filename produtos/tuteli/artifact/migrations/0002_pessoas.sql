-- Tutores, animais, cuidados/alertas e contatos autorizados a retirar (seção 4.2–4.3 do escopo).
CREATE TABLE tutor (
  id BINARY(16) NOT NULL PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  telefone_normalizado VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  telefone_secundario VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  email VARCHAR(254) NULL,
  cpf VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NULL,
  endereco JSON NULL,
  observacao VARCHAR(500) NULL,
  situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY tutor_cpf (cpf),
  KEY tutor_telefone (telefone_normalizado),
  KEY tutor_nome (nome),
  KEY tutor_situacao (situacao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-015/SP-016: animal com tutor principal; nome não é chave (CA-SP-002).
CREATE TABLE animal (
  id BINARY(16) NOT NULL PRIMARY KEY,
  tutor_id BINARY(16) NOT NULL,
  nome VARCHAR(80) NOT NULL,
  especie ENUM('cao','gato','outro') NOT NULL,
  porte ENUM('pequeno','medio','grande') NOT NULL,
  pelagem ENUM('curta','media','longa') NOT NULL,
  raca VARCHAR(80) NULL,
  sexo ENUM('macho','femea') NULL,
  castrado BOOLEAN NULL,
  nascimento_data DATE NULL,
  nascimento_estimado BOOLEAN NOT NULL DEFAULT FALSE,
  peso_kg DECIMAL(6,3) NULL,
  peso_data DATE NULL,
  situacao ENUM('ativo','inativo','falecido') NOT NULL DEFAULT 'ativo',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY animal_tutor (tutor_id, situacao),
  KEY animal_nome (nome),
  CONSTRAINT animal_tutor_fk FOREIGN KEY (tutor_id) REFERENCES tutor (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-016/SP-017: cuidados informados pelo tutor; revisão permite exigir nova ciência.
CREATE TABLE animal_alerta (
  id BINARY(16) NOT NULL PRIMARY KEY,
  animal_id BINARY(16) NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  origem ENUM('tutor','equipe') NOT NULL,
  revisao INT UNSIGNED NOT NULL DEFAULT 1,
  vigente BOOLEAN NOT NULL DEFAULT TRUE,
  autor_usuario_id BINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY animal_alerta_animal (animal_id, vigente),
  CONSTRAINT animal_alerta_animal_fk FOREIGN KEY (animal_id) REFERENCES animal (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- SP-013: contato autorizado a retirar o animal; tutor ou animal específico.
CREATE TABLE autorizado_retirada (
  id BINARY(16) NOT NULL PRIMARY KEY,
  tutor_id BINARY(16) NOT NULL,
  animal_id BINARY(16) NULL,
  nome VARCHAR(120) NOT NULL,
  contato VARCHAR(120) NULL,
  evidencia_autorizacao VARCHAR(500) NOT NULL,
  created_by BINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY autorizado_retirada_tutor (tutor_id),
  KEY autorizado_retirada_animal (animal_id),
  CONSTRAINT autorizado_retirada_tutor_fk FOREIGN KEY (tutor_id) REFERENCES tutor (id),
  CONSTRAINT autorizado_retirada_animal_fk FOREIGN KEY (animal_id) REFERENCES animal (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
