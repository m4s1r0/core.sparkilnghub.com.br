# Feature Specification: Cadastro do produto Cortivo no SparkCore

**Feature Branch**: `009-cadastro-produto-cortivo`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Cadastrar o produto Cortivo no SparkCore. Código técnico `cortivo`
(imutável, D-COR-01), nome \"Cortivo\", descrição \"Gestão para barbearias\", prefixo `cortivo_`.
Entregar: migração do catálogo, artefato `produtos/cortivo/artifact` com migração 0001 de base,
provisionador `cortivo-v1`, privilégio do provisionador em `cortivo\_%`, registro de portas
3003/5177 e documentação da credencial por instância. Fora: regras de negócio do Cortivo e
mudanças em /internal/v1."

**Rastreabilidade**: [`docs/operacao/novo-produto.md`](../../docs/operacao/novo-produto.md) §1.1;
[`docs/ecossistema/07-checklist-novo-saas.md`](../../docs/ecossistema/07-checklist-novo-saas.md)
("C00 — Base (lado do Core)"); [`01-registro-de-produtos.md`](../../docs/ecossistema/01-registro-de-produtos.md)
(`ECO-001`, `ECO-002`, `ECO-003`); [`05-baseline-seguranca.md`](../../docs/ecossistema/05-baseline-seguranca.md)
(`SEC-BASE-12`); contrato [`migration-artifact.md`](../../contracts/migration-artifact.md);
escopo do Cortivo (`CORE-COR-001`, `CORE-COR-008`, `AC-COR-001`, decisão `D-COR-01`) e modelagem
`cortivo/cortivo.sparklinghub.com.br/docs/modelagem/02-modelo-de-dados.md`; prompt de origem
`cortivo/.../docs/sdd/prompt-c00-c01.md` (Parte A). Constituição v1.2.1, princípios I, III, IV,
V, VI e VII; requisitos `SC-007`, `SC-008`, `SC-009`, `SC-016`, `SC-019`–`SC-022`, `SC-031`.
Critérios de sucesso usam o prefixo `CS-COR-`.

## Contexto e limites

O Cortivo (gestão para barbearias) é o segundo SaaS real do ecossistema, depois do Tuteli. Antes
que o repositório do Cortivo comece a fatia C01 (instância e acesso), o SparkCore precisa conhecer
o produto: tê-lo no catálogo, saber provisionar instâncias dele com o artefato de migração correto
e ter privilégio de banco para isso. Este trabalho é a parte do Core do C00 e não toca o
repositório do Cortivo, que só consome o Core.

Atores:

- **Administrador da plataforma** — escolhe o Cortivo ao criar uma instância no painel do Core e
  acompanha o provisionamento.
- **Operador do Core** — aplica as migrações do Core, valida o artefato e cria a credencial de
  aplicação de cada instância.
- **Trabalhador de provisionamento** — cria o banco operacional e o banco de acesso da instância
  e aplica o artefato.
- **Equipe do Cortivo** — consome o artefato e a documentação para iniciar a fatia C01.

Limites:

- Nenhuma regra de negócio do Cortivo (agenda, fila, comanda, caixa, estoque, comissões,
  retornos) entra aqui; as tabelas correspondentes nascem em migrações das fatias seguintes,
  versionadas no mesmo artefato.
- O contrato `/internal/v1` não muda; o Cortivo usa a versão vigente (v1.4, entregue em `CONF-01`).
- Nenhuma tela nova no Core: o produto aparece no catálogo e no fluxo de "Nova instância" já
  existentes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Provisionar instâncias do Cortivo pelo painel (Priority: P1) 🎯 MVP

O administrador da plataforma cria uma instância do Cortivo para um contratante pelo fluxo de
"Nova instância" e a instância chega a `PRONTA` com banco operacional e banco de acesso exclusivos,
o artefato do Cortivo aplicado e o marcador de instância correto.

**Why this priority**: sem isso a equipe do Cortivo não consegue iniciar a fatia C01; é o motivo
de existir desta feature (`CORE-COR-001`).

**Independent Test**: com o catálogo migrado, o artefato publicado e o provisionador registrado,
provisionar duas instâncias Cortivo de contratantes sintéticos distintos e verificar que cada uma
tem seus dois bancos, a versão 1 do artefato aplicada e o marcador apontando para o próprio UUID.

**Acceptance Scenarios**:

1. **Given** um contratante ativo e o Cortivo ativo no catálogo, **When** o administrador cria uma
   instância do Cortivo, **Then** o provisionamento conclui com banco operacional
   `cortivo_<uuid-sem-hífen>` e banco de acesso `cortivo_<uuid-sem-hífen>_acc`, a credencial
   operacional restrita a esse banco, e a instância fica `PRONTA`.
2. **Given** duas instâncias Cortivo provisionadas, **When** se inspeciona o marcador de instância
   de cada banco operacional, **Then** cada um contém o UUID da própria instância e o código
   `cortivo`, e a credencial operacional de uma não acessa os bancos da outra.
3. **Given** uma instância Cortivo pronta, **When** se consulta o histórico de esquema dela,
   **Then** a última versão aplicada é a 1 (`0001`), sem linha pendente ou falha.
4. **Given** o ambiente `production`, **When** se resolve o provisionador do Cortivo, **Then** ele
   está disponível (diferente do produto de referência, restrito a development/homologation).

---

### User Story 2 - Retomada sem duplicar recursos (Priority: P1)

Duas solicitações idênticas de criação disputam o provisionamento e o trabalhador cai depois de
criar o banco; ao retomar, o Core mantém uma instância e um protocolo e reaproveita apenas recursos
cuja propriedade é comprovada (`AC-COR-001`, parte Core).

**Why this priority**: é o critério de aceite herdado do escopo do Cortivo e a garantia do
princípio IV para o novo produto; um banco duplicado ou órfão não é corrigível depois.

**Independent Test**: teste de integração que dispara duas solicitações com a mesma chave de
idempotência, simula a queda do trabalhador após a criação do banco operacional, retoma a tarefa e
conta bancos, usuários MySQL, instâncias e protocolos resultantes.

**Acceptance Scenarios**:

1. **Given** duas solicitações idênticas de criação de instância Cortivo, **When** ambas chegam ao
   Core, **Then** existe uma única instância e um único protocolo, e a segunda recebe o mesmo
   resultado da primeira.
2. **Given** o trabalhador cai depois de criar o banco operacional, **When** a tarefa é retomada,
   **Then** o banco existente é reaproveitado somente após prova de propriedade (UUID da instância
   e tarefa proprietária), nenhum banco ou usuário extra é criado, e a instância chega a `PRONTA`.
3. **Given** um banco `cortivo_<uuid>` que existe mas não pertence à tarefa, **When** o
   provisionamento o encontra, **Then** ele não é reutilizado nem removido, e a tarefa falha com
   erro sanitizado e pendência visível.

---

### User Story 3 - Artefato do Cortivo válido e limitado à base (Priority: P1)

O operador valida o artefato do Cortivo sem banco e obtém resultado verde; a versão 1 contém só a
infraestrutura comum e as tabelas de acesso local, com a auditoria declarada só-inserção.

**Why this priority**: o artefato é o contrato que o Cortivo passa a versionar; nasce errado e
todas as migrações seguintes herdam o erro. A declaração só-inserção é exigida por `SEC-BASE-12`.

**Independent Test**: executar a validação estática do artefato e, num banco descartável de teste,
aplicar a versão 1 e inspecionar tabelas e privilégios resultantes.

**Acceptance Scenarios**:

1. **Given** o artefato do Cortivo, **When** o operador executa a validação estática, **Then** ela
   termina com sucesso: formato v1, código `cortivo`, prefixo `cortivo_`, resumos SHA-256 corretos
   e nenhuma construção proibida.
2. **Given** a versão 1 aplicada, **When** se listam as tabelas do banco operacional, **Then**
   existem exatamente o marcador de instância, a tabela de idempotência, a auditoria, a caixa de
   saída de eventos, o perfil de colaborador e a unidade, além do histórico de esquema mantido pelo
   aplicador — e nenhuma tabela de negócio.
3. **Given** a credencial operacional de uma instância Cortivo, **When** ela tenta alterar ou
   excluir uma linha da auditoria, **Then** o banco recusa; inserir e ler continuam permitidos.
4. **Given** a tabela de unidade, **When** se tenta gravar uma segunda linha, **Then** o banco
   recusa (linha única).
5. **Given** o arquivo de uma migração alterado depois de publicado, **When** a validação roda,
   **Then** ela falha por resumo divergente.

---

### User Story 4 - Cortivo no catálogo, sem colidir com registro anterior (Priority: P2)

O operador aplica as migrações do Core e o Cortivo aparece no catálogo com código `cortivo`, nome
"Cortivo" e descrição "Gestão para barbearias", ativo e não marcado como referência. Antes, o
ambiente-alvo é verificado quanto a um código anterior para o mesmo produto.

**Why this priority**: necessário para a US1, mas sem risco técnico próprio; a verificação de
código anterior protege a regra de imutabilidade (`SC-007`, `ECO-001.2`).

**Independent Test**: aplicar as migrações do Core num banco limpo e num banco já migrado e
conferir uma única linha do produto com os valores esperados; reaplicar sem duplicar.

**Acceptance Scenarios**:

1. **Given** um `spark_core` sem o Cortivo, **When** as migrações do Core são aplicadas, **Then**
   existe uma linha de produto `cortivo` / "Cortivo" / "Gestão para barbearias", ativa e não de
   referência.
2. **Given** um ambiente-alvo que já tem um produto de barbearia registrado com outro código (ex.:
   `sparkbarba`), **When** a verificação prévia o encontra, **Then** o código existente é preservado,
   nenhuma linha `cortivo` é criada, provisionador, prefixo e privilégios passam a usar o código
   existente, e a decisão fica registrada em `D-COR-01` e no registro de produtos.
3. **Given** os ambientes development, homologation e production, **When** o catálogo é listado,
   **Then** o Cortivo aparece nos três (não é filtrado como o produto de referência).

---

### User Story 5 - Registro e documentação para a equipe do Cortivo (Priority: P3)

A equipe do Cortivo encontra no Core, sem perguntar a ninguém: o código, o prefixo, as portas
reservadas (API 3003, interface 5177) e o comando para criar a credencial de aplicação de cada
instância.

**Why this priority**: destrava a C01 do lado do produto; não afeta comportamento do Core.

**Independent Test**: revisão documental — o registro de produtos e o guia de novo produto contêm
as informações e o comando funciona com uma instância Cortivo provisionada.

**Acceptance Scenarios**:

1. **Given** o registro de produtos, **When** a equipe consulta a linha do Cortivo, **Then** o
   código aparece confirmado (não mais "proposto"), com prefixo `cortivo_`, repositório, marca,
   situação atualizada e portas 3003/5177.
2. **Given** uma instância Cortivo pronta, **When** o operador executa o comando documentado de
   criação de credencial de aplicação vinculada à instância (`--instance <slug>`), **Then** recebe
   uma credencial que só vale para aquela instância.
3. **Given** a tabela de papéis do MySQL no guia de novo produto, **When** consultada, **Then** o
   provisionador aparece com privilégio também em `cortivo_%`.

---

### Edge Cases

- **Código anterior no ambiente-alvo**: se existir registro do produto de barbearia com outro
  código, preserva-se o existente (US4, cenário 2); a migração do catálogo MUST NOT falhar nem
  duplicar em ambiente onde a linha `cortivo` já exista.
- **Ambiente com volume MySQL já criado**: o privilégio novo chega pelo script de inicialização
  reaplicado, sem recriar o volume.
- **Artefato inválido em produção**: se o artefato estiver corrompido ou com resumo divergente, o
  produto aparece como não provisionável com motivo seguro (`ARTEFATO_INVALIDO`), sem expor
  caminho ou SQL.
- **Divergência de colunas do marcador**: a modelagem preliminar do Cortivo lista
  `_spark_instance(instance_id, product_code, created_at)`; prevalece o formato do contrato do
  artefato do Core (o mesmo usado pelo Tuteli e pela referência).
- **Perfil de colaborador antes de existir profissional**: a referência ao profissional nasce
  anulável e sem vínculo de integridade; o vínculo é adicionado quando a tabela de profissionais
  for criada numa fatia seguinte.
- **Tuteli e referência**: registrar um terceiro provisionador não pode alterar a resolução, o
  manifesto ou os privilégios de `sparkpet` e `sparkref`.
- **Banco de acesso**: o banco `_acc` do Cortivo segue a projeção de acesso D-04 sem alteração; o
  artefato do Cortivo não cria tabelas nele.

## Requirements *(mandatory)*

### Functional Requirements

**Catálogo**

- **FR-001**: Uma nova migração do catálogo `spark_core` MUST registrar o produto com código
  `cortivo`, nome "Cortivo", descrição "Gestão para barbearias", estado ativo e não de referência
  (`SC-008`: produto só entra por migração do Core, nunca pela interface).
- **FR-002**: Antes de aplicar o registro num ambiente-alvo, o operador MUST verificar se já existe
  produto de barbearia com outro código; se existir, o código existente MUST ser preservado
  (`SC-007`, `ECO-001.2`) e a decisão MUST ser registrada em `D-COR-01` e no registro de produtos.
- **FR-003**: A migração do catálogo MUST ser segura para reaplicação: em ambiente onde a linha
  `cortivo` já exista, ela não duplica nem falha.

**Artefato de migração**

- **FR-004**: O Core MUST publicar o artefato do Cortivo com manifesto no formato v1, código de
  produto `cortivo`, prefixo de banco `cortivo_` e resumo SHA-256 de cada migração, conforme o
  contrato do artefato.
- **FR-005**: A versão 1 do artefato MUST criar apenas: o marcador de instância no formato do
  contrato do Core; a tabela de idempotência; a auditoria; a caixa de saída de eventos de
  utilização; o perfil de colaborador; e a unidade — com as colunas e restrições da modelagem do
  Cortivo para essas tabelas, salvo onde o contrato do Core prevalece.
- **FR-006**: A auditoria MUST ser declarada só-inserção no manifesto, de modo que a credencial
  operacional receba apenas leitura e inserção nela (`SEC-BASE-12`).
- **FR-007**: A tabela de unidade MUST admitir no máximo uma linha, imposta pelo banco.
- **FR-008**: O perfil de colaborador MUST impor, no banco, que o conjunto de perfis não seja vazio
  e só contenha `recepcao` e `barbeiro` (D-COR-03); a regra "barbeiro exige profissional" é
  verificada a partir da fatia que cria profissionais.
- **FR-009**: O artefato MUST NOT conter tabelas de negócio, `DROP DATABASE`, escrita em tabelas
  `_spark_*` além do previsto no contrato, nem outra construção proibida pelo validador.
- **FR-010**: A validação estática do artefato MUST terminar com sucesso.

**Provisionador e privilégios**

- **FR-011**: O Core MUST registrar em código o provisionador `cortivo-v1` para o produto
  `cortivo`, apontando para o artefato do Cortivo e permitido em development, homologation e
  production (`SC-009`: nunca configurável pela interface).
- **FR-012**: O papel de provisionamento do MySQL MUST receber privilégio sobre os bancos com
  prefixo `cortivo_` no script de inicialização, de forma idempotente e sem afetar os privilégios
  existentes.
- **FR-013**: O provisionamento de instância Cortivo MUST criar banco operacional e banco de acesso
  exclusivos, derivados do UUID da instância, com credencial operacional restrita ao próprio banco
  (`SC-016`, `SC-019`), e gravar o marcador com o UUID da instância e o código `cortivo`.
- **FR-014**: O provisionamento de instância Cortivo MUST ser idempotente e retomável: solicitações
  idênticas resultam em uma instância e um protocolo; após queda do trabalhador, recursos são
  reaproveitados só com prova de propriedade e nunca removidos automaticamente (`SC-020`–`SC-022`,
  `SC-031`, `AC-COR-001`).

**Registro e documentação**

- **FR-015**: O registro de produtos MUST mostrar o Cortivo com código confirmado, prefixo
  `cortivo_`, repositório, marca, situação atualizada e portas API 3003 e interface 5177
  (`ECO-002.3`).
- **FR-016**: O guia de novo produto MUST listar `cortivo_%` entre os prefixos do provisionador e
  documentar a criação da credencial de aplicação do Cortivo vinculada à instância
  (`app-credential create cortivo … --instance <slug>`), já disponível desde `CONF-01`.
- **FR-017**: A decisão `D-COR-01` MUST ser registrada como confirmada (ou como preservação de
  código existente, conforme FR-002) no documento de decisões do Cortivo.

**Não regressão**

- **FR-018**: Nenhum contrato consumido pelo Tuteli (`/internal/v1`, projeção de acesso, formato do
  artefato, provisionamento de `sparkpet`) MUST mudar; as suítes existentes do Tuteli e da
  referência MUST continuar verdes.
- **FR-019**: Os testes de integração MUST rodar contra MySQL real, com duas instâncias Cortivo
  sintéticas, e cobrir isolamento entre elas, falha simulada e retomada (constituição V).

### Key Entities

- **Produto (catálogo)**: entrada do Cortivo no catálogo do Core — código imutável, nome comercial,
  descrição, estado, marcação de referência.
- **Artefato de migração do Cortivo**: manifesto versionado + migrações com resumo; declara prefixo
  e tabelas só-inserção. Versão 1 = base.
- **Provisionador**: associação, em código, entre o produto, o artefato e os ambientes permitidos.
- **Instância Cortivo**: instância do produto com banco operacional e banco de acesso exclusivos e
  marcador de instância.
- **Tabelas da base (banco operacional)**: marcador de instância, idempotência, auditoria
  (só-inserção), caixa de saída de eventos, perfil de colaborador (vínculo do Core → perfis locais
  acumuláveis), unidade (linha única com contato, endereço, fuso, tolerância de falta e passo da
  agenda).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-COR-001**: A validação estática do artefato do Cortivo termina com sucesso em 100% das
  execuções na integração contínua.
- **CS-COR-002**: Duas instâncias Cortivo provisionadas no teste chegam a `PRONTA`, cada uma com
  exatamente 2 bancos e 1 usuário operacional próprios, e 0 acessos cruzados bem-sucedidos.
- **CS-COR-003**: No cenário de solicitação duplicada com queda do trabalhador, o resultado final
  tem exatamente 1 instância, 1 protocolo, 2 bancos e 1 usuário operacional — 0 recursos duplicados
  ou órfãos.
- **CS-COR-004**: Em 100% das instâncias Cortivo provisionadas, o marcador contém o UUID da própria
  instância e o histórico de esquema está na versão 1 sem pendências.
- **CS-COR-005**: 100% das tentativas de alterar ou excluir auditoria com a credencial operacional
  são recusadas.
- **CS-COR-006**: 0 testes existentes do Tuteli e do produto de referência passam a falhar.
- **CS-COR-007**: A equipe do Cortivo inicia a C01 sem pedir ao Core nenhuma informação além da
  publicada (código, prefixo, portas, comando de credencial).

## Assumptions

- O código `cortivo` não existe hoje no repositório do Core (nenhuma ocorrência de `cortivo` ou
  `sparkbarba` em migrações, provisionadores ou script de privilégios); a verificação de FR-002 em
  cada ambiente-alvo (development, homologation, production) é passo de implantação, e o caminho
  "código anterior encontrado" só é executado se a verificação o encontrar.
- `unidade` e `perfil_colaborador` entram na versão 1 por pedido explícito desta feature, embora a
  modelagem preliminar do Cortivo as aloque em C02; a modelagem será ajustada para refletir isso.
- A versão 1 cria a tabela de unidade vazia; a linha única é gravada pelo próprio Cortivo (C02). O
  Core não escreve conteúdo operacional no banco da instância (constituição I).
- O fuso da unidade usa por padrão `America/Sao_Paulo` (D-09); tolerância de falta e passo da
  agenda usam 15 minutos por padrão (D-COR-04).
- O formato do marcador de instância é o do contrato do artefato do Core; os nomes de coluna da
  modelagem preliminar do Cortivo cedem a ele.
- A credencial de aplicação por instância (`--instance`) já foi entregue pelo endurecimento
  `CONF-01` (feature 008, contrato `/internal/v1` v1.4); esta feature apenas a documenta para o
  Cortivo, sem dependência pendente.
- Os testes de integração reaproveitam a infraestrutura de provisionamento existente (MySQL 8.4
  real; suítes de retomada, queda do trabalhador e propriedade já usadas com o produto de
  referência; teste de artefato do Tuteli como modelo para o do Cortivo).
- O trabalho segue em branch própria, em paralelo ao endurecimento do Core, conforme o prompt de
  origem.
