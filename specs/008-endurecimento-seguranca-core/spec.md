# Feature Specification: Endurecimento de segurança — parte SparkCore

**Feature Branch**: `008-hardening-seguranca-core`

**Created**: 2026-11-15

**Status**: Draft

**Input**: User description: "Endurecimento de segurança da plataforma (Tuteli + SparkCore) — itens
`[Core]` e parte Core dos `[Core+Tuteli]`: SEC-01, SEC-02, SEC-04 (touch v1.4 devolvendo
`{role, membershipStatus}`), SEC-12, SEC-13, SEC-14, SEC-15, SEC-16, SEC-21, SEC-22."

**Rastreabilidade**: auditoria de 2026-11-15
(`tuteli/.../docs/seguranca/prompt-sdd-hardening-seguranca.md`); linha de base canônica
[`docs/ecossistema/05-baseline-seguranca.md`](../../docs/ecossistema/05-baseline-seguranca.md)
(`SEC-BASE-01, 02, 04, 09, 12–16, 21, 22`); ação `CONF-01` de
[`06-conformidade-produtos.md`](../../docs/ecossistema/06-conformidade-produtos.md); contrato
[`access-projection.md`](../../contracts/access-projection.md) (D-04); constituição v1.2.1,
princípios I, II, III, IV, V e VI. Critérios de sucesso usam o prefixo `CS-SEC-`.

## Contexto e limites

O SparkCore é a fonte de identidade, sessões, vínculos e credenciais de banco de todos os produtos
(hoje o Tuteli; em seguida o Cortivo). Os produtos falam com o Core pelo contrato interno
`/internal/v1`, autenticados por uma **credencial de aplicação**. A auditoria de 15/11/2026 mostrou
que essa credencial vale para todas as instâncias do produto: quem obtém a credencial de uma
implantação lê a senha de banco, cria sessões e administra membros de qualquer outra. Mostrou
também que o papel não chega ao produto depois do login, que a origem dos pedidos é falsificável
ou perdida atrás do proxy, que o bloqueio por e-mail vira negação de serviço, que a auditoria do
produto é alterável pela própria credencial operacional, que o MySQL aceita conexões sem TLS de
qualquer host e que tokens aparecem nos logs.

Esta feature corrige a parte do Core. A parte de cada produto (cookie, CSRF, logout, timeout,
cabeçalhos, PII…) fica nas features de endurecimento de cada produto (`CONF-02` no Tuteli,
`C01` no Cortivo), que dependem desta.

Atores:

- **Produto** (implantação do Tuteli, produto de referência) — chama `/internal/v1` com a
  credencial de aplicação da sua instância.
- **Operador da plataforma** — emite, vincula e revoga credenciais pela CLI; configura proxies,
  TLS e rede.
- **Administrador da plataforma** — entra no painel do Core; recebe os avisos de bloqueio.
- **Titular da conta** — usuário cujo login é alvo de tentativas.
- **Atacante** — detém a credencial de uma implantação, ou só alcança o login.

**Fora do escopo**: mudanças no código dos produtos; trocar o modelo de identidade; pentest
externo e WAF; canal de e-mail transacional (o Core ainda não tem um — ver Premissas);
SEC-03, 05–11 e 17–20, que são só do produto.

**Restrições**: o contrato `/internal/v1` sobe para **v1.4** e continua compatível com o Tuteli
em produção durante a janela de implantação (Core primeiro, produto depois); nenhuma recusa revela
se conta, instância ou vínculo existe; segredos nunca em log, URL ou resposta além de
`/connection`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Credencial de uma instância não alcança outra (Priority: P1) 🎯 MVP

Cada implantação de produto recebe uma credencial vinculada à **sua** instância. Com ela o produto
obtém a conexão, cria e confere sessões e administra membros só daquela instância. Um pedido com
o slug de outra instância — do mesmo produto ou de outro — recebe exatamente a mesma resposta de
uma instância inexistente, e o Core registra um evento de segurança. O operador emite credencial
por instância pela CLI e migra as credenciais por produto existentes sem parar o produto.

**Why this priority**: é a falha crítica (SEC-01): vazamento da senha de banco de todas as
instâncias do produto. Nenhum produto entra em homologação enquanto ela existir.

**Independent Test**: com duas instâncias A e B do mesmo produto e uma credencial de A, pedir
`/connection`, `/sessions`, `/sessions/touch` e `/members` de B e comparar com o mesmo pedido para
um slug inexistente.

**Acceptance Scenarios**:

1. **Given** credencial vinculada a A, **When** o produto pede `/connection` de B, **Then** recebe a
   mesma resposta (status, código e corpo) de um slug inexistente, nenhuma senha é entregue e um
   evento de segurança de recusa é gravado com a credencial e a instância pedida.
2. **Given** credencial vinculada a A e uma conta com vínculo ativo em B, **When** o produto faz
   login em B com senha correta, **Then** a resposta é a mesma de credenciais inválidas e nenhuma
   sessão é criada em B.
3. **Given** um token de sessão válido de B, **When** o produto pede `/sessions/touch` ou
   `/members` de B com a credencial de A, **Then** recebe a mesma recusa de sessão inválida.
4. **Given** credencial antiga sem instância (por produto) com escopo `connection`, `sessions` ou
   `members`, **When** é usada, **Then** é recusada como credencial inválida e o operador vê, na
   listagem da CLI, que ela precisa ser vinculada ou substituída.
5. **Given** uma credencial por produto em uso pela implantação de A, **When** o operador a vincula
   a A pela CLI, **Then** a implantação continua funcionando sem troca de segredo nem parada.
6. **Given** o operador, **When** cria credencial com `--instance <slug|uuid>` de instância de outro
   produto ou inexistente, **Then** a CLI recusa sem criar nada.

---

### User Story 2 - Papel e situação do vínculo chegam ao produto a cada confirmação (Priority: P1)

Ao confirmar atividade da sessão (`touch`), o produto recebe do Core o papel atual e a situação do
vínculo lidos da projeção. Assim, um administrador rebaixado perde os poderes na requisição
seguinte, em vez de mantê-los até a sessão expirar.

**Why this priority**: SEC-04 (alta) — o produto hoje guarda o papel do login no cookie.

**Independent Test**: login como administrador, rebaixar o papel no Core, chamar `touch` e
verificar que o papel devolvido é `colaborador`.

**Acceptance Scenarios**:

1. **Given** sessão válida, **When** o produto chama `touch`, **Then** recebe sucesso com
   `{ role, membershipStatus }` da projeção da instância.
2. **Given** um administrador rebaixado a colaborador no Core, **When** o produto chama `touch` com a
   sessão aberta antes, **Then** o papel devolvido é `colaborador`.
3. **Given** um produto da versão anterior do contrato, que só confere se a resposta é de sucesso,
   **When** recebe a nova resposta com corpo, **Then** continua funcionando.

---

### User Story 3 - Login resistente a origem falsificada e a força bruta distribuída (Priority: P2)

O Core só aceita como IP do usuário um endereço IPv4/IPv6 válido, conhece os proxies em que confia
para descobrir o IP real do painel, aplica atraso progressivo por par (e-mail, origem) antes de
qualquer bloqueio, só bloqueia totalmente uma conta com volume alto, e limita o total de falhas de
login que uma credencial de aplicação pode gerar. Quando uma conta é bloqueada por volume, o titular
e os administradores da plataforma são avisados.

**Why this priority**: SEC-02 (parte Core), SEC-13 e SEC-14 — hoje o atacante troca de IP à
vontade, todos os usuários do painel atrás do proxy compartilham um IP e 10 falhas de qualquer
lugar bloqueiam o dono da conta.

**Independent Test**: 10 falhas para um e-mail a partir de uma origem; login correto do mesmo
e-mail a partir de outra origem deve passar.

**Acceptance Scenarios**:

1. **Given** um pedido de login de produto com `clientIp` que não é IPv4/IPv6, **Then** é recusado
   como dado inválido, sem verificar senha.
2. **Given** um proxy listado em configuração, **When** o painel recebe pedido vindo dele com
   `X-Forwarded-For`, **Then** o IP registrado no evento é o do cliente; vindo de endereço não
   listado, o cabeçalho é ignorado.
3. **Given** 10 falhas de login para um e-mail a partir da origem X, **When** o titular entra pela
   origem Y com a senha correta, **Then** entra.
4. **Given** falhas repetidas do mesmo (e-mail, origem), **Then** cada nova tentativa espera mais
   (atraso crescente) e o par é limitado sem afetar outras origens.
5. **Given** falhas em volume alto para um e-mail vindas de muitas origens, **Then** a conta é
   bloqueada totalmente por um período e titular e administradores da plataforma recebem aviso.
6. **Given** uma credencial de aplicação que gerou o teto de falhas de login na janela, **Then** os
   próximos logins por ela são limitados antes de qualquer verificação de senha.

---

### User Story 4 - Auditoria do produto não pode ser adulterada pela credencial operacional (Priority: P2)

O artefato do produto declara quais tabelas são só-inserção (ex.: `auditoria`). O Core concede à
credencial operacional da instância apenas leitura e inserção nelas; nas demais, leitura e
escrita como hoje. Tabelas internas do Core no banco da instância são só leitura para o produto.

**Why this priority**: SEC-12 — hoje quem compromete o produto apaga o rastro.

**Independent Test**: provisionar instância com artefato que declara `auditoria` só-inserção e
tentar `UPDATE`/`DELETE` nela com a credencial operacional.

**Acceptance Scenarios**:

1. **Given** instância provisionada, **When** a credencial operacional faz `UPDATE` ou `DELETE` em
   tabela só-inserção, **Then** recebe erro de privilégio; `INSERT` e `SELECT` funcionam.
2. **Given** uma nova versão do artefato que cria tabela nova, **When** a migração é aplicada,
   **Then** a credencial operacional recebe os privilégios corretos da tabela nova.
3. **Given** instâncias já existentes, **When** o operador executa a ressincronização de
   privilégios, **Then** passam a valer as mesmas regras.

---

### User Story 5 - Banco acessível só da rede da aplicação e com TLS (Priority: P2)

Fora do desenvolvimento, as credenciais MySQL das instâncias exigem TLS e são restritas ao host
configurado da rede da aplicação; os pools do Core usam TLS; o compose local só escuta em
`127.0.0.1`.

**Why this priority**: SEC-15 — credencial vazada hoje funciona de qualquer lugar em texto claro.

**Independent Test**: usuário de instância criado em configuração de homologação; conexão sem TLS
recusada, conexão com TLS aceita.

**Acceptance Scenarios**:

1. **Given** ambiente diferente de desenvolvimento, **When** a credencial operacional conecta sem
   TLS, **Then** é recusada.
2. **Given** ambiente diferente de desenvolvimento sem TLS configurado nos pools, **Then** o Core
   recusa iniciar com mensagem de configuração.
3. **Given** o compose de desenvolvimento, **Then** a porta do MySQL só escuta em `127.0.0.1`.

---

### User Story 6 - Higiene de logs, CSV e cabeçalhos (Priority: P3)

Tokens de convite e de recuperação nunca aparecem nos logs; exportações CSV neutralizam também
TAB e CR iniciais; toda resposta do Core (HTML, JSON, erro) traz os cabeçalhos de segurança.

**Why this priority**: SEC-16, SEC-21, SEC-22 — baixas, mas baratas e exigidas pela linha de base.

**Independent Test**: um pedido a `/convite/<token>` e o log capturado; célula `\t=1+1` exportada;
cabeçalhos em `/`, `/api/v1/...`, `/internal/v1/...` e em um 404.

**Acceptance Scenarios**:

1. **Given** um pedido a `/convite/<token>`, `/api/v1/invitations/<token>` ou
   `/api/v1/password-resets/<token>`, **Then** o log da requisição não contém o token.
2. **Given** célula começando com TAB ou CR seguido de fórmula, **Then** o CSV a neutraliza.
3. **Given** qualquer resposta, **Then** traz CSP, `frame-ancestors 'none'`, `nosniff`,
   `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva e, fora do desenvolvimento, HSTS;
   respostas de API trazem `Cache-Control: no-store`.

### Edge Cases

- Credencial vinculada a instância ENCERRADA ou excluída: comporta-se como instância inexistente.
- Credencial vinculada cujo produto difere do produto da instância (dado inconsistente): recusa.
- Credencial com escopo `utilizacao` apenas: continua podendo ser por produto (o envio de
  utilização já confronta a instância com a credencial emissora).
- `clientIp` IPv6 com zona (`fe80::1%eth0`) ou IPv4 mapeado em IPv6: zona recusada; mapeado aceito.
- `X-Forwarded-For` com vários saltos e proxy confiável no meio: usa-se o salto mais à direita não
  confiável.
- Sucesso de login zera o atraso daquele (e-mail, origem), mas não o contador de volume da conta
  vindo de outras origens.
- Artefato declara tabela só-inserção que ainda não existe na versão alvo: é ignorada até existir.
- Artefato declara tabela só-inserção inexistente em todas as versões: o validador recusa.
- Touch de sessão com vínculo revogado: recusa de sessão inválida (o corpo só existe no sucesso).

## Requirements *(mandatory)*

### Functional Requirements

**Credencial por instância (SEC-01)**

- **FR-001**: Credenciais de aplicação com escopo `connection`, `sessions` ou `members` MUST estar
  vinculadas a exatamente uma instância; sem vínculo, são recusadas como credencial inválida.
- **FR-002**: Para essas rotas, o Core MUST resolver a instância só se o slug pedido for o da
  instância vinculada à credencial e do mesmo produto; caso contrário a resposta MUST ser idêntica
  (status, código, corpo) à de slug inexistente na mesma rota.
- **FR-003**: Toda recusa por instância divergente MUST gravar evento de segurança com a credencial,
  a instância pedida (quando existir) e o resultado `negado`, sem segredo.
- **FR-004**: A CLI MUST aceitar `create <produto> <rótulo> --scopes … --instance <slug|uuid>` e
  MUST recusar criar credencial com aqueles escopos sem `--instance`, ou com instância inexistente
  ou de outro produto.
- **FR-005**: A CLI MUST permitir vincular uma credencial por produto existente a uma instância
  (`bind <id> --instance <slug|uuid>`), sem trocar o segredo, para migração sem parada; e MUST
  exibir, na listagem, a instância de cada credencial e marcar as por produto que serão recusadas.
- **FR-006**: O plano de rotação MUST estar documentado (vincular ou emitir nova, configurar a
  implantação, revogar a antiga).

**Origem e limites de login (SEC-02 parte Core, SEC-13, SEC-14)**

- **FR-007**: O login de produto MUST recusar `clientIp` que não seja IPv4 ou IPv6 válido, com o
  envelope de dado inválido.
- **FR-008**: O Core MUST limitar o total de falhas de login por credencial de aplicação numa
  janela (teto global), checado antes da verificação de senha.
- **FR-009**: O Core MUST determinar o IP do cliente do painel considerando `X-Forwarded-For` só
  quando a conexão vier de proxy listado em configuração (lista vazia = nenhum).
- **FR-010**: Falhas de login MUST provocar atraso progressivo por par (e-mail, origem), crescente a
  cada falha a partir de um limiar, sem afetar o mesmo e-mail em outra origem.
- **FR-011**: O bloqueio total da conta (qualquer origem) MUST exigir volume alto de falhas,
  muito acima do limiar por par.
- **FR-012**: Ao bloquear totalmente uma conta, o Core MUST avisar o titular e os administradores
  da plataforma.
- **FR-013**: As regras de FR-010 a FR-012 MUST valer tanto no login do painel quanto no login de
  produto, sem revelar se a conta existe.

**Papel no touch (SEC-04, contrato v1.4)**

- **FR-014**: `touch` com sessão válida MUST responder sucesso com `{ role, membershipStatus }` lidos
  da projeção da instância; recusas permanecem iguais.
- **FR-015**: A mudança MUST ser compatível com o produto que só confere sucesso/recusa (v1.3).

**Privilégios só-inserção (SEC-12)**

- **FR-016**: O artefato de produto MUST poder declarar tabelas só-inserção; o validador MUST
  conferir nomes e existência em alguma versão.
- **FR-017**: O Core MUST conceder à credencial operacional apenas leitura e inserção nas tabelas
  só-inserção, leitura nas tabelas internas do Core no banco da instância e leitura/escrita nas
  demais, no provisionamento e após cada migração.
- **FR-018**: O operador MUST poder ressincronizar os privilégios das instâncias existentes.

**Banco (SEC-15)**

- **FR-019**: Fora do desenvolvimento, as conexões do Core ao MySQL MUST usar TLS; configuração
  sem TLS MUST impedir a inicialização.
- **FR-020**: Fora do desenvolvimento, as credenciais operacionais MUST exigir TLS e ser restritas
  ao host configurado da rede da aplicação.
- **FR-021**: O compose de desenvolvimento MUST publicar o MySQL só em `127.0.0.1`.

**Logs, CSV e cabeçalhos (SEC-16, SEC-21, SEC-22, SEC-09)**

- **FR-022**: Os logs de requisição MUST mascarar segmentos de token nas rotas de convite e de
  recuperação de senha.
- **FR-023**: A neutralização CSV MUST tratar também TAB e CR iniciais.
- **FR-024**: Toda resposta MUST trazer CSP restrita, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva; HSTS fora do desenvolvimento;
  `Cache-Control: no-store` nas respostas de `/api/` e `/internal/`.
- **FR-025**: A verificação completa (gate) MUST incluir auditoria de dependências de produção sem
  achado moderado ou superior.

### Key Entities

- **Credencial de aplicação**: produto, instância vinculada (obrigatória para `connection`,
  `sessions`, `members`), escopos, rótulo, prazo, revogação, último uso. O segredo só existe em
  resumo.
- **Regra de limitação**: chave (e-mail, origem, par, credencial), contagem, janela, bloqueio até;
  passa a ter modo progressivo.
- **Manifesto do artefato**: ganha a lista opcional de tabelas só-inserção.
- **Evento de segurança**: novos tipos para recusa por instância divergente e bloqueio de conta.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-SEC-001**: 0 de 4 rotas internas (`/connection`, `/sessions`, `/sessions/touch`,
  `/members`) aceitam a credencial de outra instância; as 4 respostas são idênticas às de instância
  inexistente, e o teste faz parte da verificação completa.
- **CS-SEC-002**: rebaixamento de papel é visto pelo produto na primeira confirmação seguinte
  (0 confirmações com o papel antigo).
- **CS-SEC-003**: 10 falhas de uma origem deixam 100% dos logins corretos de outras origens
  passarem.
- **CS-SEC-004**: com proxy confiável configurado, 100% dos eventos registram o IP real do cliente.
- **CS-SEC-005**: 0 alterações ou exclusões bem-sucedidas em tabela só-inserção com a credencial
  operacional.
- **CS-SEC-006**: 0 conexões sem TLS aceitas para credenciais operacionais fora do desenvolvimento.
- **CS-SEC-007**: 0 tokens de convite/recuperação nos logs; 100% das respostas com os cabeçalhos.
- **CS-SEC-008**: auditoria de dependências de produção sem achado moderado+.
- **CS-SEC-009**: o Tuteli em produção (contrato v1.3) continua funcionando após a implantação do
  Core, desde que sua credencial tenha sido vinculada antes (0 paradas).
- **CS-SEC-010**: cada SEC tratado tem ao menos um teste que falha antes da correção e passa depois.

## Assumptions

- O Core não tem canal de e-mail transacional. O "aviso" de FR-012 é um evento de segurança
  dirigido ao titular (`target_account_id`) e listado na consulta de eventos dos administradores
  (F08), mais um registro de alerta no log; o envio por e-mail entra quando houver canal.
- Valores padrão: atraso progressivo a partir da 5ª falha do par, dobrando a partir de 1 s até
  15 min; bloqueio total da conta com 100 falhas consecutivas por 15 min; teto por credencial de
  300 falhas em 15 min, bloqueio de 15 min. Ajustáveis em código.
- A regra existente de 50 falhas por origem em 15 min (painel e produto) permanece.
- O Tuteli em produção usa uma credencial por produto; a migração recomendada é vinculá-la à
  instância atendida (FR-005) antes de implantar o Core.
- "Rede da aplicação" é um padrão de host MySQL configurável (ex.: `10.0.%`); em desenvolvimento
  permanece `%`.
- HSTS é aplicado em homologação e produção (ambos servidos por HTTPS).
- Tabelas internas `_spark_*` do banco da instância não são escritas pelo produto (verificado no
  Tuteli em 15/11/2026).
