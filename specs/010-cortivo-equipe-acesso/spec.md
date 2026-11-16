# Feature Specification: Equipe do Cortivo no artefato (versão 2) e ambiente de ensaio do C01

**Feature Branch**: `010-cortivo-equipe-acesso`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Publicar a versão 2 do artefato do Cortivo, com o cadastro mínimo
de profissional e a integridade 'perfil barbeiro exige um profissional', que a fatia C01 do
Cortivo precisa e que a spec 009 deixou de fora por fixar o esquema na versão 1. Preparar no
ambiente de desenvolvimento as instâncias e credenciais de ensaio do C01 (duas instâncias Cortivo
e uma Tuteli). Fora: regras de negócio do Cortivo além do cadastro mínimo e mudanças em
/internal/v1."

**Rastreabilidade**: continuação de [`009-cadastro-produto-cortivo`](../009-cadastro-produto-cortivo/spec.md)
(versão 1 do artefato, catálogo, provisionador `cortivo-v1`). Pedido de origem: tarefas `T013` e
`T016` da especificação `cortivo/cortivo.sparklinghub.com.br/specs/001-base-acesso-cortivo/`
(fatias C00/C01 do Cortivo: `data-model.md`, `research.md` R-10 e R-13, `contracts/core-consumo.md`,
`quickstart.md`). Escopo do Cortivo: `CORE-COR-002`, `CORE-COR-005`, `CORE-COR-008`,
`NFR-COR-001`, `AC-COR-021` (parte de dados), decisões `D-COR-01`, `D-COR-03`, `D-COR-10`.
Contratos: [`migration-artifact.md`](../../contracts/migration-artifact.md) (versões novas,
imutabilidade, aba "Migração"), [`access-projection.md`](../../contracts/access-projection.md) v2.
Padrões: `ECO-013`, `ECO-014`, `SEC-BASE-01`, `SEC-BASE-12`. Constituição v1.2.1, princípios I,
III, IV, V e VII; requisitos `SC-009`, `SC-016`, `SC-019`. Critérios de sucesso continuam a
numeração `CS-COR-` da spec 009.

## Contexto e limites

A spec 009 publicou a versão 1 do artefato do Cortivo: marcador de instância, idempotência,
auditoria só-inserção, caixa de saída de eventos, perfil de colaborador e unidade. Ela fixou o
esquema na versão 1 e deixou a referência do perfil ao profissional anulável e sem integridade,
porque a tabela de profissionais ainda não existia.

A fatia C01 do Cortivo (instância e acesso) precisa dessa tabela: o administrador da barbearia
define os perfis locais da equipe, e o perfil **barbeiro** exige associar exatamente um
profissional ativo (D-COR-03). O Cortivo C01 só opera instâncias na versão 2 do esquema; uma
instância parada na versão 1 é recusada pelo produto como incompatível.

Esta feature entrega, do lado do Core:

1. a **versão 2** do artefato do Cortivo, com o cadastro mínimo de profissional e a integridade
   entre perfil barbeiro e profissional;
2. o caminho para instâncias já existentes chegarem à versão 2 sem recriar nada;
3. o **ambiente de ensaio** do C01 no desenvolvimento: duas instâncias Cortivo e uma Tuteli,
   contas de teste e credenciais de aplicação vinculadas a cada instância, com roteiro
   reproduzível.

Atores:

- **Operador do Core** — publica a versão nova do artefato, migra instâncias existentes e prepara
  o ambiente de ensaio.
- **Administrador da plataforma** — provisiona instâncias e acompanha a migração pela aba
  "Migração" da instância.
- **Trabalhador de provisionamento e de migração** — aplica as versões do artefato.
- **Equipe do Cortivo** — consome o artefato v2 e o ambiente de ensaio para os testes de
  integração e de ponta a ponta do C01.

Limites:

- Somente o cadastro **mínimo** de profissional (identificação, contato e situação). Associação
  de administrador a profissional, serviços habilitados, expediente, bloqueios e cor na agenda são
  da fatia C02 do Cortivo e entram em versões posteriores do artefato.
- O contrato `/internal/v1` e a projeção de acesso não mudam.
- Nenhuma tela nova no Core; a migração de instâncias usa a aba "Migração" já existente.
- A versão 1 publicada pela spec 009 não é alterada (imutabilidade do artefato).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Instância Cortivo nova nasce pronta para o C01 (Priority: P1) 🎯 MVP

O administrador da plataforma provisiona uma instância do Cortivo e ela chega a `PRONTA` já na
versão 2 do esquema, com o cadastro de profissionais e a integridade entre o perfil barbeiro e o
profissional garantidos pelo banco.

**Why this priority**: sem a versão 2 o Cortivo C01 não consegue cadastrar profissionais nem
atribuir o perfil barbeiro; é o bloqueio direto da fatia C01 do produto.

**Independent Test**: provisionar duas instâncias Cortivo sintéticas e verificar que o histórico
de esquema está na versão 2 sem pendência, que as tabelas e restrições da versão 2 existem e que
o banco recusa as combinações inválidas de perfil e profissional.

**Acceptance Scenarios**:

1. **Given** o artefato com as versões 1 e 2 publicadas, **When** uma instância Cortivo é
   provisionada, **Then** ela fica `PRONTA` com o histórico de esquema na versão 2, sem linha
   pendente ou falha.
2. **Given** uma instância na versão 2, **When** se grava um perfil com barbeiro sem profissional
   associado, **Then** o banco recusa.
3. **Given** uma instância na versão 2, **When** se grava um perfil só de recepção com
   profissional associado, **Then** o banco recusa.
4. **Given** um profissional já associado a um perfil barbeiro, **When** se tenta associá-lo a um
   segundo perfil barbeiro, **Then** o banco recusa.
5. **Given** um perfil que referencia um profissional inexistente, **When** se tenta gravá-lo,
   **Then** o banco recusa.
6. **Given** um profissional sem situação informada, **When** ele é gravado, **Then** nasce
   ativo.

---

### User Story 2 - Instância existente sobe para a versão 2 sem recriar nada (Priority: P1)

Uma instância Cortivo provisionada antes desta feature (versão 1) recebe a versão 2 pela aba
"Migração", sem perder dados e sem diferença de estrutura em relação a uma instância nova.

**Why this priority**: a spec 009 já permite provisionar instâncias na versão 1; qualquer uma
delas precisa chegar à versão 2 antes que o Cortivo C01 a atenda (princípio IV e garantia do
aplicador de que v1 → v2 equivale a v1 + v2 do zero).

**Independent Test**: aplicar a versão 1 num banco descartável, gravar dados válidos da versão 1,
aplicar a versão 2 e comparar a estrutura resultante com a de um banco que recebeu as duas
versões do zero; repetir pela tarefa de migração de uma instância provisionada.

**Acceptance Scenarios**:

1. **Given** uma instância Cortivo `PRONTA` na versão 1, **When** o administrador agenda a
   migração pela aba "Migração", **Then** a tarefa aplica somente a versão 2 e a instância fica
   com o histórico na versão 2.
2. **Given** um banco na versão 1 com perfis de recepção já gravados e unidade preenchida,
   **When** a versão 2 é aplicada, **Then** os dados continuam íntegros e legíveis.
3. **Given** um banco que recebeu v1 e depois v2, e outro que recebeu v1 + v2 do zero, **When** se
   compara a estrutura (tabelas, colunas, índices, restrições), **Then** elas são idênticas.
4. **Given** um banco na versão 1 com perfil barbeiro sem profissional (estado que o Cortivo
   nunca grava, porque recusa instâncias na versão 1), **When** a versão 2 é aplicada, **Then** a
   aplicação falha com motivo seguro, a instância fica com pendência visível e nada é removido
   automaticamente.

---

### User Story 3 - Ambiente de ensaio do C01 no desenvolvimento (Priority: P2)

O operador do Core segue um roteiro documentado e obtém, no ambiente de desenvolvimento, duas
instâncias Cortivo (`cortivo-a` e `cortivo-b`) e uma Tuteli prontas e ativadas, contas de teste
com os vínculos que os ensaios do C01 exigem e uma credencial de aplicação por instância Cortivo,
vinculada a ela.

**Why this priority**: é pré-requisito dos testes de ponta a ponta do Cortivo (isolamento entre
duas instâncias e efeito de revogação entre produtos, `INT-110` itens 1 a 6); não bloqueia os
testes de integração do Cortivo, que usam bancos descartáveis.

**Independent Test**: executar o roteiro num ambiente de desenvolvimento limpo e conferir
instâncias, estados, vínculos e credenciais; usar a credencial de `cortivo-a` contra
`cortivo-b` e obter a mesma recusa dada a uma instância inexistente.

**Acceptance Scenarios**:

1. **Given** o ambiente de desenvolvimento com o Core no ar, **When** o operador segue o roteiro,
   **Then** existem as instâncias `cortivo-a` e `cortivo-b` (Cortivo, versão 2) e uma instância
   Tuteli, todas ativadas.
2. **Given** o ambiente preparado, **When** se consultam os vínculos, **Then** há uma conta
   administradora em `cortivo-a` e em `cortivo-b` com vínculo também na instância Tuteli, e uma
   conta colaboradora em `cortivo-a`, todas com dados sintéticos.
3. **Given** a credencial de aplicação de `cortivo-a`, **When** ela é usada para pedir conexão,
   sessão, atividade ou membros de `cortivo-b`, **Then** a resposta é idêntica à de uma instância
   inexistente.
4. **Given** o roteiro, **When** é executado de novo sobre um ambiente já preparado, **Then** não
   duplica instâncias, contas nem credenciais (reaproveita ou informa o que já existe).
5. **Given** o roteiro concluído, **When** a equipe do Cortivo o consulta, **Then** encontra os
   slugs, o nome das contas e onde obter cada credencial, sem que nenhum segredo esteja escrito no
   repositório.

---

### Edge Cases

- **Instância Cortivo na versão 1 encontrada pelo produto C01**: o produto a recusa como
  incompatível; a correção é migrar pela aba "Migração", não alterar o produto.
- **Falha no meio da versão 2**: alteração de estrutura não é desfeita pelo banco; a tarefa fica
  em falha, a instância com pendência visível, e a retomada segue o procedimento operacional de
  migração, sem repetição automática nem remoção de recursos.
- **Credencial por produto (sem instância)** com o Core v1.4: recusada nos escopos de conexão,
  sessão e membros; o roteiro só cria credenciais vinculadas à instância.
- **Tuteli e referência**: publicar a versão 2 do Cortivo não altera a resolução, o manifesto nem
  as instâncias de `sparkpet` e `sparkref`.
- **Ambiente de ensaio em homologação ou produção**: fora do escopo; o roteiro recusa ambiente
  diferente de desenvolvimento e usa apenas dados sintéticos.
- **Profissional inativo associado a perfil barbeiro**: o banco não impede (a situação do
  profissional pode mudar depois da associação); a regra "barbeiro exige profissional **ativo**"
  é verificada pelo serviço do Cortivo.

## Requirements *(mandatory)*

### Functional Requirements

**Versão 2 do artefato**

- **FR-001**: O Core MUST publicar a versão 2 do artefato do Cortivo como versão nova e
  sequencial, sem alterar a versão 1 publicada pela spec 009.
- **FR-002**: A versão 2 MUST criar o cadastro mínimo de profissional com identificador, nome
  (obrigatório, até 120 caracteres), apelido (opcional, até 40), telefone em formato
  internacional (opcional, até 16 caracteres), situação `ativo`/`inativo` (padrão `ativo`),
  versão de edição otimista e instantes de criação e de atualização.
- **FR-003**: A versão 2 MUST impor, no banco, que todo perfil que contém barbeiro tenha
  profissional associado e que todo perfil sem barbeiro não tenha profissional associado.
- **FR-004**: A versão 2 MUST impor, no banco, que um mesmo profissional esteja associado a no
  máximo um perfil barbeiro.
- **FR-005**: A versão 2 MUST impor integridade referencial entre o perfil e o profissional
  associado.
- **FR-006**: A versão 2 MUST NOT conter tabelas de negócio além do cadastro mínimo de
  profissional, nem construção proibida pelo validador; a declaração de tabelas só-inserção
  (auditoria) MUST continuar igual.
- **FR-007**: A validação estática do artefato com as versões 1 e 2 MUST terminar com sucesso.

**Instâncias novas e existentes**

- **FR-008**: O provisionamento de instância Cortivo MUST aplicar todas as versões publicadas e
  deixar a instância `PRONTA` na versão 2.
- **FR-009**: Uma instância Cortivo na versão 1 MUST chegar à versão 2 pela tarefa de migração
  existente, aplicando somente a versão pendente.
- **FR-010**: A estrutura de um banco migrado de v1 para v2 MUST ser idêntica à de um banco que
  recebeu v1 e v2 do zero.
- **FR-011**: Falha ao aplicar a versão 2 MUST deixar a tarefa em falha com motivo seguro e a
  instância com pendência visível, sem repetição automática e sem remover recursos.

**Ambiente de ensaio (somente desenvolvimento)**

- **FR-012**: O Core MUST oferecer um roteiro reproduzível, documentado em `docs/operacao/`, que
  prepara no ambiente de desenvolvimento as instâncias `cortivo-a` e `cortivo-b` (Cortivo) e uma
  instância Tuteli, todas ativadas, usando apenas dados sintéticos.
- **FR-013**: O roteiro MUST criar as contas de teste dos ensaios do C01: um administrador com
  vínculo em `cortivo-a`, em `cortivo-b` e na instância Tuteli, e um colaborador em `cortivo-a`.
- **FR-014**: O roteiro MUST criar uma credencial de aplicação por instância Cortivo, com os
  escopos de conexão, sessão e membros, vinculada à instância (`SEC-BASE-01`).
- **FR-015**: O roteiro MUST recusar ambiente diferente de desenvolvimento e MUST ser seguro para
  reexecução, sem duplicar instâncias, contas ou credenciais.
- **FR-016**: Nenhum segredo (senha de conta, segredo de credencial) MUST ser gravado no
  repositório ou em log; o roteiro só os mostra uma vez ao operador.

**Não regressão**

- **FR-017**: Nenhum contrato consumido pelo Tuteli ou pelo produto de referência MUST mudar; as
  suítes existentes do Tuteli, da referência e da spec 009 MUST continuar verdes, exceto as
  verificações da 009 que fixam o Cortivo na versão 1, atualizadas para a versão 2.
- **FR-018**: Os testes de integração MUST rodar contra MySQL real, com duas instâncias Cortivo
  sintéticas, e cobrir instância nova na versão 2, migração v1 → v2 e falha da versão 2
  (constituição V).

### Key Entities

- **Profissional (cadastro mínimo)**: pessoa que atende na barbearia; pode existir sem conta na
  plataforma; tem nome, apelido, telefone, situação e versão de edição.
- **Perfil de colaborador**: perfis locais acumuláveis de um vínculo do Core (recepção,
  barbeiro); quando contém barbeiro, aponta exatamente um profissional, e um profissional serve a
  no máximo um perfil barbeiro.
- **Versão 2 do artefato do Cortivo**: migração sequencial ao artefato publicado pela spec 009.
- **Ambiente de ensaio do C01**: conjunto de instâncias, contas e credenciais sintéticas no
  desenvolvimento, descrito por um roteiro reproduzível.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-COR-008**: 100% das instâncias Cortivo provisionadas nos testes chegam a `PRONTA` com o
  histórico de esquema na versão 2 e sem pendência.
- **CS-COR-009**: 100% das tentativas de gravar perfil barbeiro sem profissional, perfil sem
  barbeiro com profissional, profissional repetido entre perfis barbeiro ou profissional
  inexistente são recusadas pelo banco.
- **CS-COR-010**: A comparação de estrutura entre v1 → v2 e v1 + v2 do zero tem 0 diferenças.
- **CS-COR-011**: No ensaio de falha da versão 2, 0 recursos são removidos e a pendência fica
  visível na instância.
- **CS-COR-012**: Executar o roteiro do ambiente de ensaio duas vezes resulta em exatamente 3
  instâncias (2 Cortivo, 1 Tuteli), 2 contas de teste e 2 credenciais Cortivo, e 0 segredos
  gravados no repositório.
- **CS-COR-013**: 100% das chamadas da credencial de `cortivo-a` a recursos de `cortivo-b`
  recebem a mesma resposta de uma instância inexistente.
- **CS-COR-014**: 0 testes existentes do Tuteli, da referência e da spec 009 (exceto as
  verificações da versão do esquema do Cortivo, atualizadas) passam a falhar.

## Assumptions

- A spec 009 é integrada antes desta (versão 1 do artefato publicada, catálogo e provisionador
  `cortivo-v1`); a partir da integração em `main`, a versão 1 é imutável.
- O Cortivo C01 suporta somente a versão 2 do esquema (`ESQUEMA_SUPORTADO = [2, 2]` no produto);
  por isso nenhuma instância na versão 1 recebe dados de perfil barbeiro gravados pelo produto, e a
  aplicação da versão 2 sobre perfis existentes só falha em dados escritos fora do produto.
- Telefone do profissional é guardado no formato internacional; a interface do Cortivo envia os
  dígitos brutos do campo com máscara, e o produto normaliza (fora do escopo do Core).
- A regra "barbeiro exige profissional **ativo**" e a liberação de profissional preso a vínculo
  revogado são verificadas pelo serviço do Cortivo (`research.md` R-10 do produto), porque
  dependem da situação do profissional e da projeção de acesso, que o banco operacional não
  conhece.
- O ambiente de ensaio usa os fluxos já existentes do Core (contratantes, nova instância,
  ativação, convites, credenciais de aplicação com `--instance`, entregues pelo `CONF-01`); não há
  fluxo novo de produto.
- O roteiro do ambiente de ensaio é executado pelo operador no desenvolvimento local; homologação
  segue o procedimento operacional próprio quando o Cortivo for homologado (`D-COR-10`).
- O trabalho segue em branch própria (`010-cortivo-equipe-acesso`), depois da integração da 009.
