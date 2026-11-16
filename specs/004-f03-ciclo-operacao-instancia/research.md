# Research — F03 Ciclo e operação da instância

**Data**: 2026-10-27 · **Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Base técnica herdada (D-05): Node.js 24, TypeScript 5.9, Fastify 5 + TypeBox, `mysql2` + Kysely
(`sql` templates), migrador próprio, MySQL 8.4, React 19 + Tailwind v4 + TanStack Query sobre o
design system. De F01/F02 vêm a projeção de acesso v2 (`access_instance.state` já com `pronta`,
`ativa`, `suspensa`, `manutencao`), `instance.state` (ENUM de 8 valores já completo desde F02),
`instance_transition`, `admin_task`/`admin_task_step_run` com lease e heartbeat, `requireRecentMfa`
e o aplicador de artefato (`apply-artifact.ts`, `checkHistory`). Constituição v1.2.1.

Nenhum item do contexto técnico ficou como NEEDS CLARIFICATION.

## R-01 — Ordem de escrita entre o estado do Core e a projeção de acesso

- **Decision**: toda transição que **revoga** acesso de produto (suspender, entrar em manutenção)
  grava primeiro `access_instance.state` (banco de acesso da instância, credencial do
  provisionador) e só depois `instance.state` (Core). Toda transição que **concede** acesso
  (ativar, reativar, sair da manutenção) grava primeiro `instance.state` e só depois
  `access_instance.state`. Uma função única, `writeLifecycleTransition(direction, ...)`, aplica a
  ordem certa pela direção e nunca deixa o chamador escolher.
- **Rationale**: a única condição normativa que o produto consulta é
  `access_instance.state = 'ativa'` ([access-projection.md](../../../contracts/access-projection.md);
  F01); `instance.state` no Core é só espelho administrativo e histórico. Uma falha entre as duas
  escritas deve sempre deixar o sistema **fechado**: se a projeção já nega e o Core falhar depois,
  o produto continua negando (seguro, só precisa de repetição); se o Core já concede e a projeção
  falhar depois, o produto **continua negando** porque a projeção não mudou (seguro também). A
  ordem inversa em qualquer um dos dois sentidos abriria uma janela real de acesso indevido
  (revogar: Core muda primeiro, mas nada no produto depende disso, então não há janela nesse
  sentido específico — a decisão é sobre consistência de leitura administrativa, não sobre a
  janela de segurança, que já está coberta por escrever a projeção primeiro).
- **Alternatives considered**: transação distribuída (XA) entre os dois bancos — fora do MVP
  (constituição VII, mesma decisão já tomada em F02 para a ativação sintética); gravar os dois em
  uma única conexão/transação — os dois bancos têm credenciais e privilégios diferentes por
  desenho (princípio I), então uma transação cruzando ambos exigiria uma credencial com privilégio
  nos dois, contrariando o isolamento.

## R-02 — Transições de ciclo como comandos síncronos, não tarefas

- **Decision**: ativar, suspender, reativar, entrar/sair de manutenção e encerrar são funções
  síncronas em `instances/transitions.ts`, cada uma: confere pré-condições fora da trava (consulta
  simples), abre uma transação no Core com `SELECT ... FOR UPDATE` na instância, confere o estado
  esperado, grava `instance_transition` e `core_audit_event`, e devolve sucesso ou
  `CONFLICT_STATE`/erro de pré-condição — sem passar por `admin_task`.
- **Rationale**: nenhuma dessas ações cria recurso externo nem tem etapas que sobrevivem a uma
  queda do processo (ao contrário do provisionamento); são comandos de poucos milissegundos sobre
  linhas já existentes. Usar `admin_task` para elas adicionaria lease, heartbeat e protocolo sem
  necessidade, e duas tarefas estruturais por instância (uma de ciclo, uma de provisionamento)
  complicariam o índice de "uma tarefa ativa por instância" sem ganho (`RN-SC-002`, herdado).
- **Alternatives considered**: reaproveitar `admin_task` com um tipo por ação de ciclo — rejeitado
  pelo motivo acima; um único "serviço de ciclo" com fila própria — microserviço disfarçado,
  contraria a constituição VII.

## R-03 — Migração de instância reaproveita a tarefa e o executor de F02

- **Decision**: `admin_task.kind` ganha o valor `migracao` (a coluna já previa a ampliação, F02
  data-model). Uma tarefa de migração só pode ser criada com a instância em `MANUTENCAO`
  (pré-condição verificada na criação, dentro da mesma trava da instância). As etapas somam-se ao
  mesmo `ENUM` de `admin_task_step_run.step`: `confirmar_manutencao`, `confirmar_backup_previo`
  (recusa se não houver `instance_backup_record` mais recente que `instance.updated_at` da entrada
  em manutenção), `aplicar_migracoes` (reaproveita a mesma rotina de `apply-artifact.ts` usada em
  F02), `verificar` (reaproveita a mesma verificação de marcador/versão/privilégios negativos da
  etapa `verify` de F02, sem a parte específica de banco de acesso). O mesmo trabalhador que
  processa provisionamento processa migração, pelo mesmo laço de `runNextTask` (que já despacha
  por `kind`).
- **Rationale**: reusa lease, heartbeat, repetição com espera progressiva, protocolo e histórico
  por etapa já construídos e testados em F02 (`SC-022`, `NFR-014`), em vez de duplicar essa
  máquina para um segundo tipo de tarefa — constituição IV e VII.
- **Alternatives considered**: comando síncrono como em R-02 — rejeitado porque aplicar um
  artefato de migração pode levar mais que uma requisição HTTP tolera e precisa de retomada após
  queda, como em F02; ferramenta externa de migração fora do Core — fora do MVP e do princípio de
  "sem SQL manual".

## R-04 — Checagem de saúde: reaproveitar a verificação de F02, não um agente novo

- **Decision**: `checkInstanceHealth(ctx, instanceId)` abre uma conexão curta com a credencial
  operacional já armazenada (como a etapa `verify` de F02), faz `SELECT 1` e lê a tabela de
  histórico de migração do produto para comparar com o manifesto do artefato implantado. O
  resultado (saudável/não, instante, motivo) é só inclusão em `instance_health_check`. É chamada:
  (a) sob demanda, quando o painel é aberto (com um resultado em cache curto para não abrir conexão
  a cada clique); (b) automaticamente ao sair da manutenção, como pré-condição da transição
  (`FR-014`).
- **Rationale**: o próprio escopo pede a "mesma verificação determinística" em vez de uma
  heurística nova; reaproveitar evita um segundo caminho de código que poderia divergir do que a
  etapa `verify` já prova em produção.
- **Alternatives considered**: ping HTTP ao produto — o produto não expõe endpoint de saúde
  próprio no contrato atual; heartbeat passivo do produto — exigiria que o produto chamasse o Core
  periodicamente, fora do escopo (SP-100 pede o healthcheck do lado do Core).

## R-05 — Backup: registro alimentado pela infraestrutura, não executado pelo Core

- **Decision**: `instance_backup_record` (só inclusão: instância, instante, resultado, origem,
  detalhe) é escrita por um comando novo (`npm run instances:report-backup -- <id> <ok|falhou>
  [detalhe]`), chamado pela ferramenta/infraestrutura que de fato executa o backup depois de cada
  cópia. O painel de saúde lê o registro mais recente; a ausência de qualquer registro aparece
  como "sem backup bem-sucedido registrado", nunca como sucesso implícito.
- **Rationale**: `SC-042` exige que a origem do status seja "a ferramenta que realmente o
  executa"; um comando CLI chamado pelo script de backup é a superfície mais simples que não
  expõe um endpoint HTTP de escrita para um processo externo não autenticado por sessão de
  administrador.
- **Alternatives considered**: endpoint HTTP dedicado para a ferramenta reportar — exigiria uma
  credencial de aplicação nova só para isso, sem benefício sobre um comando local; Core executando
  o próprio `mysqldump` — fora do escopo (`SC-043` já exclui um console de restauração do MVP; o
  mesmo vale para a execução do backup).

## R-06 — Encerramento: registro próprio, sem tocar o recurso físico

- **Decision**: `instance_termination` (instância, motivo, referência de exportação/backup
  aplicável, política de retenção em texto, ator, instante) é gravada na mesma transação que a
  transição `SUSPENSA → ENCERRADA`. Nenhuma linha de `instance_resource` é alterada ou removida;
  o banco operacional e o de acesso continuam existindo. A projeção de acesso permanece `suspensa`
  (o `ENUM` da projeção não precisa de um quinto valor: negar acesso já é o efeito de `suspensa`,
  e `ENCERRADA` nunca volta a `ATIVA`).
- **Rationale**: `SC-031`/`RN-SC-004` proíbem excluir recurso físico; não adicionar `encerrada` à
  projeção evita uma migração nova em `access_projection` para um estado que se comporta
  exatamente como `suspensa` do ponto de vista do produto.
- **Alternatives considered**: adicionar `encerrada` ao `ENUM` da projeção — rejeitado por não
  mudar nenhum comportamento observável (a condição normativa já é `state = 'ativa'`) e por exigir
  uma migração 0003 da projeção sem necessidade.

## R-07 — Página pública de indisponibilidade

- **Decision**: uma rota pública nova (sem sessão) no servidor do Core, resolvida pelo mesmo slug
  usado pelo contrato de conexão, que mostra um texto mínimo de indisponibilidade e uma orientação
  de contato quando `instance.state` ∈ {`SUSPENSA`, `MANUTENCAO`}, sem consultar nem expor motivo,
  dados financeiros ou qualquer detalhe interno. Instância em qualquer outro estado não tem
  conteúdo especial nessa rota (ela nunca é o caminho normal de acesso ao produto).
- **Rationale**: `SC-027` exige essa página; o slug já é público por natureza (faz parte do
  identificador de acesso da instância, FR-012 de F02).
- **Alternatives considered**: o próprio produto exibir a indisponibilidade — o produto pode estar
  fora do ar justamente por isso; a página precisa vir do Core, que é o que sabe o estado.

## R-08 — Autorização síncrona por requisição permanece suficiente (SP-097/SP-099)

- **Decision**: nenhuma mudança na forma de validar sessão (F01): cada requisição protegida do
  produto já revalida `access_instance.state = 'ativa'` a cada chamada, sem cache de estado entre
  requisições. Uma tarefa assíncrona do produto que relê seu contexto antes de agir (`SP-097`) é
  responsabilidade do produto consumidor do contrato, não do Core; o Core só garante que a
  consulta de validação reflete o estado atual no instante em que é chamada.
- **Rationale**: a regra normativa já publicada em F01 cobre exatamente isso; duplicar a checagem
  no Core criaria uma segunda fonte de verdade.
- **Alternatives considered**: token de sessão com estado embutido (JWT) — exigiria revogação
  distribuída; fora do modelo já adotado (sessão opaca validada no banco, F01).

## R-09 — Acompanhamento da migração pelo histórico real do banco do produto *(adendo 2026-11-13)*

- **Decision**: a aba "Migração" e a API passam a ler `_spark_schema_history` do banco operacional
  da instância com a **credencial operacional** (só leitura, mesma conexão curta da checagem de
  saúde de R-04, extraída para `instances/operational-connection.ts`). Com isso:
  1. `GET /api/v1/instances/{id}/migration/plan` devolve a versão efetiva (última aplicada em
     sequência no histórico), a registrada no Core (`instance.schema_version`), a alvo (tamanho do
     manifesto), as pendentes com a situação de cada uma e um eventual bloqueio;
  2. `GET .../migration` devolve, em `migrations`, cada versão de `fromVersion+1` a `toVersion` com
     a situação lida do histórico; a interface consulta a cada 2 s enquanto a tarefa está ativa;
  3. `POST .../migration` grava em `admin_task.from_version` a versão efetiva (não a do Core) e
     recusa com `409 SCHEMA_HISTORY_BLOCKED` quando o histórico impede aplicar.

  Situação de cada versão, derivada do protocolo do migrador (`migrator.ts`: grava `falha` antes de
  executar, `aplicada` só no sucesso, `finished_at` também no erro):

  | Linha no histórico | Tarefa ativa | Situação |
  |---|---|---|
  | ausente | — | `pendente` |
  | `aplicada` | — | `aplicada` |
  | `falha` com `finished_at` | — | `falhou` |
  | `falha` sem `finished_at` | sim | `em_execucao` |
  | `falha` sem `finished_at` | não | `interrompida` (queda do trabalhador) |

  O bloqueio vem de `checkHistory` (o mesmo usado pelo migrador): `SCHEMA_FAILED`,
  `SCHEMA_CHECKSUM_MISMATCH`, `SCHEMA_UNKNOWN_VERSION`, `SCHEMA_SEQUENCE`; uma versão `falha` sem
  término com tarefa ativa é a execução corrente, não bloqueio. Sem histórico legível, cai para
  `instance.schema_version` (`source = "registro"`) e mostra o motivo sanitizado, sem bloquear.
- **Rationale**: `instance.schema_version` só é atualizado depois de `migrate()` aplicar todas as
  versões (etapa `aplicar_migracoes_instancia`), e DDL no MySQL confirma na hora — então, depois de
  uma falha parcial, o Core fica com a versão antiga e uma lista calculada por ele mostraria como
  pendente o que já está aplicado. O histórico do produto é a fonte de verdade que o próprio
  migrador e a checagem de saúde já usam; ler com a credencial operacional não exige DDL nem a
  credencial do provisionador fora do trabalhador. Recusar cedo (`SCHEMA_HISTORY_BLOCKED`) evita
  criar uma tarefa que falharia de novo pelo mesmo motivo (`migrate()` recusa histórico em falha).
- **Alternatives considered**: progresso gravado pelo trabalhador em `spark_core` (ex.: uma linha
  por versão em `admin_task_step_run`) — duplicaria o histórico do produto e exigiria nova etapa ou
  tabela; atualizar `instance.schema_version` também na falha — corrige o cabeçalho, mas não dá a
  situação por versão nem resolve históricos divergentes; permitir aplicar versões seletivamente —
  rejeitado, o artefato é sequencial (`MANIFEST_VERSION_SEQUENCE`). Consultar o banco do produto a
  cada 2 s só acontece com a aba aberta e a tarefa ativa; aceito para um painel administrativo.
- **Consequences**: a migração `spark_core` 0009 (`admin_task.from_version`) precisa de
  `npm run db:migrate` antes de subir o servidor com este código — sem ela, as rotas de migração
  respondem 500 (`Unknown column 'from_version'`). Tarefas anteriores à coluna ficam com
  `fromVersion = null` e `migrations = []`.

