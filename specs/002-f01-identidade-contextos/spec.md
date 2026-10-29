# Feature Specification: F01 — Identidade e contextos do SparkCore

**Feature Branch**: `002-f01-identidade-contextos`

**Created**: 2026-10-26

**Status**: Draft (revisado após /speckit-analyze em 2026-10-26)

**Input**: User description: "Fatia F01 — Identidade e contextos do SparkCore, conforme docs/escopos/03-plano-sdd.md (seção 3) e constituição v1.1.1: bootstrap do primeiro administrador da plataforma, login com e-mail e senha, logout e recuperação, MFA TOTP do administrador da plataforma, sessões opacas por aplicação e contexto de instância, convites, vínculos (membership) e revogação, bloqueio global de conta, proteção do último administrador, e prova de isolamento com duas instâncias sintéticas do produto de referência. Contratos internos consumidos pelo Tuteli (autenticar/encerrar sessão, autorizar e resolver instância, vínculos locais) entram apenas como contrato oferecido pelo Core e provado com o produto de referência — nenhuma atividade no Tuteli. Requisitos: COM-007 a COM-020; SC-001, SC-002, SC-010 a SC-013; SP-001 a SP-005 (apenas como contrato); NFR-008, NFR-009. Decisão pendente D-04 (autorização síncrona no Core × validação local com revogação) deve ser resolvida nesta especificação."

**Rastreabilidade**: `COM-007` a `COM-020`; `SC-001`, `SC-002`, `SC-010` a `SC-013`; `SP-001` a
`SP-005` (somente o contrato oferecido pelo Core); `NFR-008`, `NFR-009`; cenários `T-04`, `T-05`,
`T-15`; decisões `D-02`, `D-04` e `D-07` (confirmadas); constituição v1.2.1, princípios I, II, III, IV,
VI e VIII. Critérios de sucesso usam o prefixo `CS-` para não colidir com `SC-*`.

## Contexto e limites

F01 dá ao SparkCore a capacidade de saber **quem** está agindo e **em qual contexto**. Ela entrega
o acesso do administrador da plataforma (com MFA), as contas e vínculos de usuários com instâncias
e os contratos que um produto usa para autenticar e autorizar seus usuários. Tudo que um produto
consome é provado com o **produto de referência sintético** (`sparkref`) e duas instâncias
sintéticas, sem nenhuma atividade no Tuteli (constituição VII, "SparkCore primeiro").

Atores:

- **Administrador da plataforma** — usuário interno da Sparkling Hub, único papel do painel Core
  (`SC-001`).
- **Pessoa convidada** — recebe convite para a plataforma ou para uma instância e cria ou usa sua
  conta.
- **Administrador e colaborador de instância** — papéis de produto (`SP-001`, `SP-002`) que, em
  F01, existem apenas como vínculos e como chamadas do produto de referência aos contratos.
- **Responsável pela implantação** — executa o procedimento protegido de bootstrap.

**Fora de F01**: cadastro de contratantes, produtos e instâncias com provisionamento real e
máquina de estados (F02); suspensão, reativação e manutenção (F03); consultas e relatórios de
acesso e utilização (F08-Core); MFA para usuários de produto; SSO e provedores sociais;
impersonação; qualquer tela ou código do Tuteli.

## Clarifications

### Session 2026-10-26

- Q: D-07 — como os links de convite e de recuperação chegam à pessoa no MVP? → A: o link de uso
  único é exibido uma única vez a quem o gerou, que o entrega por canal seguro; e-mail
  transacional fica como evolução sem mudar o contrato.
- Q: D-04 — como o produto verifica a autorização de cada requisição? → A: **validação local com
  revogação na instância**. Contas e senhas ficam só em `spark_identity` (`D-02`). O Core autentica
  e grava, no banco da instância, a sessão do usuário (identificador opaco `INSTANCE_TOKEN`) e a
  réplica dos vínculos daquela instância; o produto valida cada requisição consultando sessão,
  vínculo e revogações no próprio banco, sem chamar o Core. Revogações valem assim que gravadas na
  instância.
- Q: Administradores da plataforma têm acesso às instâncias? → A: **não**. Mantém `COM-010` e a
  constituição: o administrador da plataforma não entra nas instâncias nem vê dados de negócio. A
  proposta inicial de `ADMIN_TOKEN` irrestrito e sem revogação foi descartada por conflitar com os
  princípios I e II.
- Consequência: a constituição foi emendada (v1.2.0) para permitir ao Core gravar a projeção de
  acesso na instância; a v1.2.1 explicita que ela fica no **banco de acesso** exclusivo da
  instância (`<instância>_acc`), companheiro do banco operacional. Neste documento, "banco da
  instância" abrange os dois.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Primeiro acesso e login seguro do administrador da plataforma (Priority: P1)

O responsável pela implantação executa um procedimento protegido que gera o convite do primeiro
administrador da plataforma; não existe cadastro público. A pessoa convidada aceita o convite,
define a senha, cadastra o segundo fator (TOTP), guarda os códigos de recuperação e passa a entrar
no painel com e-mail, senha e código TOTP. Ela pode sair, e a sessão expira por inatividade ou por
tempo máximo.

**Why this priority**: nenhuma outra capacidade do Core pode ser usada com segurança sem um
administrador autenticado e rastreável (`SC-002`, `COM-017`, `COM-020`).

**Independent Test**: em um ambiente vazio, executar o bootstrap, aceitar o convite, cadastrar o
TOTP, entrar, consultar a situação do sistema, sair e confirmar que a sessão encerrada não acessa
mais nada.

**Acceptance Scenarios**:

1. **Given** um ambiente sem administradores, **When** o responsável executa o bootstrap, **Then**
   é gerado um único convite de administrador da plataforma, válido por 48 horas e de uso único; o
   segredo do convite aparece apenas uma vez para quem executou o procedimento.
2. **Given** já existe administrador ativo, **When** alguém executa o bootstrap de novo, **Then** o
   procedimento recusa e orienta a usar o convite pelo painel.
3. **Given** um convite válido, **When** a pessoa o aceita, **Then** precisa definir senha conforme
   a política e cadastrar TOTP antes de concluir; recebe códigos de recuperação de uso único,
   exibidos uma vez.
4. **Given** um administrador com TOTP, **When** entra com e-mail e senha corretos, **Then** só
   obtém sessão depois de informar um código TOTP válido.
5. **Given** e-mail inexistente ou senha errada, **When** tenta entrar, **Then** recebe a mesma
   mensagem genérica nos dois casos e a tentativa é registrada sem a senha (`SC-033`).
6. **Given** tentativas repetidas com falha para a mesma conta ou origem, **When** o limite é
   atingido, **Then** novas tentativas são temporariamente bloqueadas, com mensagem que não revela
   se a conta existe.
7. **Given** uma sessão ativa, **When** fica 30 minutos sem atividade ou completa 8 horas desde o
   login, **Then** a próxima requisição é recusada e a interface pede novo login (`COM-016`).
8. **Given** uma sessão ativa, **When** o administrador sai, **Then** a sessão é invalidada no
   servidor e o mesmo cookie não autentica mais.

---

### User Story 2 - Equipe de administração da plataforma (Priority: P1)

Um administrador convida outros administradores da plataforma, consulta quem tem acesso, inativa e
reativa acessos. O sistema nunca deixa a plataforma sem administrador ativo, e ações sensíveis
exigem confirmar o segundo fator de novo.

**Why this priority**: contas compartilhadas não atendem à rastreabilidade (`SC-002`); a
plataforma precisa de mais de um administrador para operar e para recuperar acesso.

**Independent Test**: com dois administradores, convidar um terceiro, inativar e reativar um
deles, tentar inativar o último ativo e verificar as recusas e a auditoria.

**Acceptance Scenarios**:

1. **Given** um administrador autenticado, **When** convida um e-mail para administrador da
   plataforma, **Then** é criado convite de uso único, com expiração, e a ação exige reconfirmar o
   TOTP; o convite fica registrado com autor e instante.
2. **Given** a lista de administradores, **When** consultada, **Then** mostra nome, e-mail,
   estado (ativo, inativo, convite pendente) e último acesso, sem nenhum segredo.
3. **Given** um administrador ativo, **When** outro o inativa com motivo, **Then** todas as sessões
   dele são revogadas imediatamente e ele não consegue mais entrar; reativar exige novo login.
4. **Given** apenas um administrador ativo, **When** alguém tenta inativá-lo (inclusive ele mesmo),
   **Then** a ação é recusada (`COM-020`).
5. **Given** dois administradores ativos, **When** duas inativações concorrentes atingem os dois,
   **Then** no máximo uma é concluída e a plataforma continua com um administrador ativo (`T-05`).
6. **Given** qualquer alteração de acesso, **When** concluída, **Then** a auditoria registra quem
   fez, sobre quem, valor anterior e novo, motivo e instante (`SC-011`, `CA-SC-010`).

---

### User Story 3 - Autenticação e autorização de usuários de produto por instância (Priority: P1)

Um produto (em F01, o produto de referência) autentica seus usuários pelo SparkCore: o Core
confere senha e vínculo e grava a sessão no banco de acesso daquela instância, devolvendo um
identificador opaco (`INSTANCE_TOKEN`). A cada requisição protegida, o produto valida a sessão, o vínculo e as
revogações no próprio banco, sem chamar o Core (D-04). A sessão vale só para aquela aplicação e
aquela instância; o produto nunca recebe nem guarda senhas, e nenhum parâmetro enviado pelo
navegador dá acesso a outra instância.

**Why this priority**: é o contrato de que o Tuteli dependerá (`COM-015`, `SP-004`,
diretrizes §4.3) e a prova central de isolamento (`NFR-008`, `T-04`); precisa estar estável antes
de o Tuteli existir (constituição III).

**Independent Test**: com duas instâncias sintéticas A e B do produto de referência e usuários
vinculados apenas a A, apenas a B e a ambas, executar a bateria de autenticação e autorização,
inclusive as tentativas de atravessar instâncias.

**Acceptance Scenarios**:

1. **Given** um usuário vinculado à instância A, **When** o produto autentica suas credenciais para
   A, **Then** o Core grava no banco de A uma sessão daquela aplicação e devolve ao produto apenas o
   identificador opaco (`INSTANCE_TOKEN`), para o cookie, sem nenhum dado de senha; nada é gravado no
   banco de B.
2. **Given** a mesma pessoa sem vínculo com B, **When** o produto tenta autenticá-la para B,
   **Then** a autenticação é recusada com a mesma resposta de credenciais inválidas.
3. **Given** um `INSTANCE_TOKEN` válido de A, **When** é apresentado ao produto na instância B,
   ou acompanhado de identificador de usuário, papel ou instância no corpo, **Then** a validação em
   B não encontra a sessão (ela só existe no banco de A), o acesso é negado e nada revela se o
   recurso de B existe (`T-04`).
4. **Given** uma sessão válida em A, **When** o produto a valida no próprio banco, **Then** obtém só
   o contexto mínimo: identidade, nome de exibição, papel, estado do vínculo e revisão de
   autorização da instância (constituição III).
5. **Given** uma sessão de produto, **When** usada no painel do Core, **Then** é recusada; o
   inverso também (`COM-015`, `CA-SC-001`).
6. **Given** uma pessoa vinculada a A e a B, **When** troca de A para B, **Then** precisa de uma
   sessão própria do contexto B; a sessão de A não autoriza B.
7. **Given** o produto chama os contratos internos, **When** a credencial de aplicação está
   ausente, vencida ou é de outro produto, **Then** a chamada é recusada; a credencial de serviço
   nunca substitui a sessão do usuário.
8. **Given** o Core indisponível, **When** um usuário tenta entrar no produto, **Then** recebe erro
   temporário explícito; sessões já existentes continuam sendo validadas pelo banco da instância,
   que nunca usa papel ou estado guardado no navegador (`T-15`).
9. **Given** um vínculo revogado, uma conta bloqueada ou uma senha trocada, **When** o Core conclui
   a operação, **Then** a revogação já está gravada no banco de cada instância afetada e a
   requisição seguinte do produto com aquelas sessões é negada (D-04).
10. **Given** uma instância inacessível no momento da revogação, **When** a operação é executada,
    **Then** a revogação fica pendente em tarefa persistente com repetição, o painel mostra a
    pendência e a instância afetada, e o Core não informa a operação como concluída para aquela
    instância até gravá-la.

---

### User Story 4 - Vínculos e convites para instâncias (Priority: P2)

O administrador da plataforma consulta os vínculos de uma instância, convida o administrador do
estabelecimento, reenvia ou revoga convites e revoga vínculos. O administrador de uma instância,
pelo produto, faz o mesmo apenas dentro da sua instância (`SP-005`). Pessoa que já tem conta aceita
o convite autenticando-se, sem trocar a senha nem expor seus outros vínculos.

**Why this priority**: é o ciclo de vida de acesso que o provisionamento (F02) e o Tuteli vão
usar; depende das histórias 1 e 3.

**Independent Test**: na instância A, convidar um novo administrador e um colaborador já
existente em B, aceitar ambos, mudar papel, revogar o colaborador em A e confirmar que o acesso a
B continua.

**Acceptance Scenarios**:

1. **Given** uma instância, **When** o administrador da plataforma convida um e-mail como
   administrador da instância, **Then** é criado convite de uso único (48 h) que concede só aquele
   vínculo e papel (`COM-011`).
2. **Given** um convite para e-mail que já tem conta, **When** a pessoa o aceita, **Then** precisa
   autenticar-se nessa conta; a senha não é redefinida e a instância não vê os outros vínculos dela.
3. **Given** um convite pendente, **When** é reenviado, **Then** o convite anterior deixa de valer
   e só o novo é aceito.
4. **Given** o administrador da instância A, **When** usa o contrato de vínculos locais, **Then**
   lista, convida, muda papel e revoga apenas vínculos de A; tentar operar B é negado sem revelar B
   (`COM-012`).
5. **Given** a pessoa vinculada a A e B, **When** o vínculo com A é revogado, **Then** as sessões do
   contexto A são revogadas, B continua acessível e a conta global permanece (`CA-SC-004`, `T-05`).
6. **Given** um único administrador ativo na instância, **When** tenta se rebaixar, ser revogado ou
   duas revogações concorrentes atingem os dois últimos, **Then** a instância nunca fica sem
   administrador ativo (`COM-020`, `T-05`).
7. **Given** uma instância cujo convite inicial ainda não foi aceito, **When** se verifica a regra
   do último administrador, **Then** o convite inicial válido conta como caminho de acesso até
   expirar; renová-lo é ação da plataforma (`COM-020`, `SC-024`).
8. **Given** o administrador da plataforma, **When** consulta a instância, **Then** não ganha papel
   de administrador da instância nem acesso aos dados de negócio dela (`COM-010`).

---

### User Story 5 - Recuperação de acesso e bloqueio global (Priority: P2)

Quem esquece a senha recebe um link de recuperação de uso único e curta duração; trocar a senha
encerra todas as sessões da conta. O administrador da plataforma pode bloquear uma conta
globalmente, vendo antes quais instâncias serão afetadas, em caso de incidente de segurança.

**Why this priority**: contas têm ciclo de vida próprio (escopo, "Demandas potenciais"); sem
recuperação, o suporte acabaria trocando senhas à mão, o que é proibido (`SC-013`).

**Independent Test**: pedir recuperação, usar o link, confirmar que o link não serve de novo e que
sessões anteriores morreram; bloquear globalmente uma conta com vínculos em A e B e confirmar que
nada mais funciona para ela.

**Acceptance Scenarios**:

1. **Given** um e-mail qualquer, **When** alguém pede recuperação, **Then** a resposta é sempre a
   mesma, exista a conta ou não.
2. **Given** um link de recuperação válido, **When** usado em até 30 minutos, **Then** permite
   definir nova senha uma única vez; usado de novo ou depois do prazo, é recusado (`COM-019`).
3. **Given** a senha trocada, **When** concluída, **Then** todas as sessões da conta, em todos os
   contextos, são revogadas (`COM-018`).
4. **Given** um administrador da plataforma que perdeu o TOTP, **When** usa um código de
   recuperação, **Then** entra uma única vez com aquele código e deve recadastrar o TOTP; sem
   códigos, segue o procedimento administrativo documentado, com verificação de identidade.
5. **Given** uma conta com vínculos em A e B, **When** o administrador da plataforma prepara o
   bloqueio global, **Then** vê as instâncias afetadas, informa motivo, reconfirma o TOTP e, ao
   concluir, todas as sessões da conta são revogadas (`SC-012`).
6. **Given** um administrador de instância, **When** tenta bloquear a conta global ou redefinir a
   senha de outra pessoa, **Then** a ação não existe para ele (`COM-012`).

### Edge Cases

- E-mail com maiúsculas ou espaços: normalizado por política documentada (minúsculas e sem
  espaços nas pontas), sem remover pontos nem sufixos `+` (`COM-007`).
- Dois convites simultâneos para o mesmo e-mail e a mesma instância: no máximo um vínculo
  resultante.
- Aceitar convite com conta logada de outro e-mail: recusado, com orientação para entrar na conta
  certa.
- Sessão usada depois da troca de senha em outro dispositivo: recusada na próxima requisição.
- Relógio do celular dessincronizado: TOTP aceita a janela anterior e a seguinte (±30 s), não mais.
- Reuso do mesmo código TOTP dentro da janela: recusado.
- Falha do banco de identidade durante o login: erro temporário, sem criar sessão parcial.
- Repetição da mesma requisição de convite após timeout: não cria convite duplicado
  (idempotência, `COM-026`).
- Conta inativada com vínculos em instâncias: os vínculos ficam inutilizáveis, mas o histórico
  permanece com o nome da época (`COM-028`, diretrizes §5.1).
- Tentativas de login distribuídas em muitas contas a partir da mesma origem: limitadas também
  por origem.
- Banco da instância indisponível durante o login de produto: erro temporário; a sessão não é
  criada em lugar nenhum.
- Réplica de vínculo divergente da fonte: a reconciliação corrige a favor da fonte e registra as
  divergências (FR-033). A restauração de backup antigo da instância (diretrizes §9, `T-16`) chega
  na fatia de restauração e usará a reconciliação antes de liberar a instância.
- Produto tentando criar sessão ou reativar vínculo direto no próprio banco: sem privilégio para
  isso; a tentativa falha.

## Requirements *(mandatory)*

### Functional Requirements

**Contas e credenciais**

- **FR-001**: Cada pessoa MUST ter uma conta central identificada por UUID e e-mail normalizado
  único segundo política documentada; a normalização MUST NOT remover pontos nem sufixos
  (`COM-007`).
- **FR-002**: Senhas MUST ser armazenadas apenas com algoritmo próprio para senhas, com custo
  definido no plano de segurança, e MUST NOT ser recuperáveis, exibidas, registradas em log ou
  enviadas (`COM-013`).
- **FR-003**: A política de senha MUST exigir no mínimo 12 caracteres e recusar senhas presentes
  em lista de senhas vazadas ou comuns; não há exigência de trocas periódicas.
- **FR-004**: Login, recuperação e aceite de convite MUST ter limitação de tentativas por conta e
  por origem, com respostas que não revelem a existência da conta (`NFR-009`, `SC-033`). No login
  de produto, a origem é o IP do usuário final informado pelo produto, nunca o do servidor do
  produto.

**Administrador da plataforma**

- **FR-005**: MUST existir um procedimento protegido de bootstrap, executável apenas pelo
  responsável pela implantação, que gera o convite do primeiro administrador e recusa quando já há
  administrador ativo; MUST NOT existir cadastro público de administrador (`COM-020`).
- **FR-006**: O administrador da plataforma MUST ter TOTP cadastrado para concluir o primeiro
  acesso e MUST informar o TOTP a cada login (`COM-017`).
- **FR-007**: O cadastro de TOTP MUST gerar códigos de recuperação de uso único, exibidos uma única
  vez e armazenados apenas como resumo criptográfico.
- **FR-008**: No painel, convidar administrador ou membro de instância, inativar ou reativar
  acesso, bloquear ou desbloquear conta, gerar link de recuperação, mudar papéis e revogar vínculos
  MUST exigir reconfirmação do TOTP feita nos últimos 5 minutos (`SC-026`). O contrato de vínculos
  locais (administrador de instância) não exige reconfirmação, pois usuários de produto não têm MFA
  em F01.
- **FR-009**: O sistema MUST permitir convidar, listar, inativar e reativar administradores da
  plataforma e MUST recusar inativar o último administrador ativo, inclusive sob operações
  concorrentes (`SC-010`, `COM-020`, `T-05`).
- **FR-010**: O administrador da plataforma MUST NOT receber implicitamente papel em nenhuma
  instância nem acesso a dados de negócio (`COM-010`).

**Sessões**

- **FR-011**: Sessões MUST ser opacas e mantidas no servidor; o navegador recebe apenas um cookie
  `Secure`, `HttpOnly`, com escopo do host da aplicação; credenciais de sessão MUST NOT ser
  gravadas em armazenamento acessível por script (`COM-014`).
- **FR-012**: Cada sessão MUST pertencer a uma aplicação e, para produtos, a uma única instância;
  sessões do Core ficam em `spark_identity` e sessões de produto ficam apenas no banco de acesso da
  própria instância, criadas exclusivamente pelo Core; sessão de uma aplicação ou instância MUST NOT
  autenticar outra (`COM-015`, D-04).
- **FR-013**: Expiração MUST seguir: Core 30 min de inatividade e 8 h absolutas; produto 2 h de
  inatividade e 12 h absolutas; não existe sessão permanente (`COM-016`).
- **FR-014**: Troca de senha e bloqueio global MUST revogar todas as sessões da conta; revogação
  de vínculo MUST revogar só as sessões daquele contexto; inativação de administrador da
  plataforma MUST revogar as sessões do Core dele (`COM-018`).
- **FR-015**: Requisições que alteram estado com sessão por cookie MUST ter proteção contra CSRF
  (`NFR-009`).

**Convites e vínculos**

- **FR-016**: Convites e links de recuperação MUST ser de uso único, com segredo aleatório,
  armazenamento apenas do resumo criptográfico e expiração de 48 h (convite) e 30 min
  (recuperação); reenviar MUST invalidar o anterior (`COM-019`). Convite pendente MAY ser revogado
  pela plataforma ou pelo administrador da instância (só convites dela), respeitando FR-021.
- **FR-017**: Vínculos MUST registrar conta, instância, papel (`administrador` ou `colaborador`) e
  estado; uma conta pode ter vínculos em várias instâncias com papéis diferentes (`COM-008`).
- **FR-018**: Acesso a uma instância MUST exigir vínculo ativo explícito; mesmo e-mail, domínio,
  contratante ou papel em outra instância MUST NOT conceder acesso (`COM-009`).
- **FR-019**: Aceitar convite com conta existente MUST exigir autenticação dessa conta, MUST NOT
  redefinir a senha e MUST NOT revelar à instância os outros vínculos (`COM-011`).
- **FR-020**: Mudança de papel e revogação de vínculo MUST registrar autor, valor anterior, valor
  novo, motivo e instante (`SC-011`).
- **FR-021**: Nenhuma instância utilizável MUST ficar sem administrador ativo; um convite inicial
  válido e não aceito conta como caminho de acesso até expirar (`COM-020`, `SC-024`).
- **FR-022**: O bloqueio global MUST ser ação separada da revogação de vínculo, exclusiva da
  plataforma, e MUST mostrar as instâncias afetadas antes da confirmação (`SC-012`); o desbloqueio
  também é exclusivo da plataforma, com motivo, e não reabre sessões encerradas.
- **FR-023**: Recuperação MUST NOT exibir a senha atual, gerar senha comum ou permitir alterar a
  senha de outra pessoa pela tela (`SC-013`).

**Contratos para produtos (provados com o produto de referência)**

- **FR-024**: O Core MUST oferecer, por contrato versionado, as capacidades "autenticar e encerrar
  sessão de produto" e "vínculos locais" do catálogo de capacidades, acessíveis apenas com
  credencial de aplicação com escopo e rotação; a capacidade "autorizar sessão e resolver
  instância" passa a ser um **contrato de dados** — o formato das tabelas de sessão, vínculo e
  revisão de autorização gravadas no banco da instância — versionado como o artefato de migração
  (constituição III, diretrizes §6.1, D-04).
- **FR-025**: A validação no produto MUST decidir somente pela sessão gravada pelo Core no banco da
  instância, pelo vínculo replicado e pela revisão de autorização da instância; valores enviados
  pelo navegador (usuário, papel, instância, banco) MUST NOT ser autoridade (diretrizes §4.3,
  `RN-SP-001`).
- **FR-026**: O que o Core grava no banco de acesso da instância MUST se limitar ao necessário para validar
  acesso: identificador de sessão (só o resumo criptográfico), conta, nome de exibição, papel,
  estado do vínculo, expirações, revogação e revisão de autorização; MUST NOT incluir e-mail,
  senha, segredos de MFA nem vínculos de outras instâncias.
- **FR-027**: Revogação de vínculo, troca de senha, inativação e bloqueio global MUST gravar a
  revogação no banco de acesso de cada instância afetada antes de a operação ser informada como concluída
  para aquela instância; instância inacessível gera tarefa persistente com repetição e pendência
  visível no painel (constituição IV, `COM-018`).
- **FR-028**: O login de produto MUST depender do Core: com o Core indisponível, o produto recebe
  erro temporário explícito; sessões existentes continuam validadas pelo banco da instância até
  expirar ou ser revogadas (`T-15`).
- **FR-033**: O Core MUST manter a réplica de vínculos de cada instância igual à fonte em
  `spark_identity`; divergência detectada MUST ser corrigida a favor da fonte e registrada, por
  reconciliação executável sob demanda e como tarefa persistente.
- **FR-034**: O produto MUST poder apenas ler e encerrar (logout) sessões no seu banco, e o
  encerramento MUST NOT poder ser desfeito pelo produto; criar sessões, alterar vínculos ou
  desfazer revogações MUST ser exclusivo do Core.
- **FR-035**: O administrador da plataforma MUST NOT ter sessão, vínculo ou credencial que dê
  acesso a qualquer instância de produto (`COM-010`).
- **FR-029**: Respostas negadas MUST seguir a política de não revelação: recurso de outra instância
  responde igual a inexistente (convenções §5).

**Auditoria e eventos**

- **FR-030**: Login bem-sucedido, falha de login, logout, expiração, revogação, convite criado,
  aceito, reenviado e revogado, mudança de papel, bloqueio e alteração de MFA MUST gerar evento de
  segurança com ator, alvo, contexto, resultado, correlação e instante, sem segredos (`SC-032`,
  `SC-034`); a consulta desses eventos fica para F08-Core.
- **FR-031**: IP e agente do navegador MUST ser gravados apenas nos eventos de segurança e MUST
  ser apagados desses eventos após 180 dias, mantendo o evento (`SC-033`).

**Interface do Core**

- **FR-032**: O painel MUST oferecer telas de login, segundo fator, recuperação, aceite de
  convite, cadastro de TOTP e gestão de administradores da plataforma, construídas com o design
  system e com a matriz de estados aplicável (constituição VIII); a situação do sistema passa a
  exigir sessão de administrador.

### Key Entities *(include if feature involves data)*

- **Conta**: pessoa autenticável; UUID, e-mail normalizado, nome de exibição, estado (ativa,
  inativa, bloqueada), datas. Pertence a `spark_identity`.
- **Credencial de senha**: resumo da senha com parâmetros do algoritmo e data de alteração.
- **Fator TOTP**: segredo protegido, data de cadastro, último passo usado (anti-reuso).
- **Código de recuperação**: resumo de código de uso único ligado à conta.
- **Papel de plataforma**: vínculo da conta com o papel de administrador da plataforma e seu
  estado.
- **Vínculo de instância (membership)**: conta, instância, papel, estado, autor e datas.
- **Convite**: alvo (plataforma ou instância e papel), e-mail, resumo do segredo, expiração,
  estado (pendente, aceito, revogado, expirado), autor.
- **Sessão do Core**: conta, resumo do identificador, criação, última atividade, expiração
  absoluta, MFA confirmado em, estado e motivo de revogação. Fica em `spark_identity`.
- **Sessão de produto**: mesmos campos, mais instância e aplicação; gravada pelo Core somente no
  banco da instância e identificada pelo `INSTANCE_TOKEN` opaco (D-04).
- **Réplica de vínculo**: cópia mínima, no banco da instância, dos vínculos daquela instância
  (conta, nome de exibição, papel, estado, versão); a fonte continua em `spark_identity`.
- **Credencial de aplicação**: produto ou aplicação chamadora, escopos, resumo do segredo,
  validade e rotação.
- **Referência de instância**: UUID, produto, identificador de acesso e revisão de autorização,
  necessária para vínculos e sessões; o ciclo completo da instância chega em F02/F03.
- **Evento de segurança**: tipo, ator, alvo, contexto, resultado, correlação, IP, agente, instante.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-001**: Um administrador convidado conclui o primeiro acesso (senha, TOTP, códigos de
  recuperação) em até 5 minutos, e um login subsequente com TOTP leva menos de 30 segundos.
- **CS-002**: Na bateria de isolamento com duas instâncias, 100% das tentativas de acesso cruzado
  (rota, corpo, cabeçalho, sessão de outro contexto, credencial de outro produto) são negadas e
  nenhuma revela a existência do recurso alheio.
- **CS-003**: Depois de concluída uma revogação de vínculo, troca de senha, inativação ou bloqueio,
  0 requisições autorizadas com as sessões afetadas em cada instância já atualizada; com as
  instâncias acessíveis, a operação conclui em até 5 segundos para todas elas.
- **CS-004**: Em 100 execuções de revogações concorrentes dos dois últimos administradores
  (plataforma e instância), 0 ocorrências de plataforma ou instância sem administrador ativo.
- **CS-005**: 100% dos convites e links de recuperação recusados no segundo uso e após a
  expiração.
- **CS-006**: A validação de sessão no banco da instância acrescenta no máximo 10 ms ao p95 de uma
  requisição local do produto de referência, e o login de produto completa em até 1 segundo no
  p95, mantendo as metas de `NFR-004`.
- **CS-009**: Com o Core parado, 100% das requisições com sessões de produto válidas continuam
  atendidas pelo produto de referência, e 100% das tentativas de login recebem erro temporário.
- **CS-007**: Após 10 falhas de login em sequência para a mesma conta, 100% das tentativas
  seguintes são limitadas pelo período de bloqueio, sem revelar se a conta existe.
- **CS-008**: Nenhuma senha, segredo de convite, token, código TOTP ou código de recuperação
  aparece em respostas, logs, auditoria ou exportações verificadas.

## Assumptions

- **Emenda da constituição (aplicada em v1.2.0 e v1.2.1)**: o princípio I restringia o acesso técnico
  do Core aos bancos de instância a provisionamento, migração e verificação de saúde, e o princípio
  II dizia que indisponibilidade da identidade resulta em erro temporário. Com a D-04 decidida, o
  Core passa a gravar sessões e a réplica de vínculos no banco de acesso da instância, e sessões
  existentes sobrevivem à indisponibilidade do Core. A emenda MINOR (v1.2.0) explicitou isso, a
  PATCH (v1.2.1) nomeou o banco de acesso, e a ADR `D-04` passou a `confirmada` com esta alternativa, substituindo a referência dos escopos (diretrizes
  §3.2 e §4.3, que previam autorização síncrona sem cache).
- **Instâncias em F01**: como o cadastro e o provisionamento de instâncias chegam em F02, F01 usa
  instâncias sintéticas do produto de referência criadas pelas sementes e uma referência mínima de
  instância (UUID, produto, identificador de acesso, revisão de autorização) que F02 amplia; a
  máquina de estados e a suspensão não fazem parte de F01.
- **Interface do produto de referência**: os contratos para produtos são provados por testes e por
  um cliente de teste do produto de referência; não há tela de produto em F01.
- **Entrega de convites e recuperação (`D-07`)**: no MVP o link de uso único é exibido uma única
  vez a quem o gerou (bootstrap, administrador da plataforma ou administrador da instância), que o
  entrega por canal seguro; envio por e-mail transacional fica como evolução, sem mudar o contrato.
- **Tempos e limites**: prazos de sessão, convite e recuperação seguem as propostas de `COM-016` e
  `COM-019`; limite de 10 falhas consecutivas por conta com bloqueio temporário de 15 minutos e
  limite por origem definido no plano.
- **Recuperação de MFA**: códigos de recuperação e, sem eles, procedimento administrativo
  documentado executado por outro administrador da plataforma, com reconfirmação do TOTP de quem
  executa e registro em auditoria.
- **Retenção de IP e agente**: F01 grava os campos; a limpeza após 180 dias é tarefa do
  trabalhador entregue em F08-Core, a fatia de consulta de eventos, antes de qualquer piloto.
- **Lista de senhas vazadas**: verificada localmente com lista versionada no repositório, sem
  enviar senhas ou resumos a serviços externos.
- **Papéis de produto**: em F01 existem os papéis `administrador` e `colaborador` (`SP-001`,
  `SP-002`); as permissões operacionais de cada papel pertencem ao Tuteli e não são definidas
  aqui.
