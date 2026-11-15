# Migração de instância — operação

Como atualizar o schema de uma instância existente para uma versão nova do artefato do produto
(F03, US6; spec FR-020 a FR-022 e FR-033 a FR-035; decisões em
[research.md](../../specs/004-f03-ciclo-operacao-instancia/research.md) R-03 e R-09). O Core nunca
desfaz DDL nem roda SQL manual pela interface; correções no banco do produto são feitas por quem
opera o MySQL, seguindo este procedimento.

Publicar a migração no artefato (manifesto, checksum, testes) está em
[`contracts/migration-artifact.md`](../../contracts/migration-artifact.md) e em
[novo-produto.md](./novo-produto.md). Falhas de provisionamento (instância nova) estão em
[provisionamento.md](./provisionamento.md).

## Pré-requisitos

1. **Core atualizado**: depois de atualizar o código do Core, rode `npm run db:migrate` antes de
   subir servidor e trabalhador. A aba "Migração" depende de `admin_task.from_version` (migração
   `spark_core` 0009); sem ela, as rotas de migração respondem 500 (`Unknown column
'from_version'`) e a aba mostra "Não foi possível ler as migrações pendentes".
2. **Artefato implantado**: a nova versão está no `manifest.json` do produto
   (`produtos/<produto>/artifact`) e passa em `npm run artifact:validate -- <diretório>`.
3. **Trabalhador rodando**: é ele que executa a tarefa; sem trabalhador, a tarefa fica "Na fila".

## Passo a passo

1. **Entrar em manutenção**: `Instâncias → <instância> → Ações → Entrar em manutenção` (motivo
   obrigatório). A partir daqui, novas operações de negócio são negadas.
2. **Backup prévio**, feito **depois** da entrada em manutenção, e registrado com o **UUID** da
   instância (o identificador em `/instancias/:id`):

   ```bash
   npm run instances:report-backup -- <uuid-da-instância> ok --origin "dump manual" --detail "restauração conferida"
   ```

   - Não use o slug nem o `sha256` de uma migração do `manifest.json`: valor que não é UUID
     imprime o uso e sai com código 2 **sem gravar nada**.
   - Só conta backup com `taken_at` igual ou posterior à última entrada em manutenção. Sem
     `--takenAt`, vale o instante do comando; se o dump foi feito antes de registrar, informe o
     instante real: `--takenAt 2026-11-13T08:15:00-03:00`.
   - Sem backup válido, aplicar é recusado com "Não há backup bem-sucedido registrado desde a
     entrada em manutenção" (`409 NO_PRIOR_BACKUP`). Detalhes em
     [backup-restauracao.md](./backup-restauracao.md).

3. **Conferir o que será aplicado**: aba "Migração". Mostra "N migrações pendentes: vAtual →
   vAlvo" e a tabela "Migrações a aplicar" (versão, nome, situação). A versão atual vem do
   histórico real do banco do produto (`_spark_schema_history`); sem pendentes, a aba diz que a
   instância já está na versão vigente e o botão fica desabilitado.
4. **Aplicar**: "Aplicar atualização" (pede reautenticação). Uma única tarefa aplica **todas** as
   pendentes, em ordem — não há aplicação seletiva. A aba consulta a tarefa a cada 2 s e mostra
   "Aplicando vN — nome (k de n)" e a situação de cada versão (Pendente, Em execução, Aplicada,
   Falhou, Interrompida). Ao terminar, sai do carregamento sozinha e atualiza o cabeçalho e a aba
   "Saúde".
5. **Sair da manutenção**: `Ações → Sair da manutenção`. A checagem de saúde roda na hora e só
   libera `ATIVA` se a versão de schema bater com o artefato.

## Leitura da aba

| O que aparece                                                       | Significado                                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Migração em andamento" / "Última migração" · `PRV-…`               | tarefa atual ou a mais recente; `vOrigem → vAlvo`                                                                                                        |
| Origem "—" e sem tabela de migrações                                | tarefa criada antes da migração `spark_core` 0009 (sem versão de origem registrada)                                                                      |
| Situação "Indisponível" + aviso de histórico indisponível           | a credencial operacional não leu o banco do produto (sem credencial verificada, conexão recusada); a lista usa a versão registrada no Core               |
| "O banco do produto está em vX, mas o Core registra vY"             | aplicação anterior parou no meio; `instance.schema_version` só é corrigido na próxima aplicação concluída                                                |
| "Migração bloqueada pelo histórico do produto" + botão desabilitado | histórico com versão em falha/interrompida, checksum divergente, versão desconhecida ou fora de sequência; a API recusa com `409 SCHEMA_HISTORY_BLOCKED` |

## Falha no meio de várias migrações

O MySQL confirma DDL na hora, então as versões anteriores à que falhou **ficam aplicadas** e não há
rollback automático (`SC-044`). A versão que falhou fica com `status = 'falha'` em
`_spark_schema_history` (com `finished_at` se o erro foi capturado; sem `finished_at`, se o
trabalhador caiu — "Interrompida") e **bloqueia** novas aplicações: o migrador não repete às cegas
uma versão que pode ter executado parte dos comandos. A instância continua em `MANUTENCAO`.

Para desbloquear (fora da interface, por quem opera o MySQL, com o backup prévio em mãos):

1. Anote na aba a versão com falha e a mensagem sanitizada; nos logs do trabalhador, filtre
   `event: "migration_step"` pelo `taskId` para etapa, tentativa e `errorCode`. O erro do MySQL
   em si se reproduz executando o arquivo da versão num banco descartável
   ([`contracts/migration-artifact.md`](../../contracts/migration-artifact.md#como-testar-localmente-antes-de-publicar)).
2. Abra o arquivo da versão no artefato e confira, no banco operacional da instância
   (`<prefixo><uuid>`), quais comandos chegaram a ser aplicados. Desfaça os efeitos parciais
   dessa versão (ou restaure o backup prévio, seguindo [backup-restauracao.md](./backup-restauracao.md)).
3. Corrija a causa:
   - **Causa no dado ou no ambiente da instância** (ex.: dado que viola uma restrição nova):
     corrija o dado; o arquivo da versão não muda.
   - **Erro no próprio SQL de uma versão ainda não publicada em `main`**: corrija o arquivo,
     atualize o `sha256` no `manifest.json`, valide com `npm run artifact:validate` e implante.
   - **Erro no SQL de uma versão já publicada em `main`**: versões publicadas são imutáveis
     (`check:migrations`); não há procedimento definido no MVP — trate como decisão de produto
     (registrar ADR) antes de qualquer edição.
4. Remova a linha da versão com falha do histórico (só ela, e só depois do passo 2):

   ```sql
   DELETE FROM _spark_schema_history WHERE version = <N> AND status = 'falha';
   ```

5. Recarregue a aba "Migração": o alerta de bloqueio some, as pendentes partem da última versão
   aplicada e "Aplicar atualização" volta a ficar disponível. Registre um backup novo se o anterior
   for de antes de uma nova entrada em manutenção.

## Códigos

| Código                                                                 | Onde aparece                                   | O que fazer                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CONFLICT_STATE`                                                       | ao aplicar                                     | instância fora de `MANUTENCAO`, ou já há tarefa estrutural ativa                               |
| `NO_PRIOR_BACKUP`                                                      | ao aplicar                                     | registre backup com o UUID e `taken_at` posterior à entrada em manutenção                      |
| `ALREADY_UP_TO_DATE`                                                   | ao aplicar                                     | nada a fazer                                                                                   |
| `SCHEMA_HISTORY_BLOCKED`                                               | ao aplicar / alerta na aba                     | siga "Falha no meio de várias migrações"                                                       |
| `PROVISIONING_ARTIFACT_INVALID`                                        | plano ou aplicação                             | artefato implantado não passa na validação; confira manifesto e checksums                      |
| `PROVISIONING_NOT_IN_MAINTENANCE`, `PROVISIONING_NO_PRIOR_BACKUP`      | etapa da tarefa (reconferidos a cada retomada) | instância saiu de manutenção ou o backup foi removido durante a tarefa                         |
| `PROVISIONING_MIGRATION_FAILED` / `PROVISIONING_MIGRATION_INTERRUPTED` | etapa "Aplicar migrações"                      | versão falhou ou foi interrompida; siga "Falha no meio de várias migrações"                    |
| `PROVISIONING_VERIFICATION_FAILED`                                     | etapa "Verificar"                              | marcador ou versão de schema divergente depois de aplicar; compare o histórico com o manifesto |
