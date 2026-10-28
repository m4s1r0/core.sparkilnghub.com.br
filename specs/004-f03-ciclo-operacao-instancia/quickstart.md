# Quickstart de validação — F03

Pré-requisitos: ambiente de F02 funcionando (`npm run dev:up` saudável, catálogo com o produto de
referência, pelo menos uma instância `PRONTA` ou `ATIVA`). Nenhuma variável nova no `.env` (R-05).
Contratos: [openapi-f03.yaml](./contracts/openapi-f03.yaml), [ui-f03.md](./contracts/ui-f03.md),
[commands-f03.md](./contracts/commands-f03.md). Modelo: [data-model.md](./data-model.md).

## 0. Atualização a partir de F02

```bash
npm run db:migrate     # spark_core 0005 (admin_task.kind/step ampliados; 3 tabelas novas)
npm run db:seed        # seeds/f03.ts: cenário ativado/suspenso/saúde/backup de exemplo
```

Esperado: nenhuma migração em `access_projection` ou `spark_identity`; as suítes de F01/F02
continuam passando sem regressão (`npm run test:integration`, `CS-019`).

## 1. Ativar (US1)

Com uma instância `PRONTA` cujo convite inicial ainda não foi aceito: abrir `/instancias/:id` e
usar "Ativar". Esperado:

- Reautenticação pedida; instância vira `ATIVA`; login do produto, antes recusado, passa a ser
  aceito depois do aceite do convite.
- Repetir "Ativar" numa instância `ATIVA` → `409 CONFLICT_STATE`.
- Com o contratante inativado → `409 INSTANCE_NOT_ELIGIBLE` informando o motivo.
- Convite expirado numa instância já `ATIVA` sem administrador → "Emitir convite inicial" ainda
  disponível (`FR-032`); com administrador ativo, deixa de aparecer.

## 2. Suspender com sessão aberta e transação em curso (US2, T-03)

Com a instância ativada no passo 1 e uma sessão de produto aberta: suspender pelo painel com um
motivo. Em paralelo, iniciar uma operação que já passou da autorização antes da confirmação da
suspensão. Esperado:

- A partir da confirmação, qualquer nova chamada autorizada na instância é negada (`CA-SC-008`);
  a operação já autorizada antes conclui (`SC-028`).
- Acessar `/i/:slug` sem sessão mostra a página pública mínima, sem motivo financeiro.
- Uma segunda instância (`B`) com sessão aberta continua funcionando sem qualquer efeito
  (`CS-012`).
- Repetir a suspensão → `409 CONFLICT_STATE`.

## 3. Reativar (US3, CA-SC-009)

Reativar a instância suspensa no passo 2. Esperado:

- Reautenticação pedida; instância volta a `ATIVA`.
- A sessão aberta antes da suspensão continua inválida; só uma nova autenticação cria sessão
  válida (`CS-013`).
- Nenhuma senha ou cobrança foi alterada como efeito da reativação.

## 4. Manutenção (US4)

Com a instância `ATIVA`, entrar em manutenção com um motivo. Esperado:

- Operações de negócio bloqueadas a partir da confirmação; uma transação já em curso pode
  concluir (`SC-030`).
- "Sair da manutenção" dispara uma checagem de saúde: com o produto saudável, volta a `ATIVA`; com
  o produto indisponível (ex.: MySQL da instância parado), permanece `MANUTENCAO` com
  `409 HEALTH_CHECK_FAILED` e o motivo (`CS-014`).

## 5. Saúde e backup (US5, SC-042, T-16)

Abrir a aba "Saúde" de uma instância com recursos criados. Esperado:

- Mostra versão do produto/schema, conectividade e a última verificação ("Verificar agora"
  dispara uma nova).
- Sem nenhum `instance_backup_record`, mostra "sem backup bem-sucedido registrado" (`CS-015`).
- Rodar `npm run instances:report-backup -- <id> ok --detail "mysqldump diário"` e recarregar a
  aba → aparece como o último backup bem-sucedido, com a origem informada.
- Ensaio de restauração (`T-16`, manual, registrar em `evidence.md`): restaurar um backup anterior
  a uma revogação de colaborador em ambiente isolado, conferir identidade/dados/estado, reaplicar
  permissões atuais e confirmar que o colaborador revogado continua sem operar.

## 6. Executor de migrações (US6, SC-044)

Com uma instância de homologação numa versão anterior do artefato de referência, entrar em
manutenção e abrir a aba "Migração". Esperado:

- Sem backup prévio registrado → "Aplicar" recusado com `409 NO_PRIOR_BACKUP`.
- Com backup registrado → aplicar atualiza a instância para a versão vigente, com histórico de
  etapas e sem SQL manual (`CS-016`).
- Fora de `MANUTENCAO` → `409 CONFLICT_STATE` ao tentar aplicar.

## 7. Encerrar (US7, SC-031)

Com a instância suspensa no passo 2 (ou outra `SUSPENSA`): abrir "Encerrar", informar motivo e
política de retenção. Esperado:

- Instância vira `ENCERRADA`; nenhuma ação de reabertura ou exclusão definitiva aparece na
  interface (`CS-017`).
- Tentar encerrar uma instância `ATIVA` ou `PRONTA` diretamente → `409 CONFLICT_STATE`.
- Conferir no banco que `instance_resource` e os bancos físicos continuam intactos (sem
  `DROP DATABASE`).

## 8. Verificação completa

```bash
npm run verify
```

Esperado: todas as etapas verdes, incluindo as suítes novas de F03 e a suíte completa de F01/F02
sem regressão.
