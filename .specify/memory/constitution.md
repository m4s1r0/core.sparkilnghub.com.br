# SparkCore Constitution

Constituição do SparkCore, o sistema interno da Sparkling Hub que administra contratantes, usuários,
catálogo de SaaS e o ciclo de vida das instâncias. O SparkPet depende do SparkCore para identidade,
autorização, provisionamento, suspensão e recepção de telemetria; por isso estes princípios também
valem para tudo o que o SparkCore expõe ao SparkPet. Fonte de produto: os escopos versão 1.0 de
2026-10-25 (`00-diretrizes-compartilhadas.md`, `01-sparkcore-mvp.md`, `02-sparkpet-mvp.md` e
`03-plano-sdd.md`), referenciados pelos identificadores estáveis `COM-*`, `SC-*`, `SP-*`, `RN-*`,
`CA-*`, `NFR-*`, `D-*` e `T-*`. Fonte de interface: o design system em
`UX/design-system` (pacote `@sparkling-hub/design-system`) e o contrato visual `DESIGN.md` da raiz.

## Core Principles

### I. Isolamento por instância (NÃO NEGOCIÁVEL)

- Cada instância de produto MUST ter banco operacional MySQL exclusivo, com nome derivado do UUID
  interno validado e credencial operacional restrita a esse banco (`COM-005`, `SC-016`, `SC-019`).
- O contexto de instância MUST ser resolvido no servidor a partir de rota/host cadastrado e da
  autorização; `user_id`, papel, instância, nome de banco ou conexão enviados pelo cliente MUST NOT
  ser aceitos como autoridade.
- Cada pool de conexão MUST pertencer a uma única instância e credencial; trocar de banco por `USE`
  numa conexão compartilhada entre requisições é proibido. Pools têm limite por instância e teto
  global.
- O SparkCore MUST NOT ler tutores, animais, comandas, recebimentos ou outro conteúdo operacional
  dos bancos de instância; seu acesso técnico a eles serve apenas a provisionamento, migração,
  verificação de saúde e à **projeção de acesso** (D-04): gravar sessões de produto, a réplica dos
  vínculos daquela instância e revogações, em tabelas próprias definidas por contrato de dados.
  Essas tabelas ficam num **banco de acesso** exclusivo da instância, companheiro do banco
  operacional e derivado do mesmo UUID, para que privilégios impeçam o produto de escrevê-las;
  "banco da instância", nesta constituição, abrange os dois.
- A projeção de acesso MUST conter apenas o necessário para validar acesso (resumo do
  identificador de sessão, conta, nome de exibição, papel, estado, expirações, revogação e revisão
  de autorização) e MUST NOT incluir e-mail, senha, segredos de MFA nem vínculos de outras
  instâncias. O produto MUST poder apenas ler essa projeção e encerrar sessões; criar sessões,
  alterar vínculos ou desfazer revogações é exclusivo do Core.
- O administrador da plataforma MUST NOT ter sessão, vínculo ou credencial de acesso a instâncias
  de produto (`COM-010`).
- Respostas negadas MUST NOT revelar a existência de objetos de outra instância.
- Toda fatia que grava ou lê dados de instância MUST ter testes negativos com pelo menos duas
  instâncias sintéticas (rota, corpo, cabeçalho, exportação, tarefa e pool reutilizado — `T-04`,
  `NFR-008`).

Justificativa: o isolamento é a promessa central da plataforma; uma falha aqui expõe dados de um
cliente a outro e não é recuperável por correção posterior.

### II. Identidade e autorização decididas no servidor

- Sessões MUST ser opacas, mantidas no servidor e entregues por cookie `Secure`, `HttpOnly` e de
  escopo adequado; credenciais de sessão MUST NOT ir para `localStorage` (`COM-014`).
- Senhas MUST usar algoritmo próprio para senhas (Argon2id ou equivalente definido no plano de
  segurança) e MUST NOT usar criptografia reversível, senha padrão ou senha comunicada ao cliente.
- Sessões são separadas por aplicação e por contexto de instância; o cookie de um produto MUST NOT
  autenticar outro (`COM-015`).
- Suspensão, revogação de vínculo, bloqueio global e troca de senha MUST alcançar sessões já
  abertas, cada uma no seu escopo (`COM-018`, `SC-027`, `SC-028`); reativação MUST exigir novo
  login.
- O administrador da plataforma MUST usar MFA TOTP antes de provisionar ou suspender instâncias
  (`COM-017`) e MUST NOT receber papel de administrador de estabelecimento implicitamente
  (`COM-010`).
- O último administrador ativo da plataforma ou de uma instância utilizável MUST NOT ser removido,
  rebaixado ou inativado, inclusive sob revogações concorrentes (`COM-020`, `T-05`).
- Convites e links de recuperação MUST ser de uso único, com segredo aleatório, persistência apenas
  do resumo criptográfico e expiração (`COM-019`).
- Contas e credenciais existem somente em `spark_identity` (D-02); login, convites, recuperação e
  MFA dependem do Core, e sua indisponibilidade MUST resultar em erro temporário explícito
  (`T-15`).
- Sessões de produto existentes são validadas pelo produto na projeção de acesso do banco da
  instância (D-04) e continuam válidas com o Core indisponível até expirar ou ser revogadas;
  nenhuma autorização pode se apoiar em papel, estado ou identidade guardados no navegador.
- Revogação de vínculo, troca de senha, inativação, bloqueio e suspensão MUST estar gravados na
  projeção de cada instância afetada antes de a operação ser informada como concluída para ela;
  instância inacessível gera tarefa persistente com repetição e pendência visível (princípio IV).

Justificativa: o SparkCore é a fonte de verdade de quem pode agir em cada contexto; decisões de
acesso tomadas no cliente não permitem revogar acesso. A projeção na instância é escrita só pelo
Core e recebe a revogação antes de qualquer operação ser dada como concluída, o que mantém a
revogação imediata sem tornar o Core dependência de cada requisição do produto.

### III. SparkCore como plataforma: contratos versionados e mínimos

- Toda capacidade consumida pelo SparkPet (autenticar, autorizar e resolver instância, vínculos
  locais, convite inicial, lote de utilização, situação operacional) MUST ser exposta por contrato
  versionado e documentado antes da implementação do consumidor.
- A projeção de acesso no banco da instância é um **contrato de dados** do Core: tabelas, colunas
  e semântica versionadas como o artefato de migração, provadas com o produto de referência e
  alteradas apenas com nova versão e convivência com a anterior.
- Cada contrato MUST ser demonstrável sem o SparkPet: o SparkCore mantém um produto de referência
  sintético (artefato de migração mínimo, provisionador, cliente de autorização e produtor de
  eventos de utilização) que exercita os contratos em testes. O produto de referência MUST NOT ser
  oferecido como SaaS nem conter regras de negócio do SparkPet.
- Mudança incompatível de contrato MUST gerar nova versão, convivência com a anterior durante a
  migração do consumidor e registro de impacto no SparkPet; alteração silenciosa de schema de
  resposta é proibida.
- Erros MUST trazer código estável, mensagem segura, campo quando cabível, indicação de repetição
  possível e identificador de correlação; MUST NOT expor SQL, segredo ou stack trace.
- Respostas de autorização MUST conter apenas o contexto mínimo necessário (identidade, papel,
  estado, revisão de autorização e referência opaca de conexão).
- Telemetria MUST trafegar apenas contagens e contexto mínimo definidos no contrato, sem valores
  financeiros, nomes de tutores, animais, itens ou observações (`SC-037`, `SP-098`); o Core
  deduplica por `event_id` e instância e confronta a instância de cada evento com a credencial.
- Comunicação interna MUST usar TLS em produção e credencial de aplicação com escopo e rotação;
  a credencial de serviço não substitui a autorização do usuário.

Justificativa: o SparkPet só pode avançar se o SparkCore oferecer contratos estáveis e já provados;
contratos mínimos reduzem o vazamento de dados e o acoplamento entre os produtos.

### IV. Operações críticas idempotentes, retomáveis e seguras sob concorrência

- Requisições críticas MUST aceitar chave de idempotência vinculada a ator, instância e operação,
  com resumo do payload e resposta persistida por pelo menos 24 horas; mesma chave e mesmos dados
  repetem o resultado, dados diferentes retornam conflito (`COM-026`).
- Provisionamento, migração e restauração MUST ser tarefas persistentes em MySQL, com etapas
  registradas, lease/heartbeat, tentativas limitadas, erro sanitizado e retomada sem efeitos
  duplicados; uma única tarefa estrutural por instância por vez (`SC-020` a `SC-022`, `RN-SC-002`).
- O provisionamento MUST NOT ser tratado como uma transação SQL única: comandos administrativos do
  MySQL fazem commit implícito, e cada etapa precisa de verificação e compensação limitada.
- Um recurso encontrado (banco, usuário MySQL) MUST NOT ser reutilizado sem prova de propriedade
  (UUID da instância e tarefa proprietária); a aplicação e o artefato de produção MUST NOT executar
  `DROP DATABASE` nem remover automaticamente recurso com dados (`SC-031`, `RN-SC-004`). O código
  da aplicação (`server/src`) MUST NOT conter `DROP DATABASE`, e a verificação automática MUST
  falhar se encontrar.
- Ferramentas de desenvolvimento e teste, mantidas fora do artefato de produção (`scripts/`,
  `server/tests/`), podem remover apenas bancos que elas próprias criaram para desenvolvimento ou
  teste, identificados por prefixo ou marcador sintético, e MUST recusar a execução fora do
  ambiente permitido pela guarda de ambiente.
- Transições de estado da instância MUST seguir a máquina de estados do escopo e executar suas
  pré-condições; ativação ou suspensão por edição direta de campo é proibida (`RN-SC-001`).
- Contagens, vínculos, capacidade e saldos disputáveis MUST usar transação e trava apropriadas;
  consulta prévia sem proteção contra corrida não é aceita (`COM-025`); edição concorrente usa
  versão otimista (`COM-027`).

Justificativa: cliques repetidos, timeouts e reinícios de trabalhador são situações normais, não
exceções; sem essas garantias surgem bancos duplicados, vínculos órfãos e estados ambíguos.

### V. Verificação com MySQL real e cenários de falha

- Cada fatia MUST passar por verificação de tipos, análise estática, testes das regras críticas,
  testes de integração contra MySQL da versão adotada em produção e jornadas de ponta a ponta
  aplicáveis (`NFR-011`, `NFR-012`).
- Persistência, concorrência, idempotência e isolamento MUST ser testados em MySQL real; mocks do
  banco não servem como evidência dessas propriedades.
- Os cenários críticos `T-01` a `T-16` aplicáveis à fatia MUST virar testes executáveis com
  sucesso, negativa, conflito, repetição, indisponibilidade e recuperação.
- Para regras de alto risco (isolamento, autorização, estados, idempotência, provisionamento), o
  teste MUST ser escrito e observado falhando antes da implementação que o satisfaz.
- Migrações MUST ser reproduzíveis em banco vazio e a partir da versão anterior suportada.
- Cobertura percentual isolada MUST NOT ser usada como critério de aceite; a evidência é por
  requisito e cenário.

Justificativa: as falhas que importam neste produto (corrida, commit implícito, pool trocando de
banco, sessão revogada) só aparecem com o banco real e com testes de falha.

### VI. Rastreabilidade, auditoria e privacidade

- Especificações, planos, tarefas, testes e commits MUST referenciar os identificadores estáveis
  dos escopos; requisito alterado ou excluído MUST registrar origem e motivo.
- Ações administrativas e de segurança MUST gerar auditoria com ator, objeto, ação, alteração
  segura, correlação e instante, inclusive valor anterior e novo em mudanças de papel
  (`SC-034`, `CA-SC-010`); a aplicação MUST NOT oferecer edição ou exclusão desses registros.
- Segredos, senhas, tokens completos e credenciais MySQL MUST NOT aparecer em tela, log, CSV,
  auditoria ou histórico de tarefa.
- Logs MUST ser estruturados, com correlação, produto e contexto de instância verificado
  (`NFR-010`).
- Coletar apenas os campos necessários a cada finalidade; IP e agente do navegador ficam restritos
  ao registro de segurança, com acesso e retenção controlados (`SC-033`).
- Exportações CSV MUST respeitar filtros e autorização, informar significado e geração e
  neutralizar conteúdo interpretável como fórmula (`SC-041`).
- Ambientes de desenvolvimento e homologação MUST usar dados sintéticos (`NFR-016`).

Justificativa: o SparkCore responde a perguntas de suporte por evidência; sem rastreabilidade e
sem minimização, ele vira risco de privacidade em vez de ferramenta de operação.

### VII. Monólito modular e escopo disciplinado

- O SparkCore MUST ser um monólito modular (identidade, contratantes, produtos, instâncias,
  provisionamento, auditoria, acesso e utilização), com o trabalhador de tarefas no mesmo código e
  artefato de implantação; microserviços, broker externo, Kubernetes, service mesh e event sourcing
  MUST NOT ser introduzidos no MVP (`COM-004`).
- Nenhuma atividade de especificação, planejamento ou implementação do SparkPet (fatias `F04` a
  `F07`, `F09` e a parte SparkPet de `F08` e `F10`) MUST ser iniciada antes da finalização do
  SparkCore, definida em "SparkCore primeiro". Requisitos `SP-*` entram nas fatias do Core apenas
  como contrato que o Core oferece, nunca como implementação do SparkPet.
- Itens marcados como Pós-MVP ou fora do MVP MUST NOT ser implementados sem decisão registrada que
  os promova ao escopo.
- Propostas `[P]` e decisões de referência `D-*` MUST ser tratadas como propostas até confirmação
  registrada; trabalho dependente de decisão estrutural não confirmada MUST esperar ou declarar a
  suposição e o ponto de confirmação. Pendência de decisão não autoriza construir duas alternativas
  completas.
- Complexidade adicional (nova dependência relevante, camada de abstração, padrão distribuído) MUST
  ser justificada no plano da fatia, com a alternativa mais simples rejeitada e o motivo.
- A interface administrativa MUST NOT oferecer SQL livre, terminal, envio de scripts ou edição de
  status técnico para simular sucesso (`SC-009`, `SC-023`, `SC-045`).

Justificativa: um MVP interno operado por uma equipe pequena precisa de poucas peças móveis; o
escopo foi recortado de propósito e cresce por decisão, não por conveniência. Concluir a plataforma
antes do primeiro produto evita que o SparkPet seja construído sobre contratos ainda móveis.

### VIII. Interface pelo design system da Sparkling Hub

- Toda interface do SparkCore MUST ser React + TypeScript com Tailwind CSS (`COM-001`) e MUST
  consumir o pacote `@sparkling-hub/design-system` (origem `UX/design-system`) apenas pela API
  pública, com versão fixada e testada. Cópias editadas de componentes, estilos de controles ou
  tokens do design system MUST NOT existir neste repositório.
- Controles (campos, seleção, botões, menus, alertas, badges, estados vazios, editor) MUST usar as
  primitivas do design system; seleção de valor e menu de ações MUST NOT ser trocados entre si.
- Composições de página MUST partir dos blocos Tailwind do design system (adaptações Tailblocks
  como `SettingsBlock`, `StatsBlock` e `StepsBlock`) e de layout com classes Tailwind estáticas.
  Classes interpoladas dinamicamente e cores redefinidas por produto são proibidas; cores vêm dos
  tokens semânticos `--color-sh-*`.
- Um bloco ou componente compartilhado ausente MUST ser proposto e entregue no design system, com
  API, estados, teclado, testes, changelog e, para blocos Tailblocks, proveniência (caminho, SHA e
  licença MIT). Componente local só é aceito quando expressa regra de domínio do Core compondo
  primitivas, ou como exceção registrada no plano com prazo de migração para o design system.
- A raiz da interface MUST ficar sob `.sh-theme`, com `styles.css` importado uma única vez na
  entrada; componentes browser-only (editor, sanitizador) MUST ser renderizados apenas no cliente.
- Cada tela MUST especificar a matriz de estados do design system aplicável: inicial, vazio,
  carregando, inválido, enviando, sucesso, erro de rede/API, conflito, sem permissão e
  desabilitado/leitura. Sucesso MUST ser exibido apenas após confirmação da API, e o botão em
  andamento não substitui a idempotência no servidor.
- Código de interface MUST NOT decidir autorização, isolamento, validação autoritativa ou
  persistência; estado React, campos ocultos e query string nunca são fonte de permissão.
- Alvo de projeto WCAG AA, sem alegar certificação: labels visíveis, foco visível, nome acessível,
  teclado nas tarefas críticas e uso de 360 px a desktop sem rolagem horizontal (`NFR-002`).

Justificativa: um único design system mantém identidade, acessibilidade e comportamento iguais
entre os SaaS; quando o Core contorna a biblioteca, cada desvio vira custo de manutenção e
inconsistência para todos os produtos seguintes.

## Restrições técnicas e de dados

- Interface: React 19 + TypeScript + Tailwind CSS v4, alinhados às peer dependencies e ao
  toolchain do `@sparkling-hub/design-system` (`COM-001`). Componentes e blocos vêm do design
  system (Princípio VIII); bundler, roteamento e estratégia de busca de dados são escolhidos e
  registrados no plano técnico de F00. Testes de interface SHOULD usar o mesmo toolchain do design
  system (testes de interação e E2E em navegador) para reaproveitar padrões e evidências.
- Servidor: Node.js (`COM-002`). TypeScript no servidor, API HTTP JSON, framework, biblioteca de
  acesso a dados e ferramenta de migração são a referência proposta `D-05` e MUST ser escolhidos e
  registrados no plano técnico da fatia F00.
- Persistência: MySQL (`COM-003`). Bancos lógicos: `spark_core` (contratantes, produtos,
  instâncias, tarefas, auditoria e métricas), `spark_identity` (contas, credenciais, vínculos,
  convites, sessões e auditoria de segurança) e `sparkpet_<uuid>` por instância. Sem chaves
  estrangeiras entre bancos; UUIDs externos são verificados na aplicação.
- Privilégios separados: execução web do Core, trabalhador de provisionamento e credenciais
  operacionais de instância têm permissões distintas; credencial operacional MUST NOT criar bancos
  nem alterar estrutura.
- Valores monetários em centavos inteiros e tipo exato no MySQL; nunca ponto flutuante
  (`COM-021`).
- Instantes gravados em UTC; datas civis e períodos no fuso da instância, inicialmente
  `America/Sao_Paulo`; intervalos `[início, fim)` (`COM-023`, `D-09`).
- Cadastros usados são inativados, não apagados; operações confirmadas recebem compensação ou
  cancelamento, sem apagar histórico (`COM-028`).
- Idioma da interface pt-BR e moeda BRL. Código, identificadores e mensagens de commit podem seguir
  a convenção definida no plano de F00, desde que consistente no repositório.
- Segredos de conexão em armazenamento de segredos ou cifrados com chave externa ao banco; nunca
  em código, repositório ou variável exibida.

## Fluxo de desenvolvimento e portões de qualidade

- Repositório: o SparkCore é desenvolvido no repositório git `core/core.sparkilnghub.com.br`. O
  site institucional e o design system permanecem em seus diretórios; o SparkCore não é
  implementado dentro deles.
- Fluxo Spec Kit por fatia: `/speckit-specify` → `/speckit-clarify` (quando houver ambiguidade) →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` →
  `/speckit-converge`, até convergência.
- Antes de implementar identidade e provisionamento, as decisões `D-01` a `D-04` MUST estar
  confirmadas e registradas como decisões de arquitetura no repositório.
- Definition of Ready e Definition of Done do plano SDD (seções 6 e 7) são portões obrigatórios de
  cada fatia: uma fatia sem estados, contratos, erros, idempotência, concorrência, migrações e
  cenários de aceite especificados não entra em implementação; uma fatia sem evidência dos cenários
  aplicáveis não é concluída.
- Cada plano MUST conter a verificação desta constituição (Constitution Check), incluindo o
  mapeamento de cada campo e tela para componentes e blocos do design system, e registrar
  qualquer exceção na seção de complexidade, com justificativa.
- Trabalho em branch por funcionalidade no repositório git do SparkCore, com revisão antes da
  integração; nenhuma fatia pode regredir invariantes ou contratos das fatias anteriores.
- Segurança, auditoria, testes e tratamento de erros acompanham cada fatia desde o início; não são
  adiados para fatias finais.

### SparkCore primeiro: sequenciamento e finalização

- Ordem das fatias do SparkCore: `F00` (base e decisões) → `F01` (identidade e contextos) → `F02`
  (catálogo e provisionamento) → `F03` (ciclo e operação da instância) → `F08-Core` (acessos,
  auditoria, recepção de utilização, relatórios e exportações do Core).
- `F02` MUST provar provisionamento, migração, falha e retomada com o artefato de migração do
  produto de referência (Princípio III), não com o schema do SparkPet. O formato desse artefato é
  o contrato que o SparkPet adotará depois.
- `F08-Core` MUST ser verificada com o produtor de eventos do produto de referência, cobrindo
  repetição, atraso, lacuna e indisponibilidade (`T-14`, `CA-SC-011`, `CA-SC-012`), sem esperar
  `F06` do SparkPet.
- O SparkCore está finalizado quando: (a) as fatias acima cumprem a Definition of Done; (b) os
  critérios de conclusão do MVP SparkCore (seção 9 do escopo) estão demonstrados com o produto de
  referência; (c) os contratos consumidos pelo SparkPet estão publicados em versão estável; e
  (d) a finalização está registrada no repositório, com limitações conhecidas.
- A repetição desses critérios com o artefato real do SparkPet e a homologação conjunta (`F10`)
  pertencem à integração do SparkPet e não reabrem a finalização do SparkCore, salvo defeito de
  contrato, que MUST ser corrigido no Core por nova versão.

## Governance

- Esta constituição prevalece sobre outras práticas do repositório. Em conflito entre ela e um
  escopo de produto, prevalece a regra mais restritiva até que uma decisão registrada resolva a
  divergência.
- Emendas MUST ser propostas por mudança versionada neste arquivo, com Sync Impact Report,
  justificativa, impacto em especificações, planos e contratos já existentes e, se necessário,
  plano de migração. A aprovação cabe ao responsável técnico da Sparkling Hub.
- Versionamento semântico: MAJOR para remoção ou redefinição incompatível de princípio ou regra de
  governança; MINOR para princípio ou seção nova ou orientação materialmente ampliada; PATCH para
  esclarecimentos e correções sem efeito semântico.
- Conformidade é verificada no Constitution Check de cada plano, na análise entre artefatos antes
  da implementação e na revisão de cada mudança integrada. Violação conhecida só pode ser aceita
  como exceção registrada, com prazo e responsável.
- Atualizar a versão fixada do design system é uma mudança revisada: MUST registrar a versão
  anterior e a nova, ler o changelog e reexecutar os testes de interface afetados.
- O repositório SparkPet, iniciado somente após a finalização do SparkCore, deve adotar esta
  constituição, ou uma derivada compatível, para os temas compartilhados (isolamento, identidade,
  contratos, idempotência, verificação, privacidade e interface pelo design system); emenda nesses
  temas MUST ser comunicada ao SparkPet.
- Mudança de escopo (requisito novo, promovido do Pós-MVP ou alterado) MUST atualizar os
  documentos de escopo e as especificações afetadas antes do código.

**Version**: 1.2.1 | **Ratified**: 2026-10-25 | **Last Amended**: 2026-10-26
