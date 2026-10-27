# Feature Specification: F02 — Catálogo e provisionamento

**Feature Branch**: `003-f02-catalogo-provisionamento`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "Fatia F02 — Catálogo e provisionamento (docs/escopos/03-plano-sdd.md §3): contratante, produto SparkPet no catálogo, instância, banco próprio, migrações, credencial restrita, falha e retomada. Requisitos: SC-003 a SC-009; SC-014 a SC-024; COM-025 a COM-027; NFR-013, NFR-014 (docs/escopos/01-sparkcore-mvp.md e 00-diretrizes-compartilhadas.md). Cenários T-01 (provisionamento repetido) e T-02 (queda entre etapas). Decisões confirmadas D-01 a D-05 (docs/adr). Base: F00 e F01 concluídas (projeção de acesso D-04 por instância, produto de referência sparkref). O SparkPet só é desenvolvido depois do SparkCore: o \"schema mínimo SparkPet\" é atendido pelo artefato de migração do produto, com o produto de referência validando o fluxo."

**Rastreabilidade**: `SC-003` a `SC-009`; `SC-014` a `SC-024`; `COM-025` a `COM-027`; `NFR-013`,
`NFR-014`; aceites `CA-SC-002`, `CA-SC-003`, `CA-SC-005` a `CA-SC-007`; regras `RN-SC-001`,
`RN-SC-002`, `RN-SC-004`, `RN-SC-005`; cenários `T-01`, `T-02` e `T-04` (instâncias novas);
decisões `D-03`, `D-04`, `D-07` e `D-09` (confirmadas ou assumidas conforme ADRs); constituição
v1.2.1, princípios I, III, IV, V, VI, VII e VIII. Critérios de sucesso usam o prefixo `CS-` para não
colidir com `SC-*`.

## Contexto e limites

F02 transforma uma contratação administrativa em uma instância **pronta**: o administrador da
plataforma cadastra o contratante, escolhe um produto do catálogo, informa os dados da instância e
acompanha uma tarefa persistente que cria o banco operacional exclusivo, o banco de acesso
companheiro (D-04), a credencial operacional restrita, aplica as migrações do produto, grava o
marcador de identidade e prepara o convite inicial. A instância termina em `PRONTA`; ativar,
suspender, reativar e manter pertencem a F03.

Tudo é provado com o **artefato de migração do produto de referência** (`sparkref`), não com o
schema do SparkPet (constituição, "SparkCore primeiro"). O formato desse artefato é o contrato que
o SparkPet adotará. O SparkPet entra no catálogo como produto **ainda não provisionável** até
publicar seu artefato.

Atores:

- **Administrador da plataforma** — único papel do painel Core (`SC-001`), com MFA (F01).
- **Trabalhador de provisionamento** — identidade técnica de sistema, mesma base de código do Core,
  com credencial própria de provisionamento (F00); não é perfil de usuário.
- **Produto** — em F02, o produto de referência, que obtém a conexão da sua instância e valida
  sessões na projeção de acesso (F01).
- **Pessoa convidada como administrador inicial** — aceita o convite inicial da instância (F01).

**Fora de F02**: ativação, suspensão, reativação, manutenção, encerramento e cancelamento de
instância (F03, `SC-025` a `SC-031`); atualização de schema de instância existente e executor de
migrações em manutenção (`SC-044`, F03); saúde técnica periódica e backup (`SC-042`, `SC-043`,
F03); utilização, acessos e consulta de auditoria (F08-Core); rotação da credencial operacional;
remoção de recursos físicos pela interface (`RN-SC-004`); transferência de instância entre
contratantes (`RN-SC-005`); artefato e telas do SparkPet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cadastro e manutenção de contratantes (Priority: P1)

O administrador da plataforma cadastra o cliente contratante com os dados mínimos, recebe alerta de
possíveis homônimos ou documento já usado antes de salvar, pesquisa por nome, documento ou contato,
edita dados e inativa um contratante que não deve receber novas instâncias.

**Why this priority**: toda instância pertence a um contratante (`SC-014`); sem esse cadastro não
há como começar a Jornada A.

**Independent Test**: cadastrar dois contratantes (pessoa física e jurídica), tentar um terceiro
com documento repetido e outro com nome parecido, pesquisar, editar e inativar, conferindo
recusas, alertas e auditoria.

**Acceptance Scenarios**:

1. **Given** um administrador autenticado, **When** cadastra contratante com nome/razão social, nome
   de exibição, tipo (física ou jurídica), contato responsável e e-mail, **Then** o contratante é
   criado `ativo`, com UUID, autor e instante registrados (`SC-003`).
2. **Given** um CPF ou CNPJ informado, **When** o formato ou os dígitos verificadores não conferem,
   **Then** o cadastro é recusado indicando o campo; quando conferem, o documento é gravado
   normalizado (`SC-004`).
3. **Given** um documento já usado por outro contratante, **When** se tenta cadastrá-lo de novo,
   **Then** a criação é recusada com conflito e indicação do contratante existente.
4. **Given** contratantes com nome semelhante, **When** o administrador começa um novo cadastro,
   **Then** vê os possíveis homônimos antes de confirmar e pode prosseguir; nada é fundido
   automaticamente (`SC-005`). E-mail de contato repetido não é tratado como duplicidade.
5. **Given** muitos contratantes, **When** pesquisa por nome, documento ou contato, **Then** recebe
   resultados paginados, cada um com seus produtos e instâncias vinculados (`SC-005`).
6. **Given** um contratante com instâncias, **When** seu nome de exibição é editado, **Then** UUID,
   bancos, identificador de acesso e histórico das instâncias não mudam (`CA-SC-002`).
7. **Given** um contratante com instância `ATIVA`, **When** o administrador tenta inativá-lo,
   **Then** a ação é recusada listando as instâncias que impedem, e nenhum estado muda
   (`SC-006`, `CA-SC-003`).
8. **Given** um contratante inativo, **When** se tenta solicitar nova instância para ele, **Then** a
   solicitação é recusada (`SC-006`).
9. **Given** dois administradores editando o mesmo contratante, **When** o segundo salva sobre uma
   versão antiga, **Then** recebe conflito e é orientado a recarregar, sem perder o que digitou
   (`COM-027`).

---

### User Story 2 - Catálogo de produtos (Priority: P1)

O administrador consulta o catálogo de produtos, vê para cada um o código, nome, situação, versão
implantada, versão de schema suportada e se ele é provisionável, e pode inativar um produto para
novas contratações. Um produto só é provisionável quando o artefato de migração publicado com a
versão implantada do Core está presente e válido.

**Why this priority**: o provisionamento depende de saber o que pode ser provisionado e com qual
versão (`SC-007`, `SC-009`); impedir envio de scripts pela interface é regra de segurança.

**Independent Test**: com o catálogo inicial (SparkPet sem artefato e, fora de produção, o produto
de referência), conferir quem é provisionável, inativar e reativar um produto e verificar que
instâncias existentes não mudam.

**Acceptance Scenarios**:

1. **Given** o catálogo, **When** consultado, **Then** mostra código, nome, descrição curta,
   situação, versão implantada, versão de schema suportada, identificador do provisionador e
   indicação de provisionável ou o motivo de não ser (`SC-007`).
2. **Given** o SparkPet cadastrado sem artefato de migração publicado, **When** se tenta solicitar
   instância dele, **Then** a solicitação é recusada informando que o produto ainda não é
   provisionável (`SC-009`).
3. **Given** um produto cujo artefato tem checksum divergente, versão fora de sequência ou
   construção proibida, **When** o catálogo é consultado ou se solicita instância, **Then** o produto
   aparece como não provisionável e a solicitação é recusada, sem SQL ou caminho interno na
   mensagem.
4. **Given** um produto ativo com instâncias, **When** o administrador o inativa, **Then** novas
   solicitações são recusadas e as instâncias existentes não mudam de estado (`SC-008`).
5. **Given** a interface do catálogo, **When** inspecionada, **Then** não existe campo para enviar
   SQL, script, executável ou URL de código, nem para alterar o código de um produto (`SC-009`).
6. **Given** o ambiente de produção, **When** o catálogo é consultado, **Then** o produto de
   referência não aparece nem pode ser provisionado (constituição III).

---

### User Story 3 - Solicitar e provisionar uma instância até PRONTA (Priority: P1)

O administrador escolhe o contratante e o produto, informa nome de exibição, identificador de
acesso (slug), fuso horário e e-mail do administrador inicial, revisa um resumo sem credenciais,
reconfirma o segundo fator e confirma. Recebe imediatamente um protocolo e acompanha as etapas da
tarefa: reserva, criação dos bancos, credencial operacional, migrações, configuração e marcador,
convite inicial e verificação, até a instância ficar `PRONTA`.

**Why this priority**: é a entrega central da fatia — implantar sem SQL manual (indicador do
escopo §1.2) e sem duplicidade (`CA-SC-005`, `T-01`).

**Independent Test**: provisionar duas instâncias do produto de referência para contratantes
distintos, repetir a mesma solicitação com a mesma chave, disputar o mesmo slug em paralelo e
conferir uma instância, uma tarefa e um banco por solicitação efetiva, com credenciais isoladas.

**Acceptance Scenarios**:

1. **Given** contratante ativo e produto provisionável, **When** o administrador confirma a
   solicitação com MFA recente, **Then** a resposta traz protocolo, UUID e estado `CADASTRADA` sem
   esperar a tarefa terminar (`SC-020`); a tarefa é criada uma única vez.
2. **Given** a tarefa em execução, **When** o administrador acompanha o protocolo, **Then** vê cada
   etapa com estado, tentativas, início e fim, e a instância passa por `PROVISIONANDO` até `PRONTA`
   (`SC-020`).
3. **Given** a instância `PRONTA`, **When** inspecionada, **Then** tem banco operacional e banco de
   acesso derivados do UUID, credencial operacional que só alcança esses bancos e não cria bancos
   nem altera estrutura, migrações aplicadas com versões e checksums registrados, marcador de
   identidade com o UUID e configuração obrigatória gravada (`SC-019`, `SC-016`, `SC-021`).
4. **Given** a mesma solicitação reenviada com a mesma chave de idempotência e os mesmos dados,
   **When** processada, **Then** devolve o mesmo protocolo e a mesma instância, sem novo banco ou
   convite; com dados diferentes, retorna conflito (`COM-026`, `T-01`).
5. **Given** duas solicitações simultâneas para o mesmo slug no mesmo produto, com chaves
   diferentes, **When** processadas, **Then** no máximo uma instância, uma tarefa efetiva e um banco
   são criados; a outra recebe conflito de identificador em uso (`CA-SC-005`, `COM-025`).
6. **Given** um slug com maiúsculas, acentos, espaços ou palavra reservada, **When** informado,
   **Then** é normalizado ou recusado segundo a política, e o resumo mostra o valor final antes da
   confirmação (`SC-015`).
7. **Given** a instância `PRONTA` mas ainda não ativa, **When** um usuário tenta entrar nela pelo
   produto, **Then** o login é recusado; nenhum uso operacional é liberado antes da ativação (F03).
8. **Given** duas instâncias provisionadas A e B, **When** a credencial operacional de A tenta ler
   ou gravar no banco de B ou no banco de acesso de B, **Then** o MySQL nega por privilégio
   (`T-04`, constituição I).
9. **Given** o resumo, o protocolo, a tela, os logs e o histórico da tarefa, **When** inspecionados,
   **Then** nenhum deles contém a senha da credencial operacional nem SQL (`SC-014`, constituição
   VI).

---

### User Story 4 - Falha, retomada e repetição (Priority: P1)

Se uma etapa falha ou o trabalhador cai no meio, a tarefa é retomada da última etapa válida sem
duplicar recursos, reconhecendo os recursos que ela mesma criou. Esgotadas as tentativas
automáticas, a instância fica em `FALHA_PROVISIONAMENTO`, o painel mostra etapa, protocolo e erro
sanitizado, e o administrador pode solicitar nova execução depois de corrigir a causa.

**Why this priority**: quedas e reinícios são situações normais (constituição IV, `NFR-014`); o
critério de conclusão 3 do Core exige provar retomada sem duplicidade (`T-02`).

**Independent Test**: interromper o trabalhador após a criação do banco e antes das migrações,
reiniciá-lo e conferir a conclusão sem banco ou convite duplicado; forçar falha de migração e
conferir o estado, a mensagem e a repetição.

**Acceptance Scenarios**:

1. **Given** banco criado e migração não iniciada, **When** o trabalhador é interrompido e outro
   assume após o fim do lease, **Then** reconhece o banco pela prova de propriedade, conclui as
   migrações e mantém o histórico da execução interrompida (`CA-SC-006`, `T-02`).
2. **Given** um trabalhador com lease válido operando a instância, **When** outro trabalhador tenta
   assumir a mesma tarefa ou outra tarefa estrutural da mesma instância, **Then** não consegue até o
   lease expirar (`SC-022`, `RN-SC-002`).
3. **Given** uma migração que falha, **When** as tentativas automáticas se esgotam, **Then** a
   instância fica `FALHA_PROVISIONAMENTO`, o login operacional continua bloqueado e o painel mostra
   etapa, protocolo e mensagem sem SQL ou senha (`CA-SC-007`, `SC-023`).
4. **Given** uma instância `FALHA_PROVISIONAMENTO`, **When** o administrador solicita nova
   execução com MFA recente, **Then** a mesma tarefa recomeça da última etapa válida, com novo
   contador de tentativas e o histórico anterior preservado (`SC-023`).
5. **Given** um banco com o nome derivado do UUID que existe sem o marcador desta instância ou com
   marcador de outra, **When** a tarefa chega a essa etapa, **Then** não o reutiliza nem o apaga, a
   tarefa falha com "recurso em conflito" e exige procedimento operacional (`SC-021`, `T-02`).
6. **Given** o painel, **When** a instância está em falha, **Then** não existe ação para editar SQL,
   credencial, etapa ou estado técnico para simular sucesso (`SC-023`).
7. **Given** a tarefa concluída, **When** o trabalhador é reiniciado, **Then** nenhuma etapa é
   executada de novo (`NFR-014`).

---

### User Story 5 - Convite inicial e caminho para o primeiro administrador (Priority: P2)

A tarefa prepara o convite inicial da instância para o e-mail informado, sem gerar o link. Na
instância `PRONTA`, o administrador da plataforma emite o link de uso único, exibido uma única vez
para entrega por canal seguro (`D-07`), e pode reemiti-lo se expirar ou se perder. Falha ou atraso
na entrega nunca recria banco.

**Why this priority**: uma instância pronta só poderá ser ativada em F03 se houver caminho válido
para o primeiro administrador (`SC-024`); depende das histórias 3 e 4 e dos convites de F01.

**Independent Test**: provisionar uma instância, emitir o link, deixá-lo expirar, reemitir,
aceitar com conta nova e com conta existente, e conferir que o banco não foi tocado.

**Acceptance Scenarios**:

1. **Given** a etapa de convite concluída, **When** a instância chega a `PRONTA`, **Then** existe um
   convite inicial de administrador da instância para o e-mail informado, com estado "aguardando
   emissão do link"; nenhum link foi exibido ou gravado em texto.
2. **Given** a instância `PRONTA`, **When** o administrador da plataforma emite o link com MFA
   recente, **Then** vê o link uma única vez, válido por 48 horas; reemitir invalida o anterior
   (`COM-019`, `D-07`).
3. **Given** o link emitido, **When** a pessoa o aceita antes da ativação, **Then** cria ou
   autentica sua conta e o vínculo de administrador fica registrado, sem liberar uso operacional
   da instância (`COM-020`, `SC-024`).
4. **Given** o convite inicial expirado, **When** o administrador da plataforma reemite, **Then** um
   novo link vale por 48 horas; o banco, a credencial e as migrações não são tocados (`SC-024`).
5. **Given** uma instância `PRONTA`, **When** consultada, **Then** o painel mostra separadamente a
   prontidão técnica e a situação do caminho de acesso (convite aguardando emissão, emitido,
   expirado, aceito), de modo que F03 possa exigir esse caminho para ativar (`SC-024`).

---

### User Story 6 - Consulta e acompanhamento de instâncias (Priority: P2)

O administrador lista e filtra instâncias, abre o detalhe com contratante, produto, slug, fuso,
estado, versões, administrador inicial, linha do tempo de transições e tarefas, e registra
anotações administrativas e datas opcionais de vigência; o nome de exibição pode mudar, o slug não.

**Why this priority**: acompanhar provisionamentos é parte da Jornada A, mas a fatia já entrega
valor com as histórias 1 a 4.

**Independent Test**: com instâncias em estados diferentes, filtrar por contratante, produto,
estado e período de criação; abrir o detalhe, editar nome e anotações e tentar editar o slug.

**Acceptance Scenarios**:

1. **Given** várias instâncias, **When** filtradas por contratante, produto, estado e período de
   criação, **Then** a lista é paginada e mostra estado e protocolo da última tarefa (`SC-018`).
2. **Given** o detalhe de uma instância, **When** aberto, **Then** mostra linha do tempo das
   transições (estado anterior e novo, ator, motivo, instante), tarefas e etapas, versão de schema
   aplicada e administrador inicial, sem credencial ou senha (`SC-014`, `SC-018`).
3. **Given** uma instância após o início do provisionamento, **When** se tenta mudar o slug,
   **Then** a mudança não é oferecida e é recusada pelo servidor; o nome de exibição pode ser
   alterado com auditoria (`SC-016`).
4. **Given** datas de vigência informadas, **When** a data de fim passa, **Then** a instância
   aparece com pendência administrativa de vigência vencida, sem mudança de estado nem cálculo de
   cobrança (`SC-017`, `RN-SC-003`).
5. **Given** as instâncias sintéticas criadas pelas sementes de F01, **When** a fatia é instalada,
   **Then** elas aparecem no catálogo de instâncias com contratante sintético, produto de
   referência e estado coerente, mantendo UUID, bancos e sessões existentes.

### Edge Cases

- Solicitação repetida após timeout da resposta: a interface consulta o protocolo ou reenvia a
  mesma chave e recebe o mesmo resultado (`T-15`, `COM-026`).
- Mesmo slug em produtos diferentes: permitido; o slug é único por produto.
- Slug de instância que nunca chegou a provisionar ou que falhou: continua reservado para aquela
  instância; não é reaproveitado por outra.
- Contratante inativado enquanto uma tarefa está em execução: a tarefa conclui até `PRONTA`; a
  ativação (F03) exigirá contratante elegível (`SC-029`).
- Produto inativado durante uma tarefa: a tarefa em curso conclui; novas solicitações são
  recusadas (`SC-008`).
- Versão implantada do Core muda durante uma tarefa: a tarefa conclui com a versão de artefato
  registrada no seu início ou falha de forma visível; nunca mistura versões.
- MySQL indisponível durante a tarefa: tentativa contada, espera progressiva e retomada; se
  persistir além do limite, `FALHA_PROVISIONAMENTO` com erro sanitizado.
- Credencial de provisionamento sem privilégio para criar bancos ou usuários: falha na primeira
  etapa afetada com orientação operacional, sem tentar caminho alternativo nem banco compartilhado.
- Usuário MySQL da instância já existente sem prova de propriedade: tratado como recurso em
  conflito, igual ao banco (`SC-021`).
- Trabalhador cai depois de executar um comando que faz commit implícito e antes de registrar a
  etapa: a retomada verifica o efeito real antes de repetir.
- Trabalhador cai **no meio** de uma versão de migração (entre duas instruções da mesma versão):
  como o MySQL não desfaz DDL, a versão não é repetida às cegas; a instância fica
  `FALHA_PROVISIONAMENTO` com orientação de procedimento operacional, e a nova execução não
  resolve esse caso (research R-07). Quedas entre versões ou entre etapas retomam normalmente.
- Convite inicial para e-mail de conta bloqueada globalmente: o convite pode ser emitido, mas a
  aceitação segue as regras de F01 e é recusada para conta bloqueada.
- Documento CNPJ no formato alfanumérico: aceito e validado como o numérico.
- Fuso inválido ou não suportado: recusado na solicitação, com o padrão `America/Sao_Paulo` sugerido
  (`D-09`).
- Duas edições simultâneas do nome de exibição da instância: a segunda recebe conflito
  (`COM-027`).

## Requirements *(mandatory)*

### Functional Requirements

**Contratantes**

- **FR-001**: O sistema MUST permitir cadastrar, consultar, editar, inativar e reativar
  contratantes com: UUID, nome/razão social, nome de exibição, tipo (pessoa física ou jurídica),
  contato responsável, e-mail, telefone opcional, CPF/CNPJ opcional, endereço opcional, situação e
  autor e instante de criação e alteração (`SC-003`, `SC-004`).
- **FR-002**: Documento informado MUST ter formato e dígitos verificadores válidos para o tipo
  (CPF para pessoa física; CNPJ numérico ou alfanumérico para pessoa jurídica), MUST ser gravado
  normalizado e MUST ser único entre contratantes, ativos ou inativos (`SC-004`).
- **FR-003**: Antes de criar um contratante, o sistema MUST apresentar possíveis homônimos por nome
  e por documento; MUST NOT fundir cadastros nem tratar e-mail de contato repetido como duplicidade
  (`SC-004`, `SC-005`).
- **FR-004**: A pesquisa MUST aceitar nome, documento e contato, MUST ser paginada e MUST mostrar
  produtos e instâncias vinculados a cada contratante (`SC-005`).
- **FR-005**: Inativar contratante MUST ser recusado enquanto houver instância `ATIVA`, informando
  quais; contratante inativo MUST NOT receber novas instâncias; inativação não altera instâncias
  nem recursos (`SC-006`, `CA-SC-003`, `RN-SC-004`).

**Catálogo de produtos**

- **FR-006**: O catálogo MUST manter, por produto: código único e imutável, nome, descrição curta,
  situação, versão implantada, versão de schema suportada e identificador do provisionador
  (`SC-007`).
- **FR-007**: Provisionadores e artefatos de migração MUST vir apenas do código implantado do Core,
  validados por manifesto e checksums; a interface MUST NOT aceitar SQL, scripts, executáveis ou
  URLs de código, nem trocar o provisionador de um produto (`SC-009`, constituição VII).
- **FR-008**: Um produto MUST ser provisionável somente se estiver ativo e tiver provisionador,
  versão e artefato válidos; caso contrário, solicitar instância MUST ser recusado com motivo
  seguro (`SC-009`).
- **FR-009**: Inativar produto MUST bloquear novas solicitações sem alterar instâncias existentes
  (`SC-008`).
- **FR-010**: O catálogo inicial MUST conter o SparkPet como produto não provisionável até o
  artefato do SparkPet ser publicado; o produto de referência MUST existir apenas em ambientes de
  desenvolvimento e homologação e MUST NOT aparecer ou ser provisionável em produção (constituição
  III).

**Solicitação de instância**

- **FR-011**: Uma instância MUST pertencer a um contratante e a um produto e conter UUID gerado pelo
  servidor, nome de exibição, slug, fuso, estado, revisão de autorização, e-mail do administrador
  inicial, versões e metadados de infraestrutura sem segredo (`SC-014`).
- **FR-012**: O slug MUST ser normalizado (minúsculas, sem acentos, letras, dígitos e hífen, 3 a 63
  caracteres, começando por letra), MUST recusar palavras reservadas da política e MUST ser único
  por produto, inclusive frente a instâncias com falha; o resumo MUST exibir o valor final antes
  da confirmação (`SC-015`).
- **FR-013**: O slug MUST ser imutável depois da confirmação; o nome de exibição MAY mudar, com
  auditoria; nomes de bancos e de usuários MySQL MUST derivar apenas do UUID e do prefixo do
  produto, nunca de texto livre (`SC-016`).
- **FR-014**: Várias instâncias por contratante, inclusive do mesmo produto, MUST ser permitidas;
  cada instância corresponde a um estabelecimento (`SC-015`, `D-03`).
- **FR-015**: O fuso MUST ser um identificador de fuso válido, com padrão `America/Sao_Paulo`
  (`D-09`).
- **FR-016**: Anotações administrativas e datas opcionais de início e fim de vigência MUST poder
  ser registradas; vigência vencida MUST aparecer como pendência administrativa, sem mudança de
  estado nem cobrança (`SC-017`, `RN-SC-003`).
- **FR-017**: Confirmar a solicitação MUST exigir reconfirmação do segundo fator feita nos últimos
  5 minutos, como nas ações sensíveis de F01 (`COM-017`, matriz §2.2).
- **FR-018**: A solicitação MUST exigir chave de idempotência vinculada a ator e operação, com
  resumo do conteúdo e resposta guardada por pelo menos 24 horas: mesma chave e mesmos dados
  devolvem o mesmo protocolo e instância; dados diferentes retornam conflito (`COM-026`, `T-01`).
- **FR-019**: Solicitações concorrentes para o mesmo produto e slug MUST resultar em no máximo uma
  instância, uma tarefa efetiva e um banco; a perdedora recebe conflito (`CA-SC-005`, `COM-025`).
- **FR-020**: A resposta da confirmação MUST trazer protocolo, UUID e estado sem esperar a tarefa
  terminar (`SC-020`).

**Tarefa de provisionamento**

- **FR-021**: O provisionamento MUST ser uma tarefa persistente com protocolo, etapas, tentativas,
  identidade do trabalhador, início, fim e erro sanitizado por etapa, executando no mínimo: (1)
  validar contratante, produto, slug e autorização; (2) reservar identidade e tarefa; (3) criar o
  banco operacional e o banco de acesso com charset e collation da plataforma; (4) criar a
  credencial operacional exclusiva; (5) aplicar as migrações do produto e registrar versões e
  checksums; (6) gravar configuração obrigatória e marcador de identidade; (7) preparar o convite
  inicial; (8) verificar conexão com a credencial operacional, versão, integridade mínima e
  prontidão do produto definida no contrato do artefato; (9) concluir em `PRONTA` (`SC-020`).
- **FR-022**: Cada etapa MUST ser idempotente e retomável: antes de repetir um efeito, a tarefa
  MUST verificar se ele já ocorreu; o provisionamento MUST NOT ser tratado como transação única
  (`SC-021`, diretrizes §5.2).
- **FR-023**: Um banco ou usuário MySQL existente MUST ser reutilizado somente com prova de
  propriedade (marcador com o UUID da instância e registro da tarefa proprietária); sem essa prova,
  a tarefa MUST falhar como "recurso em conflito" sem alterar nem remover o recurso (`SC-021`,
  `RN-SC-004`).
- **FR-024**: No máximo uma tarefa estrutural MUST operar uma instância por vez, com lease
  renovado por heartbeat; outro trabalhador MUST NOT assumir antes de o lease expirar, e a
  recuperação após expiração MUST seguir estratégia documentada (`SC-022`, `RN-SC-002`,
  `NFR-014`).
- **FR-025**: Falhas transitórias MUST ser repetidas automaticamente com espera progressiva até um
  limite; esgotado o limite ou diante de falha não transitória (recurso em conflito, artefato
  inválido, privilégio ausente), a instância MUST ir para `FALHA_PROVISIONAMENTO` com etapa e erro
  sanitizado visíveis (`SC-023`).
- **FR-026**: O administrador MUST poder solicitar nova execução de uma instância em
  `FALHA_PROVISIONAMENTO`, com segundo fator recente e chave de idempotência; a execução retoma da
  última etapa válida e preserva todo o histórico anterior. A interface MUST NOT permitir editar
  SQL, credencial, etapa ou estado técnico (`SC-023`).
- **FR-027**: Transições de estado da instância MUST seguir a máquina de estados do escopo
  (`CADASTRADA` → `PROVISIONANDO` → `PRONTA` ou `FALHA_PROVISIONAMENTO`; `FALHA_PROVISIONAMENTO` →
  `PROVISIONANDO`), executar suas pré-condições e registrar estado anterior, novo, ator (pessoa ou
  trabalhador), motivo e instante; MUST NOT existir edição direta de estado (`RN-SC-001`).
- **FR-028**: A instância MUST NOT permitir login operacional antes de `ATIVA`; em F02 nenhuma
  instância solicitada pelo painel chega a `ATIVA`; só as instâncias sintéticas das sementes são
  ativadas, fora de produção e com administrador ativo (Assumptions, research R-18)
  (`CA-SC-007`).

**Recursos, credenciais e isolamento**

- **FR-029**: Cada instância MUST ter banco operacional exclusivo e banco de acesso companheiro,
  ambos derivados do UUID, e credencial operacional exclusiva que só alcança esses dois bancos,
  com os privilégios da projeção de acesso definidos em F01 e sem privilégio para criar bancos ou
  alterar estrutura (`SC-019`, `COM-005`, constituição I).
- **FR-030**: A senha da credencial operacional MUST ser gerada aleatoriamente, MUST ficar cifrada
  com chave externa ao banco e MUST NOT aparecer em tela, log, auditoria, histórico de tarefa ou
  resposta ao painel (constituição VI).
- **FR-031**: O produto MUST obter a conexão da sua instância por contrato interno versionado,
  autenticado com credencial de aplicação do próprio produto e com escopo específico; MUST receber
  apenas conexões de instâncias do seu produto, e o pedido de outra instância MUST responder igual
  a inexistente (constituição III, diretrizes §6.1, "referência opaca de conexão").
- **FR-032**: Recursos de cada instância (bancos, usuário MySQL, referência ao segredo, marcador de
  propriedade) MUST ser registrados como pertencentes a uma única instância (`SC-021`).
- **FR-033**: O banco de acesso MUST receber a projeção de acesso de F01 na versão vigente, e a
  instância MUST passar a constar na reconciliação e na sincronização de revogações de F01.

**Convite inicial**

- **FR-034**: A etapa de convite MUST preparar um convite inicial de administrador da instância
  para o e-mail informado, sem gerar nem gravar o link; reexecutar a etapa MUST NOT duplicar o
  convite (`SC-024`).
- **FR-035**: O administrador da plataforma MUST poder emitir e reemitir o link do convite inicial
  de uma instância `PRONTA`, com segundo fator recente; o link MUST ser exibido uma única vez, valer
  48 horas e invalidar o anterior ao ser reemitido (`COM-019`, `D-07`).
- **FR-036**: Falha, atraso ou expiração do convite MUST NOT recriar banco nem repetir etapas
  estruturais; prontidão técnica e situação do convite MUST ser estados verificáveis e
  independentes (`SC-024`).

**Concorrência e edição**

- **FR-037**: Edições de contratante, produto e dados editáveis da instância MUST usar controle de
  versão otimista; conflito MUST pedir recarga preservando os dados digitados quando possível
  (`COM-027`).
- **FR-038**: Nenhuma solicitação, nova execução ou emissão de convite MUST ser efetivada duas
  vezes por repetição ou concorrência (`NFR-013`, `COM-026`).

**Auditoria, erros e observabilidade**

- **FR-039**: Criação, edição, inativação e reativação de contratante e produto; solicitação,
  nova execução, transições, mudança de nome, anotações e vigência de instância; emissão de
  convite inicial MUST gerar registro de auditoria administrativa com ator, objeto, ação,
  alteração segura (valor anterior e novo), correlação e instante, sem segredos; a consulta desses
  registros chega em F08-Core (`SC-034`, constituição VI).
- **FR-040**: Erros MUST trazer código estável, mensagem segura, campo quando cabível, indicação de
  repetição possível e correlação, sem SQL, nome de usuário MySQL, senha ou stack trace
  (constituição III).
- **FR-041**: A tarefa MUST registrar duração por etapa e resultado final, permitindo medir
  provisionamentos concluídos e falhos e o tempo até a prontidão (escopo §1.2, `NFR-010`).

**Interface do Core**

- **FR-042**: O painel MUST oferecer as telas Contratantes, Produtos, Instâncias (lista, filtros e
  criação guiada), Detalhe de instância (parte de F02) e Provisionamento (protocolo, etapas, falha,
  repetição e convite inicial), com o design system e a matriz de estados aplicável, inclusive
  carregamento, vazio, erro, conflito, sem permissão e paginação (`SC-018`, escopo §7,
  constituição VIII).
- **FR-043**: Acompanhar o provisionamento MUST mostrar o progresso sem o administrador precisar
  recarregar a página manualmente, e o resultado só MUST ser exibido como sucesso depois de
  confirmado pelo servidor.

**Instâncias anteriores a F02**

- **FR-044**: As instâncias sintéticas criadas em F01 MUST ser incorporadas ao modelo completo de
  instância, com contratante sintético, produto de referência e estado coerente com o uso atual,
  preservando UUID, slug, bancos, credenciais e sessões.

### Key Entities *(include if feature involves data)*

- **Contratante**: UUID, nome/razão social, nome de exibição, tipo, documento normalizado opcional,
  contato, e-mail, telefone, endereço opcional, situação, versão, autor e datas. Nome não é chave.
- **Produto**: código imutável, nome, descrição, situação, versão implantada, versão de schema
  suportada, provisionador, indicação de ambiente permitido (referência só fora de produção).
- **Instância**: UUID, contratante, produto, slug imutável, nome de exibição, fuso, estado,
  revisão de autorização, versão de schema aplicada, e-mail do administrador inicial, anotações,
  vigência, versão. `(produto, slug)` único; amplia a referência mínima de instância de F01.
- **Recurso de instância**: instância, tipo (banco operacional, banco de acesso, usuário MySQL),
  identificador, referência ao segredo cifrado, marcador de propriedade, tarefa que o criou.
- **Tarefa administrativa**: UUID, protocolo, instância, tipo (provisionamento; migração e
  restauração chegam depois), estado, chave de idempotência, ator, lease, trabalhador, tentativas,
  datas.
- **Execução de etapa**: tarefa, etapa, tentativa, estado, início, fim, erro sanitizado; execuções
  anteriores nunca são sobrescritas.
- **Transição de estado**: instância, estado anterior, novo, motivo, ator, instante; só inclusão.
- **Registro de auditoria Core**: ator, objeto, ação, alteração segura, correlação, instante; só
  inclusão.
- **Convite inicial**: convite de instância de F01 marcado como inicial, com situação "aguardando
  emissão", "emitido", "expirado", "aceito" ou "revogado".
- **Registro de idempotência**: ator, operação, chave, resumo do conteúdo, resposta, expiração
  (reuso do mecanismo de F01).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-001**: Um administrador cadastra um contratante e solicita uma instância do produto de
  referência em até 5 minutos, sem executar nenhum comando ou SQL fora do painel.
- **CS-002**: Em ambiente de referência, 95% das instâncias do produto de referência chegam a
  `PRONTA` em até 2 minutos após a confirmação.
- **CS-003**: Em 100 rodadas de solicitações concorrentes e repetidas (mesma chave, chaves
  diferentes para o mesmo slug, reenvio após timeout), 0 instâncias, tarefas efetivas, bancos ou
  convites duplicados.
- **CS-004**: Interrompendo o trabalhador em cada uma das etapas de 3 a 8 e reiniciando, 100% das
  tarefas chegam a `PRONTA` sem recurso duplicado e com o histórico da interrupção preservado.
- **CS-005**: 100% dos recursos encontrados sem prova de propriedade resultam em falha visível, sem
  reuso nem remoção.
- **CS-006**: 100% das tentativas da credencial operacional de uma instância de acessar outra
  instância, criar banco ou alterar estrutura são negadas.
- **CS-007**: Nenhuma senha de credencial operacional, link de convite, SQL ou stack trace aparece
  em telas, respostas, logs, auditoria ou histórico de tarefa verificados.
- **CS-008**: 100% das tentativas de inativar contratante com instância `ATIVA` são recusadas com a
  lista das instâncias, sem mudança de estado.
- **CS-009**: Depois de instalada a fatia, 100% das sessões e validações das instâncias sintéticas
  de F01 continuam funcionando, sem regressão nos contratos de F01.

## Assumptions

- **Fim do provisionamento em `PRONTA`**: a ativação explícita (Jornada A, passo 6) e as demais
  transições pertencem a F03, como no plano SDD; F02 deixa registrado o caminho de acesso que F03
  exigirá para ativar (`SC-024`, `SC-029`).
- **Produto de referência no catálogo**: `sparkref` é cadastrado pelas sementes de desenvolvimento e
  homologação como produto de referência; em produção ele não existe no catálogo (constituição III).
  O SparkPet entra no catálogo como produto não provisionável; seu artefato chegará com o
  repositório SparkPet, no formato já validado em F00.
- **Origem dos provisionadores**: cada produto provisionável tem um provisionador e um artefato
  publicados com o código implantado do Core; cadastrar produto novo pela interface não cria
  provisionador (`SC-008`). Em F02 o único provisionador é o do produto de referência, que reutiliza
  a aplicação de artefato e a projeção de acesso de F00 e F01.
- **Ambiente de prova**: o provisionamento real é provado em MySQL 8.4 de desenvolvimento e na CI
  com a credencial de provisionamento de F00. A confirmação dos privilégios disponíveis na
  hospedagem de produção (plano SDD §5, "Hospedagem e privilégio para criar bancos/usuários") segue
  pendente e é pré-requisito de produção, não desta fatia.
- **Entrega da credencial ao produto**: a senha operacional fica cifrada no Core com chave externa
  ao banco; o produto a obtém pelo contrato interno de conexão e pode mantê-la em memória para
  continuar validando sessões com o Core indisponível (F01, `T-15`). O mecanismo concreto é do
  plano técnico.
- **Convite inicial (`D-07`)**: o link é emitido pelo administrador da plataforma depois da
  prontidão e exibido uma única vez; a tarefa não gera link, pois roda sem ninguém para recebê-lo.
- **Tentativas automáticas**: limite proposto de 5 tentativas por etapa com espera progressiva,
  configurável; lease proposto de 60 segundos renovado por heartbeat, como na sincronização de F01.
- **Unicidade do documento**: um CPF ou CNPJ pertence a um único contratante, ativo ou inativo;
  exceções exigem decisão comercial registrada.
- **Palavras reservadas do slug**: lista versionada no repositório (por exemplo `admin`, `api`,
  `core`, `www`, `i`, `static`), definida no plano.
- **Instâncias de F01**: as instâncias sintéticas `ref-a` e `ref-b` passam a pertencer a um
  contratante sintético e ficam em estado equivalente a `ATIVA`, pois já operam sessões; isso só
  ocorre em desenvolvimento e homologação.
- **Metas de tempo**: as metas de CS-002 e CS-001 são de planejamento (`D-12`), medidas em ambiente
  de referência local.
