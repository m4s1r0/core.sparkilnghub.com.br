# Feature Specification: F03 — Ciclo e operação da instância

**Feature Branch**: `004-f03-ciclo-operacao-instancia`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "F03 — Ciclo e operação da instância do SparkCore (requer F02, decisão D-01 confirmada). Escopo: ativação, suspensão com sessão aberta, reativação, manutenção, saúde e procedimento de recuperação, executor de migrações, encerramento. Base: estados e transições de instância já existentes em F02 (ENUM de 8 estados, histórico de transição); F03 adiciona os estados/ações operacionais que faltam (suspender, reativar, manutenção, encerrar) e as superfícies de saúde/backup/migração sobre essa máquina de estados."

**Rastreabilidade**: `SC-025` a `SC-031`; `SC-042` a `SC-045`; `SP-097`, `SP-099`, `SP-100`;
`NFR-006`, `NFR-007`; aceites `CA-SC-008`, `CA-SC-009`; regras `RN-SC-003` a `RN-SC-005`; cenários
`T-03` (suspensão e transação em curso) e `T-16` (restauração com acesso revogado); decisão `D-01`
(confirmada); constituição v1.2.1, princípios I, II, IV, V, VI, VII e VIII. Critérios de sucesso
usam o prefixo `CS-` para não colidir com `SC-*`, continuando a numeração de F02.

## Contexto e limites

F02 termina com a instância em `PRONTA`: banco próprio, credencial restrita e migrações
aplicadas, mas sem uso de negócio liberado. F03 assume a partir daí o ciclo administrativo
completo de uma instância já provisionada: a primeira ativação (o caminho para o primeiro
administrador), suspender e reativar preservando dados e revogando sessões no limite certo,
entrar e sair de manutenção para aplicar uma nova versão do produto com segurança, consultar
saúde e situação de backup, e encerrar como ação terminal — sem jamais excluir o recurso físico
nem expor terminal, SQL livre ou gerenciador de arquivos.

A máquina de estados (`ENUM` de 8 valores) e o histórico de transição já existem desde F02;
F03 não a recria, apenas habilita as transições que faltam
(`PRONTA→ATIVA`, `ATIVA⇄SUSPENSA`, `ATIVA⇄MANUTENCAO`, `SUSPENSA→ENCERRADA`) com suas
pré-condições, efeitos sobre sessões e autorização, e as telas que as disparam.

Atores:

- **Administrador da plataforma** — único papel do painel Core (`SC-001`), com MFA (F01);
  reautentica para toda ação de risco desta fatia (`SC-026`).
- **Trabalhador técnico** — identidade de sistema que executa o executor de migrações e as
  checagens de saúde; mesma base de código do Core (F00), sem perfil de usuário.
- **Produto** — valida sessão e autorização a cada acesso protegido, inclusive tarefa assíncrona,
  contra o estado vigente da instância (`SP-097`, `SP-099`).
- **Pessoa usuária do produto** — tem sessão aberta em uma instância que pode ser suspensa
  enquanto ela está em uso (`T-03`).
- **Visitante da página pública de indisponibilidade** — vê aviso mínimo quando a instância está
  suspensa ou em manutenção, sem motivo financeiro nem detalhe interno (`SC-027`).

**Fora de F03**: cadastro de contratante, catálogo e provisionamento até `PRONTA` (F02); consulta
consolidada de auditoria, utilização e acessos entre instâncias (F08-Core); rotação da credencial
operacional; console de restauração de backup com um clique (`SC-043`); rollout em massa, canário
automatizado e rollback automático de schema no executor de migrações (`SC-044`); reabertura de
instância `ENCERRADA` e eliminação definitiva (`SC-031`); transferência de instância entre
contratantes (`RN-SC-005`); exclusão de recurso físico ao suspender, reativar ou encerrar
(`RN-SC-004`); telas e artefato do Tuteli.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ativar a instância pronta (Priority: P1)

O administrador ativa uma instância `PRONTA`, liberando o primeiro uso de negócio. A ativação
confere contratante elegível, instância tecnicamente pronta, schema compatível e caminho válido
para o primeiro administrador (vínculo ativo ou convite inicial ainda pendente, conforme a
exceção de `SC-024`).

**Why this priority**: sem ativação, nenhuma instância provisionada em F02 chega a ser usada; é a
porta de entrada de todo o ciclo que F03 adiciona.

**Independent Test**: ativar uma instância `PRONTA` com convite inicial ainda pendente e outra já
com administrador vinculado; confirmar que ambas chegam a `ATIVA`, que a projeção de acesso passa
de `pronta` para `ativa` e que o login do produto passa a ser aceito.

**Acceptance Scenarios**:

1. **Given** uma instância `PRONTA` com convite inicial ainda não aceito, **When** o administrador
   confirma a ativação com MFA recente, **Then** a instância passa a `ATIVA`, a transição registra
   ator, instante e motivo, e o login do produto antes recusado passa a ser aceito depois do
   aceite do convite (`SC-024`, `SC-025`, `SC-026`).
2. **Given** uma instância `PRONTA` cujo contratante foi inativado, **When** a ativação é
   solicitada, **Then** é recusada informando a inelegibilidade, sem mudar o estado (`SC-029`).
3. **Given** uma instância `PRONTA` cujo schema aplicado não corresponde à versão suportada pelo
   produto, **When** a ativação é solicitada, **Then** é recusada com orientação, sem expor SQL
   (`SC-029`, `SC-045`).
4. **Given** uma instância já `ATIVA`, **When** a ativação é solicitada de novo, **Then** é
   recusada por estado incompatível, sem efeito duplicado.
5. **Given** uma instância `ATIVA` ainda sem administrador local (ativada pela exceção de convite
   pendente) cujo convite inicial expirou, **When** o administrador solicita a reemissão,
   **Then** um novo link de uso único é emitido e o anterior deixa de valer (`SC-024`, `FR-032`).

---

### User Story 2 - Suspender instância com sessão aberta (Priority: P1)

O administrador suspende uma instância `ATIVA`, registrando o motivo. A partir da confirmação,
toda nova autorização é negada nessa instância, inclusive leitura, exportação e sessões já
abertas; uma transação cuja autorização começou antes da confirmação pode terminar. Uma página
pública mínima informa indisponibilidade sem motivo financeiro.

**Why this priority**: é o controle administrativo central do ciclo (`T-03`) e a salvaguarda que
protege outras instâncias e o restante da plataforma de uma instância problemática.

**Independent Test**: com sessões abertas simultâneas nas instâncias A e B, suspender A e
confirmar que toda requisição nova em A é negada a partir da confirmação, que uma transação já
autorizada em A conclui, e que B continua operando sem qualquer efeito.

**Acceptance Scenarios**:

1. **Given** uma instância `ATIVA` com sessões abertas, **When** o administrador confirma a
   suspensão com MFA recente e um motivo, **Then** a instância passa a `SUSPENSA`, a transição
   registra estado anterior, novo estado, ator, instante e motivo, e toda requisição cuja
   autorização começa depois da confirmação é negada, inclusive leitura e exportação
   (`SC-025` a `SC-027`, `SC-026`, `CA-SC-008`).
2. **Given** uma transação autorizada antes da confirmação da suspensão, **When** ela prossegue
   para concluir, **Then** é permitida terminar, com correlação que demonstre a ordem entre
   autorização e confirmação (`SC-028`, `T-03`).
3. **Given** uma instância suspensa, **When** um visitante não autenticado acessa seu endereço,
   **Then** vê uma página pública mínima de indisponibilidade com orientação de contato, sem
   motivo financeiro nem detalhe interno (`SC-027`).
4. **Given** duas instâncias A e B com sessões abertas, **When** A é suspensa, **Then** sessões e
   autorizações de B continuam válidas sem qualquer alteração (`T-03`, princípio I).
5. **Given** uma instância cuja telemetria de saúde está atrasada ou cuja vigência está vencida,
   **When** nada mais acontece, **Then** o sistema não a suspende automaticamente; suspender
   permanece ação administrativa explícita (`RN-SC-003`).
6. **Given** uma instância já `SUSPENSA`, **When** a suspensão é solicitada de novo, **Then** é
   recusada por estado incompatível, sem efeito duplicado nem novo registro de transição.

---

### User Story 3 - Reativar instância suspensa (Priority: P1)

O administrador reativa uma instância `SUSPENSA`, com as mesmas condições de elegibilidade da
ativação inicial. A reativação nunca restaura sessões revogadas pela suspensão, nem altera senhas,
nem executa cobrança.

**Why this priority**: completa o ciclo suspender/reativar; sem ela, suspender seria
irreversível, o que contraria a definição de suspensão como reversível (`SC-025`).

**Independent Test**: suspender e reativar a mesma instância; confirmar que o login exige nova
sessão (a sessão revogada pela suspensão não volta a validar) e que nenhuma senha ou cobrança foi
alterada no processo.

**Acceptance Scenarios**:

1. **Given** uma instância `SUSPENSA` com contratante elegível, instância tecnicamente pronta e
   administrador local ativo (ou a exceção de convite válido de `SC-024`), **When** o
   administrador confirma a reativação com MFA recente, **Then** a instância volta a `ATIVA`
   com novo registro de transição (`SC-029`).
2. **Given** uma sessão de produto aberta antes da suspensão e revogada por ela, **When** a
   instância é reativada, **Then** essa sessão continua inválida; só uma nova autenticação cria
   sessão válida (`CA-SC-009`).
3. **Given** uma instância reativada, **When** inspecionada, **Then** nenhuma senha de usuário foi
   alterada e nenhuma cobrança foi executada como efeito da reativação (`SC-029`).
4. **Given** uma instância `SUSPENSA` cujo contratante foi inativado nesse intervalo, **When** a
   reativação é solicitada, **Then** é recusada informando a inelegibilidade, permanecendo
   `SUSPENSA` (`SC-029`).

---

### User Story 4 - Manutenção controlada (Priority: P2)

O administrador coloca uma instância `ATIVA` em manutenção para aplicar uma intervenção que exige
bloquear operações de negócio, e sai da manutenção só depois de uma checagem de saúde. Transações
em curso podem concluir antes da intervenção no banco.

**Why this priority**: é o estado que torna segura a aplicação de migrações e outras
intervenções sem arriscar dados em uso; depende da instância já poder estar `ATIVA` (US1).

**Independent Test**: entrar em manutenção numa instância `ATIVA` com uma transação em curso,
confirmar que novas operações de negócio são bloqueadas e a transação em curso pode concluir;
sair da manutenção e confirmar que a saída exige checagem de saúde aprovada.

**Acceptance Scenarios**:

1. **Given** uma instância `ATIVA`, **When** o administrador confirma a entrada em manutenção com
   um motivo, **Then** a instância passa a `MANUTENCAO`, novas operações de negócio são
   bloqueadas e a transição é registrada (`SC-030`).
2. **Given** uma transação de negócio em curso no instante da entrada em manutenção, **When** ela
   prossegue, **Then** pode concluir antes de qualquer intervenção direta no banco ser permitida
   (`SC-030`).
3. **Given** uma instância `MANUTENCAO`, **When** o administrador solicita a saída, **Then** uma
   checagem de saúde é executada e só com resultado saudável a instância volta a `ATIVA`; saúde
   não aprovada mantém `MANUTENCAO` com o motivo exibido (`SC-030`, `SC-045`).
4. **Given** uma instância `MANUTENCAO`, **When** uma pessoa usuária tenta uma ação de negócio,
   **Then** é bloqueada com orientação, sem expor terminal, SQL livre ou gerenciador de arquivos
   (`SC-030`, `SC-045`).

---

### User Story 5 - Consultar saúde, versão e backup (Priority: P2)

O administrador consulta, por instância, a versão de produto/schema aplicada, a conectividade, a
última verificação de saúde e o resultado do último backup conhecido — vindo da ferramenta que
realmente o executa, nunca apenas da existência de uma tarefa agendada.

**Why this priority**: dá visibilidade operacional contínua e é pré-requisito de informação para
decidir suspender, manter ou aplicar uma migração; não depende de nenhuma das ações anteriores
para ser testada.

**Independent Test**: consultar o painel de saúde de uma instância e confirmar que versão,
conectividade, última verificação e último resultado de backup aparecem com a origem de cada
dado, e que um backup apenas agendado e nunca executado aparece como tal, não como sucesso.

**Acceptance Scenarios**:

1. **Given** uma instância com recursos criados, **When** o administrador abre seu painel de
   saúde, **Then** vê versão do produto, versão de schema aplicada, conectividade, instante da
   última verificação e resultado do último backup conhecido (`SC-042`).
2. **Given** uma instância cujo backup está apenas agendado e nunca foi executado com sucesso,
   **When** o painel é consultado, **Then** mostra explicitamente que não há backup bem-sucedido
   registrado, sem marcar sucesso só pela tarefa existir (`SC-042`).
3. **Given** o procedimento operacional de backup e restauração, **When** consultado, **Then** é
   um documento versionado acessível à operação, cobrindo uma instância isolada e o conjunto
   Core/identidade (`SC-043`).
4. **Given** uma restauração realizada em ambiente isolado a partir de um backup anterior a uma
   revogação de colaborador, **When** concluída, **Then** identidade, dados e estado são
   conferidos, as permissões atuais são reaplicadas antes de liberar o acesso, o colaborador
   revogado continua sem operar e nenhuma outra instância é alterada (`T-16`, `SC-043`, `NFR-007`).

---

### User Story 6 - Executor controlado de migrações (Priority: P2)

O trabalhador técnico aplica uma nova versão do artefato de migração a uma instância em
manutenção, com verificação de versão, backup prévio e registro da execução, demonstrando ao
menos a atualização de uma instância anterior de homologação.

**Why this priority**: é o mecanismo que mantém uma instância compatível com novas versões do
produto; depende do estado de manutenção (US4) para ter uma janela segura.

**Independent Test**: aplicar uma versão nova do artefato de migração de referência a uma
instância em manutenção numa versão anterior, confirmando checagem de versão, backup prévio
exigido, janela de manutenção respeitada e execução registrada; tentar aplicar fora de
manutenção e confirmar a recusa.

**Acceptance Scenarios**:

1. **Given** uma instância em `MANUTENCAO` numa versão de schema anterior à mais recente do
   produto, **When** o trabalhador aplica a atualização, **Then** a versão alvo é conferida, um
   backup prévio é exigido, a execução é registrada com início, fim e resultado, e o schema
   aplicado passa a refletir a nova versão (`SC-044`).
2. **Given** uma instância que não está em `MANUTENCAO`, **When** a atualização é solicitada,
   **Then** é recusada, exigindo primeiro a entrada em manutenção (`SC-044`, `SC-030`).
3. **Given** uma instância de homologação numa versão anterior do artefato de referência,
   **When** o executor é demonstrado, **Then** ela chega à versão mais recente sem intervenção
   manual de SQL (`SC-044`).
4. **Given** uma execução de migração que falha, **When** inspecionada, **Then** o painel mostra
   etapa e mensagem sanitizada, sem terminal, SQL livre ou gerenciador de arquivos (`SC-045`).

---

### User Story 7 - Encerrar instância (Priority: P3)

O administrador encerra uma instância já `SUSPENSA`, como ação administrativa terminal do MVP,
registrando motivo, exportação/backup aplicável e a política de retenção — sem excluir o banco
físico.

**Why this priority**: é a etapa final do ciclo, menos frequente que as anteriores, e pressupõe a
suspensão já disponível (US2).

**Independent Test**: encerrar uma instância `SUSPENSA` e confirmar que ela chega a `ENCERRADA`
com motivo e política de retenção registrados, que o banco operacional continua existindo (sem
`DROP DATABASE`) e que não há ação na interface para reabri-la ou excluí-la definitivamente.

**Acceptance Scenarios**:

1. **Given** uma instância `SUSPENSA`, **When** o administrador confirma o encerramento com MFA
   recente, um motivo e a política de retenção aplicável, **Then** a instância passa a
   `ENCERRADA`, o registro de exportação/backup aplicável é anexado à transição, e nenhum
   `DROP DATABASE` ou exclusão de recurso físico ocorre (`SC-031`, `RN-SC-004`).
2. **Given** uma instância `ATIVA` ou `PRONTA`, **When** o encerramento é solicitado diretamente,
   **Then** é recusado, exigindo a suspensão prévia (`SC-031`).
3. **Given** uma instância `ENCERRADA`, **When** a interface administrativa é inspecionada,
   **Then** não existe ação para reabri-la nem para excluí-la definitivamente (`SC-031`).
4. **Given** uma instância `ENCERRADA`, **When** qualquer tentativa de acesso de negócio ocorre,
   **Then** é negada como nas demais instâncias não `ATIVA` (`SC-031`, princípio I).

---

### Edge Cases

- Duas solicitações concorrentes de suspensão (ou de qualquer outra transição) na mesma
  instância: a segunda encontra o estado já alterado e recebe conflito de estado, sem segundo
  registro de transição.
- Suspensão solicitada enquanto uma tarefa de provisionamento de F02 ainda está em execução para a
  mesma instância: a instância só chega a estados operacionais de F03 depois de `PRONTA`; não há
  caminho de suspender uma instância ainda `CADASTRADA` ou `PROVISIONANDO`.
- Ativação ou reativação solicitada para uma instância cujo convite inicial expirou e nunca foi
  aceito: a exceção de `SC-024` não se aplica mais sem convite válido; a ativação é recusada até
  haver um caminho válido para o primeiro administrador (novo convite ou vínculo ativo).
- Checagem de saúde ao sair da manutenção falha repetidamente: a instância permanece `MANUTENCAO`
  indefinidamente até a causa ser corrigida; não há saída automática por tempo.
- Backup em execução no instante em que a suspensão ou o encerramento é confirmado: a suspensão e
  o encerramento não interrompem o backup em curso; o resultado é registrado quando terminar.
- Tentativa de transferir uma instância para outro contratante: fora do MVP em qualquer estado
  (`RN-SC-005`).
- Tentativa de excluir definitivamente uma instância `ENCERRADA` pela interface: não existe essa
  ação (`SC-031`).
- Telemetria de saúde atrasada numa instância `ATIVA`: não aciona suspensão automática nem
  qualquer mudança de estado; o painel mostra "sem dados suficientes" em vez de concluir uma
  falha (`RN-SC-003`).
- Vigência (`valid_until`) vencida numa instância `ATIVA`: continua apenas uma pendência
  informativa (já sinalizada em F02); não aciona suspensão automática (`RN-SC-003`).

## Requirements *(mandatory)*

### Functional Requirements

**Ativação**

- **FR-001**: O sistema MUST permitir ativar uma instância `PRONTA` só quando o contratante está
  elegível, a instância está tecnicamente pronta, o schema aplicado é compatível com o produto e
  existe caminho válido para o primeiro administrador — vínculo ativo ou convite inicial ainda
  pendente, pela exceção de `SC-024` (`SC-029`).
- **FR-002**: Ativar MUST exigir reautenticação/MFA recente do administrador e MUST registrar
  estado anterior, novo estado, ator, instante e motivo (`SC-026`).
- **FR-003**: Ativação MUST ser recusada, sem mudar o estado, quando qualquer pré-condição falhar,
  informando qual delas (`SC-029`).

**Suspensão**

- **FR-004**: O sistema MUST permitir suspender uma instância `ATIVA`, exigindo motivo e
  reautenticação/MFA recente, e MUST registrar a transição como em `FR-002` (`SC-025`, `SC-026`).
- **FR-005**: A partir da confirmação da suspensão, toda nova autorização na instância MUST ser
  negada, inclusive leitura, exportação e validação de sessões já abertas (`SC-027`, `CA-SC-008`).
- **FR-006**: Uma requisição cuja autorização começou antes da confirmação da suspensão MUST
  poder concluir a transação já iniciada; o sistema MUST NOT prometer abortar comandos em
  execução no banco (`SC-028`, `T-03`).
- **FR-007**: Um visitante não autenticado de uma instância suspensa ou em manutenção MUST ver
  uma página pública mínima informando indisponibilidade e orientação de contato, MUST NOT expor
  motivo financeiro nem detalhe interno (`SC-027`; estendida a `MANUTENCAO` por ser a mesma
  indisponibilidade observável de fora, ver US4).
- **FR-008**: O sistema MUST NOT suspender uma instância automaticamente por atraso de
  telemetria de saúde ou por vigência vencida; suspender permanece ação administrativa explícita
  (`RN-SC-003`).
- **FR-009**: Suspender uma instância MUST NOT afetar o estado, as sessões ou a autorização de
  qualquer outra instância (princípio I).

**Reativação**

- **FR-010**: O sistema MUST permitir reativar uma instância `SUSPENSA` sob as mesmas
  pré-condições de elegibilidade da ativação (`FR-001`), exigindo reautenticação/MFA recente e
  registrando a transição (`SC-029`, `SC-026`).
- **FR-011**: Reativar MUST NOT restaurar qualquer sessão revogada pela suspensão; MUST NOT
  alterar senha de usuário; MUST NOT executar cobrança (`SC-029`, `CA-SC-009`).

**Manutenção**

- **FR-012**: O sistema MUST permitir colocar uma instância `ATIVA` em manutenção, com motivo e
  registro de transição, bloqueando novas operações de negócio a partir da confirmação (`SC-030`).
- **FR-013**: Uma transação de negócio em curso no instante da entrada em manutenção MUST poder
  concluir antes de qualquer intervenção direta no banco ser permitida (`SC-030`).
- **FR-014**: Sair da manutenção MUST exigir uma checagem de saúde executada ao final; só com
  resultado saudável a instância MUST voltar a `ATIVA` (`SC-030`).
- **FR-015**: Enquanto em manutenção, toda tentativa de ação de negócio MUST ser bloqueada com
  orientação visível, sem recorrer a terminal, SQL livre ou gerenciador de arquivos (`SC-030`,
  `SC-045`).

**Saúde, versão e backup**

- **FR-016**: O sistema MUST expor, por instância, a versão do produto, a versão de schema
  aplicada, a conectividade, o instante da última verificação de saúde e o resultado do último
  backup conhecido (`SC-042`).
- **FR-017**: O status de backup exibido MUST vir da ferramenta que realmente o executa; a mera
  existência de uma tarefa agendada MUST NOT ser suficiente para indicar sucesso (`SC-042`).
- **FR-018**: O sistema MUST disponibilizar um procedimento operacional versionado de backup e
  restauração cobrindo uma instância isolada e o conjunto Core/identidade (`SC-043`).
- **FR-019**: Uma restauração em ambiente isolado MUST conferir identidade, dados e estado antes
  de liberar o acesso, MUST reaplicar as permissões atuais vigentes e MUST NOT devolver acesso a
  um colaborador revogado depois do backup restaurado, MUST NOT alterar qualquer outra instância
  (`T-16`, `NFR-007`).

**Executor de migrações**

- **FR-020**: O sistema MUST permitir aplicar uma nova versão do artefato de migração a uma
  instância somente enquanto ela está em `MANUTENCAO`, conferindo a versão alvo, exigindo backup
  prévio e registrando início, fim e resultado da execução (`SC-044`).
- **FR-021**: O executor MUST demonstrar, ao menos uma vez, a atualização de uma instância
  anterior de homologação para a versão vigente do artefato de referência, sem intervenção manual
  de SQL (`SC-044`).
- **FR-022**: Uma execução de migração que falhar MUST deixar a instância em `MANUTENCAO` com
  etapa e mensagem sanitizada visíveis, sem terminal, SQL livre ou gerenciador de arquivos
  (`SC-045`).

**Encerramento**

- **FR-023**: O sistema MUST permitir encerrar apenas uma instância `SUSPENSA`, exigindo
  reautenticação/MFA recente, motivo, registro de exportação/backup aplicável e política de
  retenção (`SC-031`).
- **FR-024**: Encerrar MUST NOT executar `DROP DATABASE` nem excluir qualquer recurso físico da
  instância (`SC-031`, `RN-SC-004`).
- **FR-025**: Uma instância `ENCERRADA` MUST NOT ter, na interface administrativa, ação de
  reabertura nem de eliminação definitiva (`SC-031`).
- **FR-026**: Uma instância `ENCERRADA` MUST negar todo acesso de negócio, como as demais
  instâncias não `ATIVA` (princípio I).

**Autorização e erros transversais**

- **FR-027**: Toda ação protegida sobre uma instância, inclusive consulta, exportação e tarefa
  iniciada pelo usuário, MUST revalidar o contexto e o estado vigente da instância antes de agir;
  uma tarefa assíncrona iniciada antes de uma mudança de estado MUST revalidar ao retomar
  (`SP-097`).
- **FR-028**: Enquanto uma instância está suspensa ou encerrada, toda nova ação protegida MUST
  ser impedida com orientação; o estado de um formulário já aberto no navegador MUST NOT
  representar uma operação concluída (`SP-099`).
- **FR-029**: O sistema MUST disponibilizar healthcheck e versão de schema para operação da
  plataforma sem expor dado de negócio ou segredo (`SP-100`).
- **FR-030**: Toda falha operacional exibida nesta fatia (ativação, suspensão, manutenção,
  migração, encerramento) MUST ser acionável e sanitizada, sem disponibilizar terminal, SQL livre
  ou gerenciador de arquivos na interface administrativa (`SC-045`).
- **FR-031**: O sistema MUST NOT permitir transferir uma instância entre contratantes em nenhum
  estado desta fatia (`RN-SC-005`).

**Convite inicial (ajuste herdado de F02)**

- **FR-032**: Enquanto a instância estiver `ATIVA` sem nenhum administrador local ativo (caso de
  ativação pela exceção de convite pendente de `SC-024`), o sistema MUST continuar permitindo
  emitir ou renovar o convite inicial, pela mesma regra de reemissão de F02 (link de uso único,
  anterior invalidado); deixa de permitir só quando houver administrador ativo (`SC-024`).

### Key Entities *(include if feature involves data)*

- **Instância** (de F02, ampliada em uso): ganha nesta fatia as transições
  `PRONTA→ATIVA`, `ATIVA⇄SUSPENSA`, `ATIVA⇄MANUTENCAO` e `SUSPENSA→ENCERRADA`, cada uma com motivo
  e ator obrigatórios.
- **Transição de estado** (de F02): passa a registrar também as transições operacionais desta
  fatia; continua só inclusão.
- **Verificação de saúde**: instância, instante, resultado (saudável ou não), origem da
  verificação; histórico consultável para a saída de manutenção e para o painel de saúde.
- **Registro de backup**: instância, instante, resultado, origem (a ferramenta que o executou);
  distinto de uma tarefa agendada que não necessariamente executa.
- **Execução de migração de instância**: instância, versão de origem, versão alvo, backup prévio
  referenciado, início, fim, resultado, etapa com falha quando houver; nunca sobrescreve execuções
  anteriores.
- **Registro de encerramento**: instância, motivo, referência de exportação/backup aplicável,
  política de retenção, ator, instante; anexado à transição `SUSPENSA→ENCERRADA`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-010**: Um administrador ativa uma instância `PRONTA` elegível e vê o login do produto
  passar a ser aceito, sem executar nenhum comando ou SQL fora do painel.
- **CS-011**: Em 100 suspensões seguidas de instâncias com sessão aberta, 100% das requisições
  cuja autorização começa depois da confirmação são negadas, e 100% das transações já autorizadas
  antes concluem sem interrupção forçada.
- **CS-012**: Suspender uma instância nunca altera estado, sessão ou autorização de outra
  instância, em 100% das rodadas de teste cruzado A/B.
- **CS-013**: Depois de reativar, 0% das sessões revogadas pela suspensão voltam a validar; uma
  nova autenticação sempre é exigida.
- **CS-014**: 100% das tentativas de ação de negócio durante manutenção são bloqueadas; a saída de
  manutenção só ocorre com checagem de saúde aprovada registrada.
- **CS-015**: O painel de saúde de qualquer instância com recursos criados mostra versão,
  conectividade, última verificação e resultado real do último backup, nunca um backup "agendado"
  apresentado como sucesso.
- **CS-016**: O executor de migrações atualiza com sucesso ao menos uma instância anterior de
  homologação para a versão vigente do artefato de referência, sem SQL manual.
- **CS-017**: 100% das tentativas de encerrar uma instância que não está `SUSPENSA` são recusadas;
  0% dos encerramentos executam `DROP DATABASE` ou removem recurso físico.
- **CS-018**: Nenhuma tela, resposta, log ou histórico desta fatia expõe SQL, stack trace,
  terminal ou acesso a arquivos, verificados em todas as ações de falha simuladas.
- **CS-019**: Depois de instalada a fatia, 100% dos cenários de F02 (contratante, catálogo,
  provisionamento até `PRONTA`) continuam passando sem regressão.

## Assumptions

- A verificação de saúde usada na saída de manutenção e no painel (`SC-030`, `SC-042`) é a mesma
  sondagem técnica de disponibilidade do produto já usada em F00/F02 (conectividade e schema),
  sem introduzir uma nova fonte de verdade nesta fatia.
- O registro de backup (`SC-042`, `SC-043`) é alimentado pela ferramenta operacional que executa
  a cópia (fora do SparkCore); esta fatia consome e expõe esse resultado, sem implementar o motor
  de backup em si.
- A política de retenção informada no encerramento (`SC-031`) é texto registrado na transição,
  sem automação de expurgo nesta fatia — a aplicação futura da retenção fica para evolução.
- "Schema compatível" na ativação e reativação (`SC-029`) reusa a verificação de versão já
  existente em F02 (`schema_version` da instância contra a versão suportada pelo produto).
- O produto de referência (`sparkref`) continua provando os cenários desta fatia, como em F02.
