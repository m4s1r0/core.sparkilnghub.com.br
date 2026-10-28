# Backup e restauração — operação

Procedimento versionado exigido por `SC-043`/`NFR-007`: o Core nunca executa backup nem
restauração — só recebe o resultado do backup (`instances:report-backup`) e expõe o último
conhecido no painel de saúde. Console de restauração com um clique fica fora do MVP.

## Backup de uma instância

1. A infraestrutura agenda a cópia (fora do Core) de cada banco físico de uma instância: o
   operacional (`<prefixo><uuid>`) e o de acesso (`<prefixo><uuid>_acc`), pelo menos diária,
   cifrada e guardada fora do servidor da aplicação (`NFR-007`).
2. Depois de cada cópia, a ferramenta que a executou roda:

   ```bash
   npm run instances:report-backup -- <instanceId> ok --origin "<nome da ferramenta>"
   ```

   Em falha, `falhou` no lugar de `ok`, com `--detail "<motivo sanitizado>"` se houver um texto
   seguro para registrar (nunca senha nem SQL). O painel de saúde da instância
   (`/instancias/:id`, aba "Saúde") passa a mostrar esse resultado como o mais recente; sem
   nenhum registro bem-sucedido, mostra "sem backup bem-sucedido registrado" — nunca sucesso só
   porque existe uma tarefa agendada (`SC-042`).

3. `--takenAt <ISO>` registra o instante real da cópia quando o comando roda depois dela (por
   exemplo, num job que só recebe a confirmação ao final de uma janela).

## Backup do conjunto Core/identidade

`spark_core` e `spark_identity` seguem a mesma política (diária, cifrada, fora do servidor da
aplicação); por serem bancos de controle (não um banco por instância), o comando
`instances:report-backup` não se aplica a eles — a ferramenta de backup os inclui pelo nome fixo,
e o resultado fica só no próprio registro da infraestrutura (fora do Core nesta fatia).

## Restauração (ensaio obrigatório antes do piloto)

A restauração **nunca** é feita no servidor de produção diretamente; sempre num ambiente isolado,
depois:

1. Restaurar o backup (instância isolada, ou `spark_core`/`spark_identity` + as instâncias que
   dependem deles) num MySQL separado, sem conectividade com produção.
2. Conferir identidade, dados e estado: o marcador (`_spark_instance`/`access_instance`), a
   versão de schema aplicada e o estado da instância no momento do backup.
3. Reaplicar as **permissões atuais** antes de liberar qualquer acesso — um vínculo revogado
   depois do instante do backup não pode voltar a operar (`T-16`). Em particular, para uma
   instância restaurada depois de revogar um colaborador, confirme que a réplica de acesso
   (`access_member`) já reflete a revogação atual, não a do momento do backup.
4. Só então liberar o ambiente isolado para inspeção; nenhuma outra instância, no mesmo MySQL de
   produção, é tocada por esse ensaio.

Repita este ensaio periodicamente (não só uma vez antes do piloto) e registre tempos e eventuais
perdas observadas — é o critério de aceite de `NFR-007` ("restauração ensaiada", não só "backup
existe").

## RPO/RTO

Objetivo `NFR-007`: RPO de 24 h (frequência mínima do backup), RTO de 8 h (tempo até reabrir o
acesso depois de decidida a restauração). Medir no ensaio acima; ainda sem ferramenta própria de
medição nesta fatia.
