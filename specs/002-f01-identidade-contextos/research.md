# Research — F01 Identidade e contextos

**Data**: 2026-10-26 · **Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Base técnica herdada de F00 (D-05): Node.js 24, TypeScript 5.9, Fastify 5 + TypeBox, `mysql2` +
Kysely, migrador próprio, MySQL 8.4, React 19 + Tailwind v4 sobre o design system 0.2.0.
Decisões de produto já tomadas: D-02 (identidade central), D-04 (projeção de acesso na instância),
D-07 (link exibido uma vez). Constituição v1.2.0.

## R-01 — Hash de senha

- **Decision**: Argon2id com `@node-rs/argon2` 2.2, parâmetros m = 19 MiB, t = 2, p = 1 (perfil
  mínimo recomendado pela OWASP), sal aleatório por senha, formato PHC armazenado. Parâmetros
  ficam no registro; quando forem aumentados, a senha é refeita no próximo login bem-sucedido.
- **Rationale**: `COM-013` e constituição II pedem algoritmo próprio para senhas. O pacote tem
  binários pré-compilados, sem script de instalação (compatível com a política `allowScripts` do
  npm 11) e sem compilador nativo no Windows.
- **Alternatives considered**: `argon2` (node-gyp e script de instalação); `bcrypt` (limite de 72
  bytes, menos resistente a GPU); `scrypt` do Node (aceitável, mas Argon2id é a referência dos
  escopos).

## R-02 — Política de senha e lista de senhas comuns

- **Decision**: mínimo 12 caracteres, máximo 128; sem regras de composição; recusa de senhas da
  lista "10k-most-common" do SecLists (licença MIT), versionada em
  `server/assets/common-passwords.txt` com origem registrada, comparada em minúsculas; recusa
  também senha igual ao e-mail ou ao nome de exibição.
- **Rationale**: FR-003; verificação local, sem enviar senha ou resumo a terceiros (Assumptions).
- **Alternatives considered**: consulta k-anonymity ao Have I Been Pwned (envia prefixo de hash a
  serviço externo e cria dependência); zxcvbn (dependência maior, pontuação menos explicável).

## R-03 — TOTP e códigos de recuperação

- **Decision**: TOTP RFC 6238 implementado com `node:crypto` (HMAC-SHA1, 6 dígitos, passo de 30 s,
  janela ±1 passo), segredo de 20 bytes; o último passo aceito fica gravado para impedir reuso.
  Segredo armazenado **cifrado** (AES-256-GCM) com chave `IDENTITY_SECRET_KEY` fora do banco, pois
  precisa ser lido para verificar. Dez códigos de recuperação de 10 caracteres em base32,
  armazenados como sha256 e marcados como usados. QR code gerado na interface com `qrcode` 1.5 a
  partir do URI `otpauth://` entregue uma única vez no cadastro, com o segredo também em texto para
  digitação manual.
- **Rationale**: FR-006 e FR-007. Implementação curta e testável pelos vetores do RFC 6238; evita
  dependência para algo de ~40 linhas. Cifrar com chave externa cumpre "segredos fora do banco".
- **Alternatives considered**: `otpauth` ou `speakeasy` (dependências para pouco código;
  `speakeasy` sem manutenção); WebAuthn (melhor, mas fora do escopo do MVP, que pede TOTP).

## R-04 — Sessões do Core e cookies

- **Decision**: identificador aleatório de 32 bytes em base64url; o banco guarda só sha256. Cookie
  `sparkcore_session` via `@fastify/cookie` 11: `HttpOnly`, `SameSite=Strict`, `Path=/`, sem
  `Domain` (host exato) e `Secure` sempre fora de `development`. Inatividade 30 min (atividade
  gravada no máximo a cada 60 s) e absoluta 8 h. A sessão registra `mfa_confirmed_at`, usado para
  a reconfirmação de 5 minutos (FR-008).
- **Rationale**: FR-011 a FR-014. Identificador com 256 bits de entropia dispensa hash lento; sha256
  impede uso de um vazamento do banco como sessão.
- **Alternatives considered**: prefixo `__Host-` (exige `Secure`, quebra o desenvolvimento em
  `http://127.0.0.1`; adotar quando houver HTTPS local); JWT (contraria `COM-014`).

## R-05 — CSRF

- **Decision**: `SameSite=Strict` mais verificação de origem em todo método inseguro (POST, PUT,
  PATCH, DELETE) com cookie de sessão: aceita `Sec-Fetch-Site: same-origin` ou `Origin` igual à
  origem configurada (`PUBLIC_ORIGIN`); caso contrário `403 AUTH_CSRF_REJECTED`. Endpoints
  internos (`/internal/v1`) não usam cookie e ficam fora dessa regra.
- **Rationale**: FR-015, `NFR-009`; interface e API na mesma origem (F00, R-07), sem formulários de
  terceiros.
- **Alternatives considered**: token sincronizador (mais estado e acoplamento com a interface, sem
  ganho dado o `SameSite=Strict` e a verificação de origem).

## R-06 — Limitação de tentativas

- **Decision**: tabela `auth_throttle` em `spark_identity`, com chave (`account:<uuid>`,
  `ip:<endereço>` e `ip-account:<endereço>:<uuid>`), contagem de falhas e `locked_until`. Por conta:
  10 falhas consecutivas → 15 min de bloqueio, zerado no sucesso. Por origem: 50 falhas em 15 min →
  15 min. Aplica-se a login, segundo fator, aceite de convite e recuperação: no aceite de
  convite, senha atual errada conta por conta (10 → 15 min) e token inválido por origem (50 em
  15 min); pedidos de recuperação são limitados a 5 por e-mail por hora e 20 por origem em
  15 min. Resposta durante o
  bloqueio: `429` com `Retry-After`, mesma mensagem para conta existente ou não. No login de
  produto (`/internal/v1`), a origem vista pelo Core é o servidor do produto; por isso a chave de
  origem é `app-ip:<credencial>:<clientIp>`, com `clientIp` obrigatório e informado pelo produto
  (responsável por ele pela credencial de aplicação), e o IP do servidor do produto nunca é usado
  como origem — senão falhas de um usuário bloqueariam todos os usuários do produto.
- **Rationale**: FR-004, CS-007; persistir no MySQL sobrevive a reinícios e a mais de um processo.
- **Alternatives considered**: contador em memória (perde estado ao reiniciar);
  `@fastify/rate-limit` (limita por rota e origem, não por conta).

## R-07 — Projeção de acesso: onde fica e quem escreve (D-04)

- **Decision**: cada instância passa a ter um **banco de acesso** companheiro, exclusivo dela:
  `<banco da instância>_acc` (ex.: `sparkref_<32hex>_acc`), criado pelo provisionador junto com o
  banco operacional. Nele ficam as tabelas da projeção, definidas por um artefato de migração do
  próprio Core (`server/migrations/access_projection/`), com histórico próprio. Privilégios:
  - `spark_access_writer` (credencial do Core, papel `access`): `SELECT, INSERT, UPDATE, DELETE` em
    `<acc>.*`, concedido pelo provisionador por instância.
  - usuário operacional da instância (`inst_*`): `SELECT` em `<acc>.*` e `INSERT` só em
    `access_session_logout`, para logout. Sem `UPDATE` nem `DELETE`, o produto não consegue
    desfazer logout nem revogação (o MySQL restringe colunas, não valores, então
    `UPDATE (ended_at)` permitiria gravar `ended_at = NULL`).
- **Rationale**: no MySQL, privilégios são só aditivos; com a projeção dentro do banco operacional,
  o usuário da instância (que tem DML no banco inteiro) poderia criar sessões e desfazer
  revogações, violando FR-034 e a constituição (princípio I: "criar sessões… é exclusivo do
  Core"). Um banco companheiro permite negar isso por privilégio, e continua exclusivo da instância
  (nome derivado do mesmo UUID, mesmo prefixo, mesma política de backup).
- **Alternatives considered**: tabelas no banco operacional com grants por tabela para o produto
  (cada nova tabela do produto exigiria re-grant; frágil); `partial_revokes` (só subtrai de grants
  globais, não de grants por banco); triggers de proteção (exigem privilégio especial com binlog e
  não impedem `DELETE` pelo dono).

## R-08 — Registro mínimo de instância (antes da F02)

- **Decision**: tabela `instance_ref` em `spark_core` (UUID, código do produto, slug,
  banco operacional, banco de acesso, revisão de autorização, sintética, criação). As sementes criam
  duas instâncias sintéticas do `sparkref` (A e B) com bancos operacional e de acesso. F02 amplia a
  tabela com contratante, estado e máquina de estados, por migração nova.
- **Rationale**: vínculos e sessões precisam de instância real (Assumptions da spec); não antecipa
  o provisionamento de F02.
- **Alternatives considered**: vínculos sem referência de instância (sem validação, quebra
  isolamento); antecipar F02 (fere a ordem das fatias).

## R-09 — Credenciais de aplicação (contratos internos)

- **Decision**: tabela `app_credential` em `spark_core` (id, código do produto, rótulo, sha256 do
  segredo, escopos `sessions`/`members`, criação, expiração opcional, revogação). Cabeçalho
  `Authorization: Bearer <id>.<segredo>`, segredo de 32 bytes. Criação e revogação por comando
  `npm run app-credential -- create|revoke` (exibe o segredo uma vez). Várias credenciais ativas por
  produto permitem rotação sem parada. A credencial define o produto: instância de outro produto é
  tratada como inexistente.
- **Rationale**: FR-024, constituição III ("credencial de aplicação com escopo e rotação").
- **Alternatives considered**: mTLS (exige PKI no MVP); HMAC por requisição (mais complexo sem ganho
  contra o modelo de ameaça do MVP, com TLS em produção).

## R-10 — Revogação com instância inacessível

- **Decision**: toda operação que revoga (vínculo, senha, inativação, bloqueio) grava primeiro na
  fonte (`spark_identity`) e, na mesma requisição, aplica a revogação em cada banco de acesso
  afetado; falha em uma instância cria registro em `access_sync_job` (`spark_core`) processado pelo
  trabalhador com repetição exponencial (até 1 h entre tentativas) e aparece no painel como
  pendência. A resposta informa por instância: `aplicada` ou `pendente`.
- **Rationale**: FR-027, constituição II/IV. O trabalhador de F00 passa a ter sua primeira tarefa
  real, persistida no MySQL, sem broker.
- **Alternatives considered**: transação distribuída (MySQL XA entre bancos — complexidade e
  bloqueios sem necessidade); só repetir no trabalhador (resposta demoraria a refletir revogações
  que poderiam ser imediatas).
- **Reconciliação (FR-033)**: `reconcileInstance` recalcula a réplica inteira de uma instância a
  partir de `spark_identity`/`instance_ref`, corrige a favor da fonte, encerra sessões de vínculos
  revogados na fonte e registra o número de divergências. Roda como `access_sync_job` do tipo
  `reconciliar` e pelo comando `npm run access:reconcile -- <slug>`. A restauração de backup
  (`T-16`) chega na fatia de restauração e usará esta rotina antes de liberar a instância.

## R-11 — Recuperação de senha sem e-mail (D-07)

- **Decision**: o pedido de recuperação pela tela pública grava um evento e responde sempre a mesma
  mensagem ("se a conta existir, procure o administrador"); o link de recuperação (30 min, uso
  único) é **gerado por um administrador da plataforma** a partir da conta e exibido uma vez para
  ser entregue por canal seguro. Administrador de instância não gera link para conta global
  (`COM-012`). Pedidos pendentes aparecem no painel (`/contas`), que localiza a conta por busca
  exata de e-mail (sem listagem aberta de contas); gerar o link marca como atendidos os pedidos
  pendentes daquele e-mail.
- **Rationale**: D-07 confirmada; mantém FR-016/FR-023 sem integração de e-mail.
- **Alternatives considered**: e-mail transacional (D-07 adiou); administrador definir senha
  diretamente (proibido por `SC-013`).

## R-12 — Bootstrap

- **Decision**: comando `npm run bootstrap:admin -- <email>` (`server/src/cli/bootstrap-admin.ts`),
  com a credencial do migrador e guarda: recusa se já existe administrador ativo ou convite de
  plataforma pendente válido. Gera convite de 48 h e imprime o link uma vez. Registra evento de
  segurança com ator "sistema: bootstrap".
- **Rationale**: FR-005, `COM-020`; sem cadastro público.
- **Alternatives considered**: variável de ambiente com senha inicial (proibido: senha padrão).

## R-13 — Interface do Core

- **Decision**: rotas React `/entrar`, `/entrar/segundo-fator`, `/convite/:token`,
  `/recuperar/:token`, `/conta/seguranca` (TOTP e códigos), `/administradores`, `/contas` (busca e
  pedidos de recuperação), `/contas/:id`, `/instancias/:id/vinculos`, `/pendencias` e `/`
  (situação do sistema, agora protegida). Guarda de rota consulta
  `GET /api/v1/session`; 401 redireciona para `/entrar`. Formulários com `Input`, `PasswordInput`,
  `Button`, `Alert`, `DataTable`, `Dialog` (confirmações com motivo) do design system; matriz de
  estados por tela. O design system 0.2.0 não tem campo de código de verificação; usa-se `Input`
  com `inputMode="numeric"` e `autocomplete="one-time-code"` (lacuna registrada).
- **Rationale**: FR-032, constituição VIII.
- **Alternatives considered**: componente de OTP local (duplicaria controle do design system).

## R-14 — Tempos e desempenho

- **Decision**: login do Core p95 ≤ 400 ms (Argon2 ~50–100 ms + MySQL); login de produto p95 ≤ 1 s
  (CS-006); validação de sessão pelo produto: uma consulta indexada por sha256 no banco de acesso,
  p95 ≤ 10 ms local.
- **Rationale**: CS-001, CS-006, `NFR-004`.
- **Alternatives considered**: —

## Itens abertos

Nenhum `NEEDS CLARIFICATION`. Pendências de operação já registradas nos escopos (canal de entrega
seguro dos links, procedimento de recuperação de MFA em produção) continuam como bloqueadores de
piloto, não de F01.
