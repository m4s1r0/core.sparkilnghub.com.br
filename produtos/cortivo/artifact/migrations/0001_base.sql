-- Cortivo (codigo imutavel do catalogo: cortivo), versao 1: base do produto.
--
-- Contem apenas a infraestrutura comum a todo produto (ECO-013) e as tabelas de acesso local e
-- de configuracao da unidade; nenhuma tabela de negocio (agenda, fila, comanda, caixa, estoque,
-- comissoes, retornos), que nascem em migracoes das fatias seguintes.
-- Fonte: cortivo/docs/modelagem/02-modelo-de-dados.md. Onde o contrato do Core prevalece
-- (contracts/migration-artifact.md), o contrato vence a modelagem preliminar.
--
-- Convencoes: PK BINARY(16) com UUID v7; instantes DATETIME(6) em UTC com sufixo _em; sem chaves
-- estrangeiras entre bancos; referencias a pessoas da plataforma (membership_id) sao UUIDs opacos
-- do Core. O aplicador insere a linha de `_spark_instance` logo apos esta versao.

-- Marcador de identidade da instancia (formato do contrato do artefato do Core, o mesmo do
-- Tuteli e do produto de referencia). Conferido no boot do produto (INT-010).
CREATE TABLE _spark_instance (
  instance_uuid BINARY(16) NOT NULL PRIMARY KEY,
  product_code VARCHAR(32) NOT NULL,
  owner_task_uuid BINARY(16) NULL,
  synthetic BOOLEAN NOT NULL,
  created_at DATETIME(6) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Idempotencia de operacoes criticas (COM-026): chave por ator + operacao, com resumo do corpo
-- canonico e resposta guardada por pelo menos 24 h.
CREATE TABLE idempotencia (
  chave BINARY(16) NOT NULL,
  ator_membership_id BINARY(16) NOT NULL,
  operacao VARCHAR(64) NOT NULL,
  resumo_sha256 CHAR(64) NOT NULL,
  estado ENUM('em_processamento','concluida') NOT NULL,
  status_http SMALLINT UNSIGNED NULL,
  resposta_json JSON NULL,
  criado_em DATETIME(6) NOT NULL,
  expira_em DATETIME(6) NOT NULL,
  PRIMARY KEY (chave, ator_membership_id, operacao),
  KEY idempotencia_expira (expira_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Trilha de auditoria SO-INSERCAO (SEC-BASE-12): declarada em `appendOnlyTables` do manifesto,
-- de modo que a credencial operacional da instancia recebe apenas SELECT e INSERT. Sem dados
-- pessoais completos em antes_json/depois_json.
CREATE TABLE auditoria (
  id BINARY(16) NOT NULL PRIMARY KEY,
  ocorrido_em DATETIME(6) NOT NULL,
  ator_membership_id BINARY(16) NOT NULL,
  ator_nome VARCHAR(120) NOT NULL,
  acao VARCHAR(64) NOT NULL,
  resultado ENUM('sucesso','recusado') NOT NULL,
  entidade VARCHAR(48) NOT NULL,
  -- Nulo apenas quando o Core nao devolve o identificador do objeto (ex.: convite recem-criado);
  -- nesse caso a ligacao com a trilha do Core e o correlation_id.
  entidade_id VARCHAR(36) NULL,
  motivo VARCHAR(280) NULL,
  antes_json JSON NULL,
  depois_json JSON NULL,
  correlation_id CHAR(36) NOT NULL,
  KEY auditoria_ocorrido (ocorrido_em),
  KEY auditoria_entidade (entidade, entidade_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Caixa de saida de eventos de utilizacao (INT-080): gravada no mesmo commit da operacao que a
-- origina; enviada ao Core por trabalhador do produto. Sem uso nas primeiras fatias.
CREATE TABLE outbox_evento (
  event_id BINARY(16) NOT NULL PRIMARY KEY,
  kind VARCHAR(64) NOT NULL,
  `count` INT UNSIGNED NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  batch_id BINARY(16) NULL,
  estado ENUM('pendente','enviado','falha') NOT NULL,
  tentativas SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  proxima_tentativa_em DATETIME(6) NULL,
  KEY outbox_pendentes (estado, proxima_tentativa_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Perfis locais do colaborador (ECO-014, D-COR-03): um ou mais, acumulaveis, associados ao
-- membership_id vigente do Core. O perfil local so restringe; nunca amplia o papel do vinculo.
-- `profissional_id` nasce anulavel e sem chave estrangeira: a tabela de profissionais e criada
-- em fatia seguinte, que tambem acrescenta a integridade "barbeiro exige um profissional ativo
-- e unico entre vinculos vigentes".
CREATE TABLE perfil_colaborador (
  membership_id BINARY(16) NOT NULL PRIMARY KEY,
  perfis SET('recepcao','barbeiro') NOT NULL,
  profissional_id BINARY(16) NULL,
  definido_por BINARY(16) NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  criado_em DATETIME(6) NOT NULL,
  atualizado_em DATETIME(6) NOT NULL,
  CONSTRAINT perfil_colaborador_perfis_nao_vazio CHECK (perfis <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Unidade (uma instancia = uma barbearia, D-COR-01): linha unica imposta pelo banco. A tabela
-- nasce vazia; a linha e gravada pelo proprio Cortivo (o Core nao escreve conteudo operacional
-- no banco da instancia). Fuso inicial America/Sao_Paulo; tolerancia de falta e passo da
-- agenda em 15 minutos (D-COR-04), configuraveis.
CREATE TABLE unidade (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
  nome_atendimento VARCHAR(120) NOT NULL,
  telefone VARCHAR(16) NULL,
  whatsapp VARCHAR(16) NULL,
  email VARCHAR(254) NULL,
  cep CHAR(8) NULL,
  logradouro VARCHAR(160) NULL,
  numero VARCHAR(20) NULL,
  complemento VARCHAR(80) NULL,
  bairro VARCHAR(80) NULL,
  cidade VARCHAR(80) NULL,
  uf CHAR(2) NULL,
  fuso VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  tolerancia_falta_min SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  passo_agenda_min SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  criado_em DATETIME(6) NOT NULL,
  atualizado_em DATETIME(6) NOT NULL,
  CONSTRAINT unidade_linha_unica CHECK (id = 1),
  CONSTRAINT unidade_passo_agenda CHECK (passo_agenda_min IN (5, 10, 15, 20, 30))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
