# Implementation Plan: F02 — Catálogo e provisionamento

**Branch**: `003-f02-catalogo-provisionamento` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-f02-catalogo-provisionamento/spec.md`

## Summary

Levar uma contratação até uma instância `PRONTA` sem SQL manual: contratantes (com CPF/CNPJ,
inclusive alfanumérico, e alerta de homônimos), catálogo de produtos com provisionadores vindos do
código implantado, solicitação idempotente de instância e uma **tarefa persistente de
provisionamento** executada pelo trabalhador com lease, etapas registradas, prova de propriedade
por intenção gravada antes de cada DDL, repetição automática limitada e nova execução manual. A
tarefa cria o banco operacional e o banco de acesso (projeção D-04, agora v2 com o estado
`pronta`), a credencial operacional restrita com senha cifrada por `INSTANCE_SECRET_KEY`, aplica o
artefato do produto, grava o marcador e prepara o convite inicial, cujo link o administrador emite
depois (D-07). O produto obtém a conexão por um contrato interno novo. Tudo provado com o artefato
do produto de referência; o Tuteli entra no catálogo como não provisionável. Detalhes em
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 sobre Node.js 24 LTS (D-05)

**Primary Dependencies**: as de F00 e F01, sem dependência nova (validação de documentos, slug,
classificação de erros e protocolo implementados internamente; `Intl.supportedValuesOf` para fusos)

**Storage**: MySQL 8.4 — `spark_core` (migração 0004: `contractor`, `product`, `instance`
renomeada e ampliada, `instance_resource`, `instance_transition`, `admin_task`,
`admin_task_step_run`, `core_audit_event`); `spark_identity` (0004: `invitation.link_issued_at`);
`<prefixo><uuid>` e `<prefixo><uuid>_acc` por instância (projeção v2)

**Testing**: Vitest 5 (unidade: CPF/CNPJ com vetores públicos, slug, classificação de erros;
integração com MySQL real: etapas, retomada após interrupção em cada etapa, `SIGKILL` do
trabalhador, propriedade, concorrência, privilégios negativos, catálogo em produção; contrato com
Ajv contra OpenAPI 1.2.0 e projeção v2; componente), Playwright (criação guiada e acompanhamento
em 360/1280 px, teclado, axe)

**Target Platform**: igual a F00 (Windows e Linux para desenvolvimento; CI Ubuntu)

**Project Type**: monólito modular (API + trabalhador + SPA)

**Performance Goals**: instância do produto de referência em `PRONTA` em até 2 min no p95 (CS-002;
esperado: poucos segundos); listas do painel p95 ≤ 800 ms (`NFR-004`); acompanhamento a cada 2 s
sem carga perceptível

**Constraints**: processo web sem credencial de provisionamento nem DDL; senha operacional nunca
em claro fora da memória do trabalhador e do contrato de conexão; nenhum `DROP DATABASE` em
`server/src`; nada do Tuteli além da linha do catálogo; F02 não ativa instâncias

**Scale/Scope**: 7 tabelas novas + 1 renomeada em `spark_core`, 1 coluna em `spark_identity`,
projeção v2; 22 operações HTTP (21 `/api/v1`, 1 `/internal/v1`); 8 telas; 1 comando novo; 1 tarefa nova
do trabalhador; alvo de carga `NFR-003` (50 instâncias)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio / regra (v1.2.1) | Como F02 atende | Resultado |
|---|---|---|
| I. Banco exclusivo por instância, nome do UUID | `<prefixo><uuid>` e `_acc` derivados só do UUID v7 gerado no servidor; slug nunca entra em nome (FR-013) | ✅ |
| I. Credencial restrita | DML só no operacional; `SELECT` + `INSERT` de logout no `_acc`; testes negativos de leitura de outra instância, `CREATE TABLE` e `CREATE DATABASE` (CS-006) | ✅ |
| I. Contexto resolvido no servidor | Contrato de conexão resolve pelo produto da credencial + slug; outro produto = 404 | ✅ |
| I. Core sem leitura operacional | O provisionador só toca `_spark_instance`, histórico e a verificação de prontidão; nenhuma leitura de tabelas do produto | ✅ |
| I. Admin da plataforma sem acesso a instâncias | Convite inicial vai para o e-mail informado; o administrador emite o link, mas não ganha vínculo | ✅ |
| I. Testes com duas instâncias | Provisionamento de A e B; negativos de conexão, credencial cruzada e tarefa (T-04) | ✅ |
| II. MFA antes de provisionar | Solicitação, nova execução e emissão exigem TOTP nos últimos 5 min | ✅ |
| II. Sessão só em instância ativa | Login de produto exige `ATIVA`; projeção v2 grava `pronta` | ✅ |
| III. Contratos versionados | OpenAPI 1.2.0 (compatível), projeção v2 (compatível), `/internal/v1/.../connection` novo; provados com `sparkref` | ✅ |
| III. Artefato do produto de referência | F02 prova provisionamento, migração, falha e retomada com `sparkref`, não com o Tuteli | ✅ |
| IV. Idempotência | Chave na `admin_task` com resumo (R-04); `withIdempotency` em repetição e emissão | ✅ |
| IV. Tarefa persistente e uma por instância | `admin_task` + `admin_task_step_run`, lease 60 s/heartbeat 20 s, índice único de tarefa ativa (R-03) | ✅ |
| IV. Não é transação única; propriedade antes de reutilizar | Intenção gravada antes do DDL; adoção só com intenção + marcador ou banco vazio; conflito sem alterar (R-06) | ✅ |
| IV. Sem `DROP DATABASE`, sem remoção automática | Nenhuma remoção; `check:migrations` continua procurando `DROP DATABASE` em `server/src` | ✅ |
| IV. Máquina de estados com pré-condições | Serviço de transição com `FOR UPDATE` e estado esperado; nenhuma edição direta (R-02) | ✅ (ver nota 1) |
| IV. Concorrência | Slug por índice único; inativação de contratante com trava; versão otimista nos cadastros | ✅ |
| V. MySQL real e falhas | Interrupção em cada etapa, `SIGKILL`, MySQL parado, privilégio ausente; testes de alto risco escritos antes | ✅ |
| V. Migrações reproduzíveis | `check:upgrade` de `origin/main` (spark_core 3→4, spark_identity 3→4, projeção 1→2) | ✅ |
| VI. Auditoria e segredos | `core_audit_event` só inclusão; senha operacional cifrada, nunca em tela, log, auditoria ou tarefa; documento mascarado na auditoria | ✅ |
| VI. Dados sintéticos | Contratante e instâncias sintéticos só por sementes/migração condicionada ao marcador de ambiente | ✅ |
| VII. Monólito e escopo | Mesmo trabalhador, sem broker; ativação, suspensão e migração de instância existente ficam em F03; Tuteli só como linha não provisionável | ✅ |
| VII. Sem SQL livre ou edição de status técnico | Catálogo sem campo de código; falha sem edição; provisionadores só no código | ✅ |
| VIII. Design system | Telas com componentes públicos (`Stepper`, `StepsBlock`, `DataTable`, `SettingsBlock`…); lacunas registradas (autocomplete, calendário, linha do tempo) | ✅ |
| Gate de prontidão | `npm run gate -- F02` = 0 (D-01 a D-05 confirmadas) | ✅ |

**Nota 1 — ativação das instâncias sintéticas**: as sementes ativam `ref-a`/`ref-b` por
`PRONTA → ATIVA` no serviço de transição, com a pré-condição de administrador ativo e recusa fora
de ambientes sintéticos. Não há rota nem tela de ativação; a ativação pelo painel, com todas as
pré-condições de `SC-029`, é de F03. A migração 0004 marca `ATIVA` apenas instâncias que já
operavam em F01, com transição registrada. Nenhuma violação de `RN-SC-001`.

**Pós-design (Phase 1)**: reavaliado com data-model e contratos — sem novas violações. Mudança de
spec registrada: edge case de versão de migração interrompida (R-07).

## Project Structure

### Documentation (this feature)

```text
specs/003-f02-catalogo-provisionamento/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi-f02.yaml          # incorporado a contracts/openapi.yaml (v1.2.0)
│   ├── access-projection-v2.md   # delta da projeção (publicado em contracts/access-projection.md)
│   ├── ui-f02.md
│   └── commands-f02.md           # incorporado a contracts/commands.md
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
server/
├── migrations/
│   ├── spark_core/               # 0004 contratantes, catálogo, instância, recursos, transições,
│   │                             #      tarefas, auditoria; escopo connection
│   ├── spark_identity/           # 0004 invitation.link_issued_at
│   └── access_projection/        # 0002 estado 'pronta' (projeção v2)
├── assets/reserved-slugs.txt
├── src/
│   ├── modules/
│   │   ├── contractors/          # cadastro, documento (CPF/CNPJ), homônimos, rotas
│   │   ├── catalog/              # produtos, registro de provisionadores, rotas
│   │   ├── instances/            # instância (ex-instance_ref), slug, fusos, transições,
│   │   │                         # solicitação, rotas, contrato interno de conexão
│   │   ├── provisioning/         # tarefa, etapas, recursos, classificação de falhas,
│   │   │                         # executor (usado pelo trabalhador e pelas sementes)
│   │   ├── audit/                # core_audit_event
│   │   ├── identity/, memberships/, access-projection/   # F01; convite inicial preparado
│   │   │                         # e emissão; login exige instância ATIVA
│   │   └── internal-api/         # + connection
│   ├── platform/migrations/apply-artifact.ts   # decomposto em passos reutilizados pelo
│   │                                           # provisionador
│   ├── worker/jobs/provisioning.ts
│   └── cli/instances-migrate-access.ts
├── seeds/f02.ts                  # contratante sintético, sparkref, instâncias A/B pelo provisionador
└── tests/{unit,integration,contract}/   # + suítes F02
web/src/
├── api/{contractors,products,instances,provisioning}.ts
└── pages/{contractors,products,instances}/   # lista, formulário, detalhe, nova, provisionamento
docs/operacao/provisionamento.md  # falhas que exigem procedimento (recurso em conflito, versão
                                  # interrompida, privilégio ausente)
```

**Structure Decision**: mesmo monólito. Contratantes, catálogo, instâncias e provisionamento são
módulos separados com fronteira em `spark_core`; o provisionamento é o único módulo que usa a
credencial `provisioner` e só roda no trabalhador (e nas sementes). O executor de etapas é uma
função pura sobre (tarefa, contexto, relógio, gancho de teste), para que trabalhador, sementes e
testes usem o mesmo caminho.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Tabela `instance_resource` com intenção registrada antes de cada DDL | Distinguir na retomada "recurso que eu comecei a criar" de "recurso desconhecido" após commit implícito (`SC-021`, `CA-SC-006`) | Inferir pelo nome: um banco com o nome do UUID sem marcador seria indistinguível de um recurso alheio |
| Chave de idempotência na própria tarefa, fora do `idempotency_record` de F01 | Atomicidade entre a chave e a criação da instância (mesmo banco, mesma transação) | `withIdempotency` deixa uma janela entre criar a instância (`spark_core`) e gravar a resposta (`spark_identity`) |
| `INSTANCE_SECRET_KEY` separada da `IDENTITY_SECRET_KEY` | Segredos de conexão de instâncias e segredos TOTP têm alcance e rotação diferentes | Uma chave única amplia o dano de um vazamento |

## Riscos e pontos de atenção

- **Versão de migração interrompida no meio**: não é repetida automaticamente (R-07); exige
  procedimento operacional documentado. Mitigação: artefatos com versões curtas; o Tuteli deve
  seguir a mesma orientação.
- **Privilégios na hospedagem de produção** (plano SDD §5): ainda não confirmados; o provisionador
  precisa de `CREATE USER` e `ALL` nos prefixos de produto com `GRANT OPTION`. Pré-requisito de
  produção, fora desta fatia.
- **Senha operacional no contrato de conexão**: a resposta carrega um segredo; protegida por
  credencial de aplicação com escopo próprio, `no-store`, sem log, evento de segurança sem a
  senha. Rotação da credencial operacional fica para fatia futura.
- **`INSTANCE_SECRET_KEY`**: perda impede entregar conexões; recuperação exige redefinir a senha
  de cada instância por procedimento (`ALTER USER`). Documentar em `docs/operacao/`.
- **F03 depende do convite emitido**: a ativação deve exigir administrador ativo ou convite inicial
  com `link_issued_at` válido (registrado em R-12).
- **Renomear `instance_ref`**: toca módulos de F01; coberto pela suíte de F01 inteira (CS-009).
