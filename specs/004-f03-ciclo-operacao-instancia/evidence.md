# Evidências — F03

Ambiente de referência: Windows 10 Pro 19045, Node.js 24.18.0, npm 11.16, Docker 29.9.2 (reiniciado
durante a implementação), MySQL 8.4 (`mysql:8.4`), Edge local para E2E. Data: 2026-10-27/28. Branch
`004-f03-ciclo-operacao-instancia` sobre `003-f02-catalogo-provisionamento` (F02 ainda não
mesclada em `main`), ainda sem commit.

## Verificação completa (`npm run verify`)

**16/16 etapas verdes em 397 s**, rodado limpo depois de `npm run dev:reset` (rodadas anteriores
falharam em `check:migrations`, por um comentário que mencionava "DROP DATABASE" em prosa; em
`test:e2e`, por três defeitos no teste E2E novo; e, já com o código corrigido, em `test:e2e` de
novo por acúmulo de instâncias e contas sintéticas das muitas rodadas manuais desta sessão de
depuração — 27 instâncias extras empurravam `[SINTÉTICO] Instância A` fora do que outros testes
esperavam encontrar; sem relação com o código de F03 — ver "Defeitos encontrados" abaixo):

| Etapa | Resultado |
|---|---|
| typecheck, lint, format:check | sem erros |
| test:scripts | 37 testes |
| check:adr / gate | `gate -- F03` liberada (só `D-01`, já confirmada) |
| check:ds | 43 arquivos da interface |
| check:secrets | gitleaks: nenhum segredo |
| check:migrations | migração 0005 (`spark_core`) intacta; sem `DROP DATABASE`/exclusão de recurso em `server/src`; nenhuma migração nova em `access_projection`/`spark_identity` |
| ref:validate | `sparkref` conferido |
| test:unit | 109 testes |
| test:component | 52 testes |
| test:integration | 228 testes em 49 arquivos, MySQL real |
| check:upgrade | `spark_core` 3→5 (a partir de v1 e de v3), `spark_identity` 3→4, projeção 1→2, todos iguais à migração do zero |
| test:contract | 29 testes (openapi.yaml 1.3.0) |
| test:e2e | 28 testes (360 e 1280 px; teclado; axe sem violações sérias) |

## Cenários críticos

| Cenário | Evidência | Resultado |
|---|---|---|
| R-01 (ordem Core/projeção) | `instances/lifecycle-order.test.ts`: falha forçada na escrita da projeção — revogar não grava a transição nem muda o Core; conceder deixa o Core já no novo estado com a projeção ainda negando; caminho feliz confere os dois em acordo | ok |
| T-03 / CA-SC-008 / CA-SC-009 | `instances/lifecycle-routes.test.ts` e `security/no-secrets-f03.test.ts`: suspender nega sessão aberta a partir da confirmação e **encerra** a sessão (`end_reason = 'suspensao'`); reativar não torna essa sessão válida de novo; suspender A não afeta B | ok |
| SC-029 / SC-024 | `instances/eligibility.test.ts`: elegível por administrador ativo OU convite pendente válido; recusa por contratante inativo, schema incompatível ou nenhum dos dois caminhos de administrador | ok |
| SC-030 | `instances/lifecycle-routes.test.ts`: entra em manutenção, nega operação de negócio; sai só com saúde aprovada; saúde reprovada → `409 HEALTH_CHECK_FAILED`, permanece `MANUTENCAO` | ok |
| SC-042 | `instances/health.test.ts`, `instances/backup.test.ts`: saudável com credencial verificada; marcador divergente reprova sem SQL na mensagem; sem credencial verificada reprova sem tentar conectar; backup sem nenhum registro nunca aparece como sucesso | ok |
| SC-044 | `provisioning/migration-task.test.ts`: `CONFLICT_STATE`/`NO_PRIOR_BACKUP`/`ALREADY_UP_TO_DATE` na ordem certa; caminho feliz aplica a versão nova e atualiza `schema_version`; queda depois do efeito retoma sem repetir a etapa (reaproveita lease/retomada de F02) | ok |
| SC-031 / RN-SC-004 | `instances/lifecycle-routes.test.ts`: só a partir de `SUSPENSA`; `instance_termination` gravada; `instance_resource` e bancos físicos intactos | ok |
| CS-018 | `security/no-secrets-f03.test.ts`: senha operacional, SQL e usuário MySQL fora de logs, tabelas novas (`instance_health_check`, `instance_backup_record`, `instance_termination`) e respostas, no ciclo completo ativar→suspender→reativar→manutenção→saúde→encerrar | ok |
| T-16 | Ensaio real (não automatizado; ver "Ensaio de restauração" abaixo) | ok |
| CS-019 | Suíte completa de F01/F02 (228 testes de integração) permanece verde | ok |

## Ensaio de restauração (T-16, SC-043, NFR-007)

Executado no MySQL de desenvolvimento, contra o banco de acesso real de `ref-a` (sintética de
F01/F02), com uma segunda credencial sintética (`carla`, vínculo colaborador):

1. `mysqldump` do banco de acesso de `ref-a` com `carla` ainda `ativo` (backup "ponto no tempo").
2. Revogação de `carla` em `ref-a` depois do backup (simulação do incidente que o cenário cobre).
3. Restauração do dump antigo num **esquema isolado** no mesmo servidor
   (`restore_drill_acc`) — isolado por nome de banco, não por servidor separado; o procedimento
   completo (`docs/operacao/backup-restauracao.md`) pede um MySQL totalmente separado antes do
   piloto.
4. Confirmado: a restauração ingênua mostra `carla` ainda `ativo` (o risco que o cenário descreve).
5. Rodar a reconciliação (`syncToInstances(..., {kind: "reconciliar"})`, mesmo mecanismo de F01)
   contra o esquema restaurado: 1 divergência detectada e corrigida em **25 ms**, `carla` passa a
   `revogado` — as permissões atuais foram reaplicadas antes de qualquer liberação de acesso.
6. Ambiente de ensaio limpo (banco isolado removido, `carla` devolvida ao estado original em
   `ref-a`); nenhuma outra instância foi tocada.

Achado operacional: a reconciliação exige que `access-projection/reconcile.ts` tenha sido
importado no processo que a executa (o registro do manipulador é um efeito de import); um
script avulso sem essa importação recebe "reconciliação não registrada" em vez de reconciliar —
documentado em `backup-restauracao.md` para quem for operar isso manualmente.

## Defeitos encontrados e corrigidos durante a implementação

- **Reemissão do convite inicial em `ATIVA` (FR-032) especificada mas não implementada**: o
  contrato e a spec já previam a pré-condição ampliada (herdada da nota deixada em F02), mas
  `issueInitialInvitation` continuava exigindo `PRONTA`. Revelado pelo teste HTTP de ativação;
  corrigido com `hasActiveAdmin` (reaproveitado de `eligibility.ts`).
- **Sessão não revogada pela suspensão (CA-SC-009)**: a suspensão só negava `access_instance.state`
  (gate), sem encerrar a sessão (`access_session.ended_at`); reativar "restaurava" uma sessão
  aberta antes da suspensão. Corrigido com `setProjectionStateAndEndSessions`
  (`end_reason = 'suspensao'`, já previsto em `CoreEndReason` desde F01/F02). Revelado pelo
  próprio teste HTTP de reativação.
- **Ordem das pré-condições do executor de migração**: `ALREADY_UP_TO_DATE` era conferido antes de
  `MANUTENCAO`/backup prévio, mascarando `CONFLICT_STATE` e `NO_PRIOR_BACKUP` nos testes
  correspondentes. Movido para depois das duas outras checagens, sob a mesma trava.
- **Falso positivo em `check:migrations`**: um comentário em `transitions.ts` mencionava
  "DROP DATABASE" em prosa (dizendo que a função não faz isso); o detector não distingue prosa de
  código. Reescrito sem a frase proibida.
- **Docker Desktop parado** durante a sessão (reinício do host): sem relação com o código;
  documentado aqui só porque interrompeu a verificação por alguns minutos.
- **`lifecycle.spec.ts` (E2E) com três falsos positivos de correspondência de texto**: o teste
  esperava "Instância pronta" e depois "Pronta" (`exact: true`) para considerar o provisionamento
  concluído, mas **os dois textos já aparecem desde o início** no `StepsBlock` — "Instância pronta
  **para ativação**." é a descrição da etapa `concluir`, e "Pronta" é o próprio título dessa
  etapa, exibidos independente do progresso real. O teste navegava para o detalhe da instância
  ainda `CADASTRADA` (a tarefa nem tinha começado) e travava esperando o menu "Ações", que só
  existe a partir de `PRONTA`. Corrigido esperando o texto do **corpo** do alerta de sucesso
  ("Bancos, credencial, migrações e verificação concluídos."), que só existe depois de
  `task.status === "concluida"`. Também corrigidos: `getByText(/indisponível/i)` batia em dois
  elementos da página pública (título e parágrafo) — violação de modo estrito; e a aba "Saúde"
  era checada como "Saudável" antes de qualquer verificação ter sido disparada (deveria mostrar
  "Nunca verificada" primeiro). Revelado só ao rodar o E2E de verdade, não pelos testes de
  integração (que chamam as funções diretamente, sem o `StepsBlock`).
- **`npm run dev:reset` precisa rodar antes da verificação final depois de muitas rodadas
  manuais de depuração**: nesta sessão, dezenas de execuções manuais do E2E e do CLI (para achar
  os defeitos acima) acumularam 27 instâncias e contas sintéticas extras no banco de
  desenvolvimento compartilhado. Isso **não é um defeito do código de F03**, mas chegou a causar
  falhas (timeout) em `members.spec.ts`/`recovery-block.spec.ts`/`provisioning.spec.ts` de F01/F02
  por lentidão geral do ambiente; `dev:reset` resolveu por completo, e o `verify` limpo seguinte
  (16/16, `test:e2e` 28/28) confirmou que não havia regressão real.

## Desvios registrados

- **`fromVersion` do histórico de migração de instância**: não há coluna dedicada para a versão de
  origem em `admin_task`; o campo no retorno fica `null`. `toVersion` (a versão alvo) é preciso.
  Aceito nesta fatia; uma coluna dedicada fica para quando houver necessidade real de exibi-lo.
- **Teste de contrato de F03 dentro da suíte de integração**: em vez de um arquivo dedicado em
  `server/tests/contract/`, a validação contra `contracts/openapi.yaml` das rotas novas
  (`expectMatchesContract`) está em `instances/lifecycle-routes.test.ts` (projeto de integração),
  por já montar o cenário HTTP completo necessário; `npm run test:contract` ainda passa inteiro
  (29 testes), só não exercita as rotas de F03 isoladamente.
- **Página pública de indisponibilidade (`/i/:slug`)**: implementada em
  `server/src/modules/instances/public-status-route.ts` (dentro do módulo de instâncias), não em
  `server/src/public/` como o plano original sugeria — mantém a convenção de um módulo por
  assunto já usada no resto do código.
- **Executor de migração sem a etapa "validar" própria**: ao contrário do provisionamento de F02
  (que tem `validar` como etapa própria, logada), a conferência do artefato de migração acontece
  antes do laço de etapas, sem gerar uma linha de tentativa — simplificação aceita; o resultado
  observável (recusa por artefato inválido) é o mesmo.

## Limitações e pendências

- **CI no GitHub ainda não executada** para F03 (sem commit/push); desligada globalmente por
  decisão do usuário (custo de execução) desde o commit `933915f` em F02 — reativar antes de
  considerar a fatia concluída.
- **Rotação da credencial operacional e da `INSTANCE_SECRET_KEY`**: só documentada (F02); F03 não
  muda isso.
- **Console de restauração com um clique**, **rollout em massa**, **canário automatizado** e
  **rollback automático de schema** do executor de migrações: fora do MVP por decisão de escopo
  (`SC-043`, `SC-044`).
- **Ensaio de restauração em servidor MySQL totalmente separado**: o ensaio registrado acima usou
  um esquema isolado no mesmo servidor; repetir com um servidor separado antes do piloto
  (`NFR-007`).
- **Privilégios da hospedagem de produção**: ainda pendentes (nota já registrada em F02).
