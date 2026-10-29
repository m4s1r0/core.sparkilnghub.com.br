# Feature Specification: F00 — Base e decisões do SparkCore

**Feature Branch**: `001-f00-base-decisoes`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "Fatia F00 — Base e decisões do SparkCore, conforme docs/escopos/03-plano-sdd.md (seção 3) e constituição v1.1.0: repositório do sistema, execução local, MySQL de desenvolvimento, contratos iniciais, registro das decisões D-01 a D-05, pipeline de verificação, dados sintéticos, produto de referência sintético e consumo do design system @sparkling-hub/design-system. Requisitos: COM-001 a COM-006; NFR-001, NFR-011, NFR-012, NFR-016."

**Rastreabilidade**: `COM-001` a `COM-006`; `NFR-001`, `NFR-011`, `NFR-012`, `NFR-016`; decisões `D-01` a
`D-05`; constituição v1.1.0, princípios III, V, VII e VIII e seção "SparkCore primeiro". Os
critérios de sucesso desta especificação usam o prefixo `CS-` para não colidir com os requisitos
`SC-*` do escopo.

## Contexto e limites

F00 não entrega funcionalidade de negócio ao administrador da plataforma. Ela entrega a base sobre
a qual F01 (identidade), F02 (provisionamento), F03 (ciclo da instância) e F08-Core serão
construídas: decisões estruturais registradas, ambiente reproduzível, verificação automática,
convenções de contrato, dados sintéticos, produto de referência e a casca da interface ligada ao
design system.

Os atores desta fatia são o **responsável técnico** da Sparkling Hub (confirma decisões e aprova
mudanças), a **pessoa desenvolvedora ou agente** que trabalha no repositório e o **revisor** que
integra mudanças.

**Fora de F00**: login, contas, sessões, MFA, contratantes, produtos, instâncias, provisionamento
real, suspensão, telemetria e relatórios (fatias seguintes); qualquer trabalho no Tuteli;
hospedagem de produção, backup e domínio público.

## Clarifications

### Session 2026-10-26

- Q: As referências propostas para D-01 a D-04 são confirmadas como estão? → A: Confirmar
  `D-01` (dois monólitos, identidade no Core), `D-02` (`spark_identity` central, sem copiar
  senhas) e `D-03` (uma instância Tuteli = um estabelecimento). `D-04` (autorização síncrona no
  Core para cada requisição do Tuteli) permanece **proposta**, em aberto.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Decisões estruturais registradas antes do código dependente (Priority: P1)

O responsável técnico revisa as decisões de referência `D-01` a `D-05` e registra no repositório,
para cada uma, a alternativa escolhida, o motivo, as consequências e os requisitos afetados. As
fatias F01 e F02 só podem começar quando `D-01` a `D-04` estiverem confirmadas.

**Why this priority**: a constituição proíbe implementar identidade e provisionamento sem essas
decisões; elas definem quantos sistemas existem, onde ficam as contas e como cada requisição do
Tuteli será autorizada. Errar aqui invalida trabalho posterior.

**Independent Test**: abrir o registro de decisões do repositório e verificar que cada decisão
tem estado, data, responsável, alternativa escolhida, alternativas rejeitadas, consequências e
requisitos relacionados; verificar que a verificação automática impede iniciar F01 com uma das
decisões `D-01` a `D-04` em estado diferente de confirmada.

**Acceptance Scenarios**:

1. **Given** as decisões `D-01` a `D-05` descritas nos escopos, **When** o responsável técnico as
   revisa, **Then** cada uma fica registrada com estado `proposta`, `confirmada` ou `substituída`,
   e nenhuma aparece como confirmada sem data e responsável.
2. **Given** `D-04` em estado `proposta`, **When** alguém tenta marcar F01 como pronta para
   implementação, **Then** o portão de prontidão falha e indica a decisão pendente.
3. **Given** uma decisão confirmada que depois é alterada, **When** a alteração é registrada,
   **Then** o registro anterior passa a `substituída`, aponta para o novo e lista os requisitos e
   especificações que precisam de revisão.
4. **Given** `D-05` (tecnologias do servidor), **When** o plano técnico de F00 escolhe framework,
   acesso a dados e ferramenta de migração, **Then** a escolha fica registrada com versões e
   motivo, respeitando Node.js, TypeScript e MySQL (`COM-002`, `COM-003`).

---

### User Story 2 - Ambiente local reproduzível (Priority: P1)

Uma pessoa desenvolvedora clona o repositório numa máquina limpa, segue apenas a documentação do
repositório e, com um único comando documentado, sobe o servidor do SparkCore, o trabalhador de
tarefas, a interface e um MySQL de desenvolvimento com os bancos lógicos separados e dados
sintéticos carregados.

**Why this priority**: todas as fatias seguintes dependem de executar e testar localmente contra
MySQL real (constituição, princípio V). Sem isso, cada pessoa monta um ambiente diferente e as
evidências deixam de ser comparáveis.

**Independent Test**: em máquina sem o projeto instalado, seguir o guia de início, executar o
comando de subida e consultar a verificação de saúde, que informa versão, estado do servidor, do
trabalhador e de cada banco lógico.

**Acceptance Scenarios**:

1. **Given** uma máquina com os pré-requisitos do guia, **When** a pessoa executa o comando de
   subida, **Then** a verificação de saúde responde "saudável" para servidor, trabalhador e os
   bancos `spark_core` e `spark_identity`, e a interface abre a página base.
2. **Given** o ambiente local em execução, **When** a pessoa inspeciona os acessos ao MySQL,
   **Then** existem credenciais distintas para execução web, trabalhador de provisionamento e
   operação de instância, e a credencial web não consegue criar bancos nem alterar estruturas.
3. **Given** o MySQL de desenvolvimento parado, **When** a verificação de saúde é consultada,
   **Then** ela responde "indisponível" com indicação do componente afetado e erro temporário,
   sem expor credencial, SQL ou rastreamento de pilha.
4. **Given** o ambiente já iniciado uma vez, **When** o comando de subida é executado novamente,
   **Then** nada é duplicado e os dados sintéticos permanecem consistentes.
5. **Given** a pessoa quer recomeçar do zero, **When** executa o comando documentado de
   reinicialização do ambiente local, **Then** os bancos de desenvolvimento são recriados vazios,
   as migrações reaplicadas e os dados sintéticos recarregados; o comando recusa executar fora do
   ambiente de desenvolvimento.

---

### User Story 3 - Verificação automática obrigatória em cada mudança (Priority: P2)

Cada mudança proposta ao repositório passa automaticamente por verificação de tipos, análise
estática, testes de regras, testes de integração contra MySQL da versão adotada, reprodução das
migrações e uma jornada de ponta a ponta da página base. Uma falha bloqueia a integração.

**Why this priority**: a Definition of Done de todas as fatias depende desse portão (`NFR-011`,
`NFR-012`); ele precisa existir antes do primeiro código de domínio.

**Independent Test**: abrir uma mudança com um teste deliberadamente quebrado e verificar que a
integração é bloqueada; corrigir e verificar que passa. Repetir com uma migração cujo conteúdo
foi alterado após publicada.

**Acceptance Scenarios**:

1. **Given** uma mudança proposta, **When** a verificação roda, **Then** executa, nesta ordem
   ou em paralelo equivalente, tipos, análise estática, testes de regras, integração com MySQL,
   migrações do zero e a partir da versão anterior suportada, e jornada de ponta a ponta.
2. **Given** qualquer etapa com falha, **When** a verificação termina, **Then** a mudança não pode
   ser integrada e o relatório indica a etapa e o teste que falharam.
3. **Given** uma migração já publicada cujo conteúdo foi alterado, **When** a verificação roda,
   **Then** a divergência de checksum falha a etapa de migrações.
4. **Given** um segredo (senha, chave, token) incluído em arquivo versionado, **When** a
   verificação roda, **Then** a mudança é bloqueada com indicação do arquivo.
5. **Given** a mesma verificação executada localmente, **When** a pessoa usa o comando
   documentado, **Then** obtém o mesmo resultado da verificação remota para as mesmas etapas.
6. **Given** um relatório de cobertura percentual, **When** a verificação decide aprovar ou
   reprovar, **Then** a cobertura não é critério de aprovação; a decisão depende das etapas e dos
   testes vinculados a requisitos.

---

### User Story 4 - Interface base ligada ao design system (Priority: P2)

O administrador da plataforma abre o endereço local do SparkCore e vê uma página base com a
identidade da Sparkling Hub, construída com os componentes e blocos do design system, que mostra
a situação técnica do sistema (versão e saúde) com estados de carregamento, sucesso e erro.

**Why this priority**: fixa desde o início o consumo do design system pela API pública, com
versão fixada (princípio VIII), antes de as telas de F01 surgirem com cópias locais de estilos.

**Independent Test**: abrir a página base em largura de 360 px e em desktop, navegar só pelo
teclado, simular servidor lento e servidor indisponível e verificar os estados correspondentes.

**Acceptance Scenarios**:

1. **Given** o ambiente local em execução, **When** o administrador abre a página base, **Then**
   vê a marca aprovada, a versão do SparkCore e a situação de cada componente, usando apenas
   componentes e blocos públicos do design system.
2. **Given** resposta lenta da verificação de saúde, **When** a página carrega, **Then** exibe
   estado de carregamento textual, sem mostrar contagens ou situações falsas.
3. **Given** verificação de saúde indisponível, **When** a página carrega, **Then** exibe
   mensagem de erro segura com opção de tentar novamente e identificador de correlação.
4. **Given** largura de 360 px, **When** a página é exibida, **Then** não há rolagem horizontal e
   todo o conteúdo é alcançável por teclado com foco visível.
5. **Given** uma nova versão do design system, **When** alguém atualiza a dependência, **Then** a
   mudança registra versão anterior e nova e reexecuta os testes de interface afetados.

---

### User Story 5 - Convenções de contrato e catálogo de capacidades (Priority: P2)

A pessoa desenvolvedora encontra no repositório as convenções que todos os contratos do SparkCore
seguem (versão, formato de erro, correlação, idempotência, política de respostas negadas) e o
catálogo das capacidades que o Tuteli consumirá, cada uma com a fatia responsável e o estado
de especificação. O contrato da verificação de situação operacional já é publicado em F00.

**Why this priority**: a constituição exige contratos versionados antes do consumidor
(princípio III). Definir as convenções uma vez evita que F01, F02 e F08 criem formatos diferentes.

**Independent Test**: comparar a resposta real da verificação de saúde com o contrato publicado;
provocar um erro e conferir que ele segue o formato padronizado; consultar o catálogo e conferir
as seis capacidades das diretrizes, seção 6.1.

**Acceptance Scenarios**:

1. **Given** a convenção publicada, **When** qualquer erro é devolvido pelo SparkCore, **Then** ele
   contém código estável, mensagem segura, campo quando cabível, indicação de repetição possível e
   identificador de correlação, sem SQL, segredo ou rastreamento de pilha.
2. **Given** uma requisição sem identificador de correlação, **When** é atendida, **Then** o
   SparkCore gera um, devolve-o na resposta e o registra no log estruturado da requisição.
3. **Given** o catálogo de capacidades, **When** consultado, **Then** lista autenticar e encerrar
   sessão, autorizar e resolver instância, vínculos locais, convite inicial, lote de utilização e
   situação operacional, com versão, fatia responsável (F01, F02, F03 ou F08-Core) e estado.
4. **Given** o contrato da situação operacional, **When** a resposta real é validada contra ele
   na verificação automática, **Then** qualquer divergência de formato falha a verificação.
5. **Given** a política de respostas negadas, **When** documentada, **Then** define o uso de
   `401`, `403`, `404`, `409`, `422` e `503` e proíbe revelar a existência de objetos de outra
   instância.

---

### User Story 6 - Produto de referência sintético (Priority: P3)

O SparkCore passa a conter um produto de referência sintético: um pacote mínimo de migrações
versionadas, em duas versões consecutivas, no formato que o provisionamento de F02 aceitará. Ele
permite provar provisionamento e migração sem depender do Tuteli.

**Why this priority**: é pré-requisito de F02 pela regra "SparkCore primeiro", mas só é exercido
pelo provisionador em F02; em F00 basta o artefato e sua validação.

**Independent Test**: aplicar a versão 1 do artefato num banco vazio, depois a versão 2, e
comparar com a aplicação direta da versão 2 num banco vazio; as estruturas devem ser iguais.

**Acceptance Scenarios**:

1. **Given** um banco vazio de teste, **When** a versão 1 do artefato de referência é aplicada,
   **Then** o banco contém o marcador de identidade da instância e o registro de versão e checksum.
2. **Given** um banco na versão 1, **When** a versão 2 é aplicada, **Then** o resultado é
   estruturalmente igual a aplicar a versão 2 diretamente num banco vazio.
3. **Given** um artefato com checksum divergente do registrado ou versão fora de sequência,
   **When** a validação roda, **Then** ele é recusado com motivo explícito.
4. **Given** o produto de referência, **When** alguém consulta o catálogo de produtos ou a
   interface, **Then** ele não aparece como SaaS oferecível e não contém regras de negócio do
   Tuteli.

---

### User Story 7 - Dados sintéticos e proteção contra dados reais (Priority: P3)

A pessoa desenvolvedora carrega um conjunto de dados sintéticos identificáveis como fictícios, e
o repositório impede carregar esses dados fora de desenvolvimento e homologação ou importar cópia
de produção para esses ambientes (`NFR-016`).

**Why this priority**: F00 ainda tem pouco domínio; o conjunto inicial é pequeno e cresce em cada
fatia. A proteção, porém, precisa existir desde o início.

**Independent Test**: carregar os dados sintéticos duas vezes e verificar que não duplicam;
tentar carregá-los com o ambiente marcado como produção e verificar a recusa.

**Acceptance Scenarios**:

1. **Given** o ambiente de desenvolvimento, **When** os dados sintéticos são carregados, **Then**
   todos os registros carregam marcação de fictício e nenhum usa documento, e-mail ou telefone
   que possa pertencer a uma pessoa real.
2. **Given** o carregamento executado duas vezes, **When** os dados são conferidos, **Then** não
   há duplicidade.
3. **Given** um ambiente identificado como produção, **When** alguém executa o carregamento ou a
   reinicialização do ambiente, **Then** o comando recusa e registra a tentativa.

### Edge Cases

- MySQL local em versão diferente da adotada: o ambiente recusa iniciar e indica a versão
  esperada, para não produzir evidência com banco incompatível.
- Porta já ocupada por outro processo: a subida falha com mensagem que indica a porta e como
  configurá-la, sem iniciar parcialmente em silêncio.
- Trabalhador de tarefas parado com servidor ativo: a verificação de saúde mostra o servidor
  saudável e o trabalhador indisponível, separadamente.
- Pacote do design system ausente ou em versão diferente da fixada: a construção da interface
  falha, sem cair em estilos locais.
- Máquina Windows local e verificação remota Linux: comandos documentados funcionam nos dois, ou
  a diferença fica documentada com alternativa.
- Arquivo de configuração de ambiente ausente: a aplicação recusa iniciar e lista as variáveis
  obrigatórias, sem usar valores padrão para segredos.
- Migração interrompida no meio durante a reinicialização local: a próxima execução detecta o
  estado e reaplica do zero ou conclui, sem deixar banco parcialmente migrado marcado como pronto.
- Decisão registrada como confirmada sem responsável ou data: a verificação automática rejeita.

## Requirements *(mandatory)*

### Functional Requirements

**Decisões e repositório**

- **FR-001**: O repositório MUST conter um registro de decisões de arquitetura com uma entrada
  para cada decisão `D-01` a `D-05`, contendo estado, data, responsável, contexto, alternativa
  escolhida, alternativas rejeitadas, consequências e requisitos afetados.
- **FR-002**: Uma decisão MUST só ter estado `confirmada` com data e responsável preenchidos; a
  verificação automática MUST rejeitar entradas incompletas.
- **FR-003**: O portão de prontidão para implementação de F01 e F02 MUST falhar enquanto `D-01` a
  `D-04` não estiverem confirmadas; especificar e planejar essas fatias continua permitido. F00
  MUST registrar `D-01`, `D-02` e `D-03` como confirmadas em 2026-10-26 e `D-04` como proposta,
  com as alternativas a avaliar (autorização síncrona sem cache, conforme referência, ou
  validação local com mecanismo de revogação) e o impacto em `COM-018`, `SC-027`, `SC-028` e
  `T-03`.
- **FR-004**: O repositório MUST conter uma cópia versionada dos escopos de origem (ou referência
  imutável a uma versão deles), para que especificações e testes citem identificadores estáveis.
- **FR-005**: O repositório MUST seguir o fluxo de branch por funcionalidade com revisão antes da
  integração, documentado no guia de contribuição.

**Ambiente local**

- **FR-006**: Um comando documentado MUST subir servidor, trabalhador de tarefas, interface e
  MySQL de desenvolvimento, com dados sintéticos carregados, a partir de um clone limpo.
- **FR-007**: O ambiente MUST criar os bancos lógicos `spark_core` e `spark_identity` separados e
  permitir criar bancos de instância de teste a partir do produto de referência (`COM-003`,
  `COM-005`, `COM-006`).
- **FR-008**: O ambiente MUST usar credenciais distintas para execução web, trabalhador de
  provisionamento e operação de instância; a credencial web e a operacional MUST NOT criar bancos
  nem alterar estruturas.
- **FR-009**: O servidor e o trabalhador MUST pertencer ao mesmo código e ao mesmo artefato de
  implantação, com o trabalhador como processo separado (`COM-004`).
- **FR-010**: A configuração MUST vir do ambiente de execução, sem segredos em arquivos
  versionados; a aplicação MUST recusar iniciar se faltar configuração obrigatória.
- **FR-011**: O comando de reinicialização do ambiente local MUST recriar os bancos de
  desenvolvimento e MUST recusar executar fora de desenvolvimento.

**Saúde, contratos e observabilidade básica**

- **FR-012**: O SparkCore MUST oferecer verificação de situação operacional com versão do sistema,
  versão de schema de cada banco lógico e estado de servidor, trabalhador e bancos
  (`SAUDAVEL`, `DEGRADADA`, `INDISPONIVEL`, `DESCONHECIDA`), sem dados de negócio.
- **FR-013**: O repositório MUST publicar a convenção de contratos: versionamento, formato de erro
  (código estável, mensagem segura, campo, repetição possível, correlação), cabeçalho de
  correlação, semântica de chave de idempotência e política de respostas `401`, `403`, `404`,
  `409`, `422` e `503`.
- **FR-014**: O repositório MUST publicar o catálogo das seis capacidades consumidas pelo Tuteli,
  com versão, fatia responsável e estado; o contrato da situação operacional MUST estar completo
  em F00.
- **FR-015**: Toda resposta MUST conter identificador de correlação, gerado quando ausente, e todo
  log de requisição MUST ser estruturado e conter esse identificador e o produto.
- **FR-016**: Nenhuma resposta ou página MUST expor SQL, segredo, credencial ou rastreamento de
  pilha. Logs MAY conter rastreamento de pilha e o texto do comando SQL para diagnóstico, mas
  MUST NOT conter segredos, credenciais, tokens nem valores de parâmetros de SQL.

**Verificação automática**

- **FR-017**: Cada mudança proposta MUST passar por verificação de tipos, análise estática, testes
  de regras, testes de integração contra MySQL da versão adotada, migrações a partir de banco vazio
  e da versão anterior suportada, validação de contratos, detecção de segredos e jornada de ponta a
  ponta da página base (`NFR-011`, `NFR-012`).
- **FR-018**: Falha em qualquer etapa MUST bloquear a integração e indicar etapa e teste.
- **FR-019**: Migrações publicadas MUST ser imutáveis; checksum divergente MUST falhar a
  verificação.
- **FR-020**: A mesma verificação MUST poder ser executada localmente por comando documentado.
- **FR-021**: Testes de persistência MUST usar MySQL real; a verificação MUST NOT aceitar
  substitutos do banco como evidência dessas propriedades.

**Interface e design system**

- **FR-022**: A interface MUST ser React + TypeScript com Tailwind CSS (`COM-001`, `NFR-001`) e
  MUST consumir `@sparkling-hub/design-system` pela API pública, em versão fixada, com a raiz sob
  o tema da Sparkling Hub e a folha de estilos importada uma única vez.
- **FR-023**: A página base MUST usar apenas componentes e blocos públicos do design system e
  MUST tratar os estados inicial, carregando, sucesso e erro de rede/API.
- **FR-024**: A página base MUST funcionar de 360 px a desktop sem rolagem horizontal, com
  navegação por teclado e foco visível (`NFR-002`).
- **FR-025**: O repositório MUST NOT conter cópia editada de componentes, estilos de controle ou
  tokens do design system; a verificação automática SHOULD detectar essa duplicação.

**Produto de referência e dados sintéticos**

- **FR-026**: O repositório MUST conter o produto de referência sintético com artefato de
  migração em duas versões consecutivas, marcador de identidade da instância e registro de versão
  e checksum.
- **FR-027**: O produto de referência MUST NOT aparecer como SaaS oferecível nem conter regras de
  negócio do Tuteli.
- **FR-028**: O repositório MUST conter um conjunto de dados sintéticos idempotente, com marcação
  de fictício, e o carregamento MUST recusar ambientes identificados como produção (`NFR-016`).

### Key Entities *(include if feature involves data)*

- **Registro de decisão**: decisão de arquitetura identificada (`D-01` …), com estado, data,
  responsável, alternativas, consequências e requisitos afetados; pode substituir outra.
- **Contrato**: capacidade exposta pelo SparkCore, com versão, consumidor, fatia responsável,
  estado e esquema de requisição, resposta e erros.
- **Artefato de migração**: conjunto ordenado e imutável de versões de schema de um produto, cada
  uma com checksum; o do produto de referência tem duas versões.
- **Marcador de instância**: registro no banco de uma instância que identifica seu UUID e a tarefa
  proprietária, usado depois para provar propriedade (F02).
- **Ambiente**: desenvolvimento, homologação ou produção, que determina quais comandos e dados
  são permitidos.
- **Conjunto de dados sintéticos**: registros fictícios marcados, carregáveis de forma idempotente
  apenas em desenvolvimento e homologação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-001**: Uma pessoa que nunca usou o repositório chega ao ambiente local saudável em até 30
  minutos, seguindo apenas a documentação, em Windows e em Linux.
- **CS-002**: 100% das decisões `D-01` a `D-05` estão registradas com todos os campos
  obrigatórios; `D-01` a `D-03` e `D-05` estão confirmadas ao fim de F00, e o portão impede
  implementar F01 e F02 em 100% das tentativas enquanto `D-04` não for confirmada.
- **CS-003**: Em 10 de 10 mudanças de teste com uma falha deliberada (teste, tipo, migração
  alterada, segredo, contrato divergente), a integração é bloqueada na etapa correta.
- **CS-004**: A verificação completa de uma mudança termina em até 15 minutos.
- **CS-005**: Reconstruir os bancos do zero duas vezes seguidas e migrar da versão anterior
  produzem estruturas idênticas em 100% das execuções.
- **CS-006**: Zero segredos em arquivos versionados; zero ocorrências de SQL, credencial ou
  rastreamento de pilha em respostas e páginas; zero segredos, credenciais ou valores de
  parâmetros SQL nos logs verificados.
- **CS-007**: A página base passa na jornada de ponta a ponta em 360 px e desktop, só com teclado,
  nos estados de carregamento, sucesso e erro.
- **CS-008**: O carregamento de dados sintéticos é recusado em 100% das tentativas contra ambiente
  de produção.

## Assumptions

- O repositório git é `core/core.sparkilnghub.com.br`, com remoto no GitHub; a verificação remota
  roda no serviço de integração contínua associado a esse remoto, e a local no mesmo conjunto de
  etapas.
- O MySQL de desenvolvimento roda em contêiner local (Docker disponível na máquina de referência);
  a versão exata do MySQL é escolhida e registrada em `D-05` e passa a ser a versão dos testes.
- Node.js 24 LTS é a referência de execução local, alinhada à versão validada pelo design system;
  a versão final é registrada em `D-05`.
- O design system é consumido como pacote gerado pelo próprio design system (`npm pack`), na
  versão mais recente testada na data do plano (0.2.0), fixada; publicação em registro privado
  fica para depois, sem mudar o contrato de consumo.
- Lacunas do design system que F00 precisar são propostas no design system; a página base usa
  apenas o que existe na versão fixada.
- `D-04` em aberto não bloqueia F00 nem a especificação de F01; bloqueia a implementação de F01
  e F02 até ser confirmada ou substituída.
- Decisões `D-06` a `D-12` não bloqueiam F00 e são tratadas nas fatias que as exigem.
- Hospedagem, domínio, TLS de produção, backup e segredos de produção ficam fora de F00; F00 só
  define que a configuração vem do ambiente.
- O conjunto de dados sintéticos de F00 é mínimo (ambiente e produto de referência); cada fatia
  seguinte o amplia.
- Nenhuma atividade do Tuteli é feita nesta fatia, conforme a constituição v1.1.0.
