# Research — Endurecimento de segurança (Core)

## R-01 Credencial por instância (SEC-01)

- **Decisão**: `requireAppCredential` recusa (`401 AUTH_APP_CREDENTIAL_INVALID`) credencial sem
  `instance_id` quando o escopo pedido é `connection`, `sessions` ou `members`, e grava
  `credencial_aplicacao/negado` com `motivo: "sem_instancia"`. `instanceForCredential` só devolve a
  instância se `slug` + produto resolvem para o `instance_id` da credencial; senão devolve `null` —
  cada rota já transforma `null` na resposta de inexistente — e grava `instancia_divergente/negado`
  quando o slug existe.
- **Migração sem parada**: CLI `bind <id> --instance <slug|uuid>` grava `instance_id` numa
  credencial ainda sem instância do mesmo produto, preservando o segredo. Sequência: (1) com a CLI
  da nova versão, `bind` (o Core antigo ignora `instance_id`); (2) implantar o Core; (3) para
  implantações que compartilhavam a credencial, emitir uma nova por instância, configurar, revogar
  a antiga.
- **Alternativas**: flag de transição aceitando credencial por produto (rejeitada: deixa o modo
  inseguro ligável em produção); recusar com 404 em vez de 401 a credencial sem instância
  (rejeitada: confunde o operador; a credencial é o problema, não a instância).
- `utilizacao` continua aceitando credencial por produto: a rota já confronta a instância do lote
  com `credential.instanceId`.

## R-02 `clientIp` (SEC-02, parte Core)

- **Decisão**: esquema `anyOf [format ipv4, format ipv6]` (ajv-formats; não aceita zona `%`) →
  `422` padrão. Teto por credencial: regra `appCredential(id)` — 300 falhas/15 min, bloqueio 15 min,
  checada junto das demais antes do Argon2.

## R-03 `trustProxy` (SEC-13)

- **Decisão**: `TRUSTED_PROXIES` (lista separada por vírgula de IP/CIDR, vazia por padrão) →
  `trustProxy: string[]` do Fastify (proxy-addr: salto mais à direita não confiável). Entradas
  inválidas são erro de configuração. Vazio → `trustProxy: false` (IP do socket).

## R-04 Atraso progressivo e bloqueio por volume (SEC-14)

- **Decisão**: nova regra `loginPair(email, origem)` com modo progressivo: a partir da 5ª falha
  consecutiva, bloqueio = `min(15 min, 1 s × 2^(falhas−5))`; sucesso zera o par. `loginEmail`
  (qualquer origem) passa de 10 para **100** falhas consecutivas → 15 min. A origem é o IP no
  painel e `credencial:IP` no produto. `registerFailure` passa a informar quais regras acabaram de
  bloquear; quando é `loginEmail`, grava `login_bloqueado/negado` com `target_account_id` (aviso ao
  titular, consultável pelos administradores em F08) e `logger.warn({alert:"login_bloqueado"})`.
- **Alternativas**: e-mail de aviso (sem canal no Core); CAPTCHA (fora do escopo).

## R-05 Touch v1.4 (SEC-04)

- **Decisão**: `200 { role, membershipStatus }` da `ValidatedSession` (a regra normativa só aceita
  vínculo `ativo`, logo `membershipStatus` é sempre `"ativo"` no sucesso — campo presente para
  evolução sem quebra). O Tuteli v1.3 usa `response.ok` (verificado), logo é compatível.
- **Alternativa**: encerrar sessões ao mudar o papel (aceita pela auditoria, mas força novo login
  também em promoção; fica como opção futura).

## R-06 Privilégios por tabela (SEC-12)

- **Decisão**: manifesto ganha `appendOnlyTables?: string[]` (opcional, formatVersion 1). Nova
  `syncOperationalGrants(admin, database, user, appendOnly)`:
  1. lê as tabelas de `information_schema.TABLES`;
  2. concede no banco `SELECT`; por tabela: comum → `INSERT, UPDATE, DELETE`; só-inserção →
     `INSERT`; `_spark_*` → nada além do `SELECT`;
  3. **depois** revoga o nível de banco antigo (`REVOKE IF EXISTS INSERT, UPDATE, DELETE ON db.*`)
     e, nas só-inserção/internas, `REVOKE IF EXISTS UPDATE, DELETE` (e `INSERT` nas internas).
  Conceder antes de revogar evita janela sem privilégio para o produto em produção. Chamada no
  provisionamento (após migrações), após cada migração de upgrade, em `applyArtifact` e pela CLI
  nova `instances:sync-grants`.
- **Alternativas**: `partial_revokes` (só vale em nível de banco, não de tabela); triggers que
  recusam UPDATE (o produto controla DDL? não, mas trigger é mais frágil e invisível).

## R-07 TLS e host (SEC-15)

- **Decisão**: `MYSQL_TLS` = `off | required | verify` (padrão `off`), `MYSQL_TLS_CA` (arquivo PEM,
  obrigatório em `verify`). Fora de `development`, `off` é erro de configuração. Pools e conexões
  administrativas recebem `ssl` (`required` → cifrado sem verificar a CA; `verify` → CA +
  verificação). Usuários de instância: `INSTANCE_DB_USER_HOST` (padrão `%`) e `REQUIRE SSL` quando
  `MYSQL_TLS ≠ off`; `syncOperationalGrants` também aplica `ALTER USER … REQUIRE SSL`. O contrato
  `/connection` ganha `tls: "required" | "disabled"` para o produto configurar o pool. Usuários do
  próprio Core são criados pela operação (documentado). Compose publica `127.0.0.1:3307`.

## R-08 Tokens no log (SEC-16)

- **Decisão**: `serializers.req` próprio no logger: método, URL com segmentos após `/convite/`,
  `/api/v1/invitations/`, `/api/v1/password-resets/` trocados por `[REDACTED]` e query `token=`
  mascarada, host, IP. O Fastify usa os serializers do `loggerInstance`.

## R-09 CSV (SEC-21) e cabeçalhos (SEC-22)

- CSV: prefixo neutralizado `^[=+\-@\t\r]`.
- Cabeçalhos: hook `onSend` global: CSP (a mesma da SPA), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(),
  payment=(), usb=()`, `X-Frame-Options: DENY`; HSTS `max-age=31536000; includeSubDomains` fora de
  `development`; `Cache-Control: no-store` em `/api/` e `/internal/` quando a rota não definiu.

## R-10 Dependências (SEC-09)

- `npm audit --omit=dev --audit-level=moderate` como script `audit:deps`, etapa de
  `npm run verify` e do job `static` da CI.
