# Provisionamento de instâncias — operação

Procedimentos para falhas do provisionamento que a interface não resolve sozinha (F02, spec
FR-023 a FR-026; research.md R-06 a R-09). Nenhum procedimento apaga banco ou usuário com dados
(`RN-SC-004`); a aplicação nunca executa `DROP DATABASE`.

Falhas do **executor de migrações de instância** (F03, atualização de uma instância já em
`MANUTENCAO`) usam os mesmos códigos `PROVISIONING_*` desta tabela, mais `PROVISIONING_NOT_IN_MAINTENANCE`
e `PROVISIONING_NO_PRIOR_BACKUP` (reconferidos a cada retomada); backup e restauração ficam em
[backup-restauracao.md](./backup-restauracao.md).

## Como diagnosticar

1. No painel, abra `Instâncias → <instância> → Provisionamento` e anote o **protocolo**
   (`PRV-000123`), a etapa e o código da falha.
2. Nos logs estruturados do trabalhador, filtre por `event: "provisioning_step"` e pelo `taskId`
   da tarefa (mesmo protocolo). Cada linha traz etapa, tentativa, resultado, duração e, na falha,
   o código e a causa técnica (`cause`), sem SQL nem senha.
3. As tentativas ficam em `spark_core.admin_task_step_run`; os recursos e o estado de cada um
   (`pretendido`, `criado`, `verificado`), em `spark_core.instance_resource`.

## Códigos e o que fazer

| Código                                                            | Repetir pela interface? | Procedimento                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROVISIONING_DEPENDENCY_UNAVAILABLE`                             | Sim                     | MySQL fora do ar ou sobrecarregado. Normalize o banco e use **Repetir**.                                                                                                                                                                                                                                                                                                                                                                        |
| `PROVISIONING_PRIVILEGE_MISSING`                                  | Sim                     | A credencial `spark_provisioner` perdeu privilégio (`CREATE USER`, `ALL ... WITH GRANT OPTION` nos prefixos dos produtos). Restaure os privilégios conforme `docker/mysql/init/01-databases-and-users.sh` (ou o equivalente da hospedagem) e use **Repetir**.                                                                                                                                                                                   |
| `PROVISIONING_RESOURCE_CONFLICT`                                  | Não                     | Existe banco ou usuário com o nome derivado do UUID que **não pertence** a esta instância (sem intenção registrada, com tabelas e sem marcador, ou com marcador de outra instância). Investigue a origem (restauração, ação manual). Não reutilize nem apague o recurso pelo Core. A instância nunca chegou a `PRONTA`, então nunca alcança `SUSPENSA`: o encerramento do F03 não se aplica. Abandone o protocolo e solicite outra (novo UUID). |
| `PROVISIONING_MIGRATION_INTERRUPTED`                              | Não                     | Uma versão do artefato foi interrompida no meio (linha `falha` em `_spark_schema_history`). O MySQL não desfaz DDL, então a versão não é repetida às cegas. O banco não tem dados de negócio; a instância nunca chegou a `PRONTA`/`SUSPENSA`, então o encerramento do F03 não se aplica. Abandone o protocolo e solicite outra.                                                                                                                 |
| `PROVISIONING_MIGRATION_FAILED`                                   | Não                     | Uma versão do artefato do produto falha. Corrija o artefato com uma **nova versão** (versões publicadas são imutáveis), implante e solicite nova instância.                                                                                                                                                                                                                                                                                     |
| `PROVISIONING_ARTIFACT_INVALID` / `PROVISIONING_ARTIFACT_CHANGED` | Não                     | O artefato implantado não passa na verificação ou mudou depois da solicitação. Confira a implantação; solicite nova instância com o artefato atual.                                                                                                                                                                                                                                                                                             |
| `PROVISIONING_VERIFICATION_FAILED`                                | Não                     | A verificação final (marcador, versão, privilégios negativos) falhou. Compare os privilégios do usuário `inst_*` com o esperado (DML só no banco operacional; leitura e logout no `_acc`) antes de qualquer ação.                                                                                                                                                                                                                               |

## Lease e trabalhador parado

Uma tarefa em `em_execucao` com lease vencido (60 s sem heartbeat) é assumida pelo próximo
trabalhador; a tentativa aberta vira `interrompida`. Basta reiniciar o trabalhador. Duas
tarefas estruturais nunca operam a mesma instância ao mesmo tempo (índice único).

## Chave `INSTANCE_SECRET_KEY`

A senha operacional de cada instância fica cifrada com `INSTANCE_SECRET_KEY` (AAD = UUID da
instância). **Perder a chave** impede entregar conexões aos produtos. Recuperação, por instância,
com acesso administrativo ao MySQL:

1. gere uma nova senha aleatória (32 bytes base64url);
2. `ALTER USER 'inst_<...>'@'%' IDENTIFIED BY '<nova senha>'`;
3. grave a nova senha cifrada com a nova chave em `instance_resource.secret_enc` (procedimento
   assistido; ferramenta própria fica para a fatia de rotação de credenciais).

Rotação planejada usa `INSTANCE_SECRET_KEY_VERSION`: a versão de cada segredo fica em
`secret_key_version`.
