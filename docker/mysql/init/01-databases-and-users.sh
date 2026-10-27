#!/bin/bash
# Cria os bancos lógicos do Core e uma credencial por papel (research.md R-06).
# Executado pelo entrypoint da imagem mysql:8.4 com o volume vazio, pela CI para preparar o
# service container e pelo `npm run dev:up` em volumes já existentes. Idempotente.
set -euo pipefail

MYSQL_CMD=(mysql --protocol=socket -uroot "-p${MYSQL_ROOT_PASSWORD}")
if [[ -n "${MYSQL_INIT_HOST:-}" ]]; then
  MYSQL_CMD=(mysql -h "${MYSQL_INIT_HOST}" -P "${MYSQL_INIT_PORT:-3306}" -uroot "-p${MYSQL_ROOT_PASSWORD}")
fi

"${MYSQL_CMD[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS spark_core CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS spark_identity CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Migrações do Core: estrutura e dados de spark_core e spark_identity.
CREATE USER IF NOT EXISTS 'spark_core_migrator'@'%' IDENTIFIED BY '${MYSQL_MIGRATOR_PASSWORD}';
GRANT ALL PRIVILEGES ON spark_core.* TO 'spark_core_migrator'@'%';
GRANT ALL PRIVILEGES ON spark_identity.* TO 'spark_core_migrator'@'%';

-- Servidor HTTP: só DML, sem DDL.
CREATE USER IF NOT EXISTS 'spark_core_web'@'%' IDENTIFIED BY '${MYSQL_WEB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON spark_core.* TO 'spark_core_web'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON spark_identity.* TO 'spark_core_web'@'%';

-- Trabalhador: só DML em spark_core; em spark_identity lê a fonte dos vínculos para
-- sincronizar e reconciliar a projeção de acesso e grava eventos de segurança (F01, R-10).
CREATE USER IF NOT EXISTS 'spark_core_worker'@'%' IDENTIFIED BY '${MYSQL_WORKER_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON spark_core.* TO 'spark_core_worker'@'%';
GRANT SELECT, INSERT ON spark_identity.* TO 'spark_core_worker'@'%';

-- Escritor da projeção de acesso (F01, R-07): nenhum privilégio global. O provisionador concede
-- DML em cada <instância>_acc ao criar a instância.
CREATE USER IF NOT EXISTS 'spark_access_writer'@'%' IDENTIFIED BY '${MYSQL_ACCESS_WRITER_PASSWORD}';

-- Provisionamento: cria usuários e opera apenas bancos de produto.
CREATE USER IF NOT EXISTS 'spark_provisioner'@'%' IDENTIFIED BY '${MYSQL_PROVISIONER_PASSWORD}';
GRANT CREATE USER ON *.* TO 'spark_provisioner'@'%';
GRANT ALL PRIVILEGES ON \`sparkref\_%\`.* TO 'spark_provisioner'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON \`sparkpet\_%\`.* TO 'spark_provisioner'@'%' WITH GRANT OPTION;

-- Testes de integração: apenas bancos temporários t_<runid>_*. Não existe em produção.
CREATE USER IF NOT EXISTS 'spark_test'@'%' IDENTIFIED BY '${MYSQL_TEST_PASSWORD}';
GRANT ALL PRIVILEGES ON \`t\_%\`.* TO 'spark_test'@'%';

FLUSH PRIVILEGES;
SQL
