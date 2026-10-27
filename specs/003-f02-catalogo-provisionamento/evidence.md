# Evidências — F02

Ambiente de referência: Windows 10 Pro 19045, Node.js 24.18.0, npm 11.16, Docker 29.9.2,
MySQL 8.4 (`mysql:8.4`), Edge local para E2E. Data: 2026-10-27. Branch
`003-f02-catalogo-provisionamento` sobre `main` (`f4cc9de`), ainda sem commit.

## Verificação completa (`npm run verify`)

**16/16 etapas verdes em 328 s**:

| Etapa | Resultado |
|---|---|
| typecheck, lint, format:check | sem erros |
| test:scripts | 37 testes |
| check:adr / gate | `gate -- F02` liberada (D-01 a D-05 confirmadas) |
| check:ds | 41 arquivos da interface; pacote 0.2.0 (sem troca de versão) |
| check:secrets | gitleaks: nenhum segredo |
| check:migrations | migrações publicadas intactas; F02 só acrescenta (spark_core 0004, spark_identity 0004, projeção 0002); sem `DROP DATABASE` em `server/src` |
| ref:validate | `sparkref` v1/v2 conferido |
| test:unit | 109 testes (CPF/CNPJ inclusive alfanumérico, chave de homônimos, slug, fusos, classificação de falhas e espera progressiva, nomes derivados do UUID, auditoria só inclusão, configuração) |
| test:component | 52 testes (contratantes, produtos, nova instância, provisionamento, falhas, convite inicial, instâncias; vínculos da F01 ajustados) |
| test:integration | 194 testes em 42 arquivos, MySQL real |
| check:upgrade | `spark_core` 3→4, `spark_identity` 3→4 e projeção de acesso 1→2 iguais à migração do zero |
| test:contract | 29 testes (OpenAPI 1.2.0) |
| test:e2e | 26 testes (360 e 1280 px; teclado; axe sem violações sérias), com o trabalhador real |

## Cenários críticos

| Cenário | Evidência | Resultado |
|---|---|---|
| T-01 / CS-003 / CA-SC-005 | `provisioning/idempotency.test.ts`: 100 rodadas com 3 pedidos de mesma chave e 2 de chaves diferentes no mesmo slug → 1 instância, 1 tarefa, mesmo protocolo; corpo diferente → 409; reenvio após provisionar → um banco, um `_acc`, um usuário, um convite | ok |
| T-02 / CS-004 / CA-SC-006 | `provisioning/resume.test.ts`: queda depois do efeito de cada etapa 3–8, retomada após o lease → `PRONTA` sem duplicidade, senha guardada continua válida, tentativa `interrompida` registrada | ok |
| NFR-014 | `provisioning/worker-kill.test.ts`: processo filho com o executor encerrado por `SIGKILL` durante as migrações; outro trabalhador conclui | ok |
| CS-005 / SC-021 | `provisioning/ownership.test.ts`: banco sem intenção, banco com tabelas e sem marcador, marcador de outra instância e usuário `inst_*` alheio → conflito, nada alterado, sem repetição automática | ok |
| CS-006 / T-04 | `provisioning/steps.test.ts`: credencial de A sem acesso a B nem ao `_acc` de B, sem DDL e sem `CREATE DATABASE`; provisionar A não altera estrutura, privilégios, projeção, recursos nem tarefas de B. `provisioning/connection.test.ts`: 200 aquisições alternadas A/B com pools exclusivos conferindo `DATABASE()` e marcador | ok |
| CA-SC-007 / FR-028 | `access/instance-not-active.test.ts`: login de produto em instância `PRONTA` → 401 sem sessão; projeção `pronta` nega a sessão anterior | ok |
| SC-023 / FR-025 / FR-026 | `provisioning/failure.test.ts`: transitória → espera e conclusão; tentativas esgotadas → `FALHA_PROVISIONAMENTO`; nova execução com TOTP, histórico preservado, auditoria; migração com falha, versão interrompida, artefato alterado e privilégio ausente com códigos próprios; contratante e produto inativados depois da solicitação não interrompem; nenhuma rota de editar estado, etapa, SQL ou credencial | ok |
| SC-024 / FR-034 a FR-036 | `provisioning/initial-invitation.test.ts`: aguardando emissão, link uma vez (48 h), reemissão invalida o anterior sem tocar em recursos, expiração, aceite antes da ativação com vínculo replicado e reconciliação sem divergência | ok |
| CS-007 | `security/no-secrets-f02.test.ts`: senha operacional, token do convite e SQL ausentes de logs, tarefas, etapas, auditoria, transições, eventos e respostas (exceto as de exibição única) | ok |
| CS-008 / CA-SC-003 | `contractors/contractors.test.ts` e E2E: inativação recusada com a lista das instâncias ativas | ok |
| CS-009 / FR-044 | suíte de integração de F01 inteira verde com a tabela `instance`; `migrations/upgrade-path.test.ts` incorpora instâncias sintéticas de F01 como `ATIVA` | ok |

## Desempenho

| Medida | p95 | Meta |
|---|---|---|
| Solicitação → `PRONTA` do produto de referência (20 sequenciais, `perf-provisioning.test.ts`) | 624 ms (mediana 581 ms) | ≤ 2 min (CS-002) |
| Validação de sessão pelo produto (F01, sem regressão) | 0,48 ms | ≤ 10 ms |
| Login de produto pelo Core (F01, sem regressão) | 29,6 ms | ≤ 1 s |

O E2E de provisionamento completa a jornada (contratante → solicitação → `PRONTA` → emissão e
aceite do convite) em cerca de 10–15 s por tamanho de tela, com o trabalhador consultando a cada
2 s (CS-001 em até 5 min: atendido com folga).

## Quickstart (`quickstart.md`)

| Seção | Como foi validado | Resultado |
|---|---|---|
| §0 Atualização a partir de F01 | `db:migrate` + `instances:migrate-access` no banco de desenvolvimento com `ref-a`/`ref-b` de F01 → ambas `ATIVA` com contratante sintético; depois `dev:reset` → instâncias recriadas pelo provisionador | ok |
| §1 Contratantes | integração, componentes e E2E `contractors.spec.ts` | ok |
| §2 Catálogo | `catalog/catalog.test.ts`, `catalog/catalog-production.test.ts`, componentes | ok |
| §3 Provisionar até PRONTA | integração e E2E `provisioning.spec.ts` com o trabalhador real | ok |
| §4 Falha e retomada | `provisioning/resume`, `worker-kill`, `ownership`, `failure` | ok |
| §5 Convite inicial | `provisioning/initial-invitation.test.ts` e E2E | ok |
| §6 Consulta | `instances/query.test.ts`, componentes e E2E `instances.spec.ts` | ok |
| §7 Verificação completa | `npm run verify` acima | ok |

## Defeitos encontrados e corrigidos durante a implementação

- **Usuário MySQL compartilhado entre instâncias** (herdado de F00/F01): o nome `inst_` usava só
  os 24 primeiros caracteres hexadecimais do UUID; as instâncias sintéticas A e B (`…0a` e
  `…0b`) dividiam a mesma credencial operacional no banco de desenvolvimento. Revelado quando a
  prova de propriedade do provisionador recusou adotar o usuário "alheio". Agora o nome é o UUID
  inteiro em base32 (31 caracteres, sem perda); `dev:reset` remove também o nome antigo.
  Regressão em `unit/instances/names.test.ts`.
- **Tentativas que não acumulavam**: a conferência do artefato (etapa 1), refeita a cada
  retomada, zerava o contador; o limite de tentativas nunca era atingido. Corrigido no executor;
  coberto por `failure.test.ts`.
- **Ordem de privilégios**: a etapa de credencial concedia `INSERT` numa tabela da projeção que
  só existe depois das migrações; os privilégios do banco de acesso passaram para a etapa de
  migrações.
- **Busca com acento**: texto acentuado era comparado com a coluna ASCII do documento e gerava
  erro de collation (500). A busca só usa o documento quando o texto tem apenas `[0-9A-Z]`.
  Revelado pelo E2E; regressão na integração.
- **Contrato com `allOf` + `additionalProperties: false`**: o detalhe do contratante, o da
  instância e o corpo de edição rejeitavam os próprios campos; passaram a objetos completos.
- **`dev:reset` com provisionamento interrompido**: bancos sem marcador não eram encontrados;
  o reset agora também usa as instâncias sintéticas registradas em `spark_core.instance`.

## Desvios registrados

- **Escopo ausente na credencial de aplicação** responde `401 AUTH_APP_CREDENTIAL_INVALID`, como
  em F01, e não `403 AUTH_SCOPE_MISSING` (contrato e tarefas ajustados).
- **Privilégio ausente** é provado na etapa `criar_bancos` (credencial de provisionamento
  inválida após a queda), não em `criar_credencial`; a classificação é a mesma.
- **Instâncias pedidas pelo painel fora de produção** são marcadas como sintéticas (NFR-016), para
  que `dev:reset` as limpe.
- **Intenção recém-gravada é desfeita** quando o usuário MySQL já existia sem prova de
  propriedade (nenhum efeito ocorreu); sem isso uma retomada futura adotaria o recurso alheio.
- **Situação do sistema** ganhou o campo opcional `provisioning` (compatível, OpenAPI 1.2.0).

## Limitações e pendências

- **CI no GitHub ainda não executada** para F02 (sem commit/push). `F02: concluida` só depois dela
  (T076).
- **Versão de migração interrompida no meio** não é repetida automaticamente (research R-07);
  exige procedimento operacional (`docs/operacao/provisionamento.md`) e o encerramento de F03.
- **Instâncias criadas em F01 sem recursos registrados** (bancos de desenvolvimento antigos) não
  têm credencial no Core: o contrato de conexão responde 404 para elas até um `dev:reset`.
- **Rotação da credencial operacional e da `INSTANCE_SECRET_KEY`**: só documentada; ferramenta em
  fatia futura.
- **Privilégios da hospedagem de produção** (plano SDD §5) seguem pendentes, como pré-requisito de
  produção.
- **Intermitência observada uma vez**: numa rodada completa anterior, o arquivo
  `provisioning/steps.test.ts` falhou no carregamento; não se repetiu em quatro rodadas
  seguintes (isolado e completas). Acompanhar na CI.
- Lacunas do design system 0.2.0 registradas em `docs/design-system-updates.md`.
