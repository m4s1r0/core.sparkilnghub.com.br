# 05 — Linha de base de segurança

A auditoria de 15/11/2026 (`tuteli/.../docs/seguranca/prompt-sdd-hardening-seguranca.md`)
encontrou 22 vulnerabilidades no par Tuteli + SparkCore. Este documento as converte em
**requisitos permanentes** `SEC-BASE-nn` (mesma numeração dos `SEC-nn` da auditoria), aplicáveis a
todo produto. Para o Tuteli e o Core, são correções; para um produto novo, são requisitos da
fatia de acesso (C01 no Cortivo) e não podem ser "corrigidos depois".

**Ordem de entrega:** Core primeiro (contrato `/internal/v1` v1.4, compatível), depois cada
produto. A parte Core foi implementada em `specs/008-endurecimento-seguranca-core` (15/11/2026):
testes em `server/tests/{unit,integration/security}/hardening/` e
`server/tests/contract/http-security.test.ts`. Nenhum produto novo entra em homologação com credencial por produto (SEC-BASE-01) ainda
ativa no Core.

## Matriz

Legenda de lado: **Core** = corrigido uma vez no SparkCore, beneficia todos; **Produto** =
cada SaaS implementa; **Ambos**.

| ID          | Sev.    | Lado                                         | Requisito canônico                                                                                                                                                                                                               | Teste de aceite (todo produto)                                                                                                                            | Padrão relacionado    |
| ----------- | ------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| SEC-BASE-01 | Crítica | Core (+ cada produto usa credencial própria) | Credenciais `connection`/`sessions`/`members` vinculadas a uma instância; slug de outra instância → resposta idêntica a inexistente; CLI `--instance`; migração/revogação das credenciais por produto.                           | Credencial de A pede `/connection`, `/sessions`, `/sessions/touch`, `/members` de B → recusa + evento de segurança.                                       | `INT-001`             |
| SEC-BASE-02 | Alta    | Ambos                                        | IP real: `TRUSTED_PROXIES`, salto mais à direita não confiável, senão socket; limite local por IP no login; Core com teto global por credencial e validação IPv4/IPv6 de `clientIp`.                                             | 60 logins com `X-Forwarded-For` diferente do mesmo socket → limitados; IP gravado é o real.                                                               | `INT-030`             |
| SEC-BASE-03 | Alta    | Produto                                      | Logout grava `access_session_logout` antes de apagar cookie.                                                                                                                                                                     | Cookie antigo após logout → `401`.                                                                                                                        | `INT-060`             |
| SEC-BASE-04 | Alta    | Ambos                                        | Papel nunca vem do cookie: produto usa o papel da projeção (`INT-050`); Core v1.4 devolve `{role, membershipStatus}` no touch.                                                                                                   | Rebaixar papel no Core → próxima escrita de administrador → `403`.                                                                                        | `INT-050`             |
| SEC-BASE-05 | Média   | Produto                                      | CSRF: métodos inseguros em `/api/` exigem `Sec-Fetch-Site: same-origin` ou `Origin` = `PUBLIC_ORIGIN`; só `application/json`; `SameSite=Strict`.                                                                                 | POST com `Origin` de subdomínio irmão → `403`; `text/plain` → `415`.                                                                                      | `INT-040`, `INT-090`  |
| SEC-BASE-06 | Média   | Produto                                      | Cookie cifrado (AES-256-GCM) ou opaco; `iat`/`exp` no servidor; `Secure` fora do dev local; `__Host-`; rotação de `SESSION_SECRET` (atual + anteriores).                                                                         | Cookie decodificado não revela token/e-mail; cookie com `exp` vencido → `401`; troca de segredo mantém sessões assinadas pela chave anterior até expirar. | `INT-040`             |
| SEC-BASE-07 | Média   | Produto                                      | Toda chamada ao Core com timeout (3 s) → `503`; touch fora do caminho crítico, ≤ 1/5 min.                                                                                                                                        | Core lento (5 s) → resposta `503` em ≤ 3,5 s; leitura protegida com projeção acessível continua respondendo.                                              | `INT-002`, `INT-051`  |
| SEC-BASE-08 | Média   | Produto                                      | `bodyLimit` 1 MiB → `413`.                                                                                                                                                                                                       | Corpo de 2 MiB → `413`.                                                                                                                                   | `INT-090`             |
| SEC-BASE-09 | Média   | Ambos                                        | Dependências sem vulnerabilidade moderada+; `npm audit --omit=dev` no portão; `hono` e `@hono/node-server` acima das versões afetadas.                                                                                           | Gate de CI falha com achado moderado+.                                                                                                                    | `ECO-011`             |
| SEC-BASE-10 | Média   | Ambos                                        | Cabeçalhos em **todas** as respostas (SPA e API): CSP `'self'`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` restritiva, HSTS em produção, `Cache-Control: no-store` na API.        | Teste de cabeçalhos em `/`, `/api/*` e erro `404`.                                                                                                        | `INT-090`             |
| SEC-BASE-11 | Média   | Produto                                      | Dados pessoais: documento (CPF/CNPJ) cifrado com índice HMAC; mascarado (`***.***.***-12`) para não administrador; leitura completa auditada. Campos que o colaborador vê por inteiro são decisão de produto registrada na spec. | Colaborador lista clientes → CPF mascarado; administrador abre completo → registro de auditoria.                                                          | `ECO-013`, `UI-040.4` |
| SEC-BASE-12 | Média   | Ambos                                        | Artefato declara tabelas **só-inserção** (`auditoria`, `access_session_logout`, livros de lançamento quando aplicável); Core concede só `SELECT, INSERT` nelas; opcional encadeamento de hash.                                   | `UPDATE`/`DELETE` em `auditoria` com a credencial operacional → erro de privilégio.                                                                       | `ECO-013`             |
| SEC-BASE-13 | Média   | Core                                         | `trustProxy` com lista explícita.                                                                                                                                                                                                | Atrás de proxy, eventos registram IP real.                                                                                                                | —                     |
| SEC-BASE-14 | Média   | Core                                         | Atraso progressivo por (e-mail, origem) antes do bloqueio; bloqueio total só com volume alto; aviso ao titular e à plataforma.                                                                                                   | 10 falhas de uma origem não bloqueiam login de outra origem.                                                                                              | —                     |
| SEC-BASE-15 | Média   | Ambos/infra                                  | Usuários MySQL com host restrito, `REQUIRE SSL` fora do dev, `ssl` nos pools, compose em `127.0.0.1`.                                                                                                                            | Conexão sem TLS em homologação → recusada.                                                                                                                | `INT-020.3`           |
| SEC-BASE-16 | Baixa   | Core (+ produto se tiver tokens em URL)      | Serializer de log mascara segmentos de token em URL.                                                                                                                                                                             | Log de `/convite/<token>` não contém o token.                                                                                                             | —                     |
| SEC-BASE-17 | Baixa   | Ambos                                        | `X-Correlation-Id` aceito só como UUID; senão gerado (v7).                                                                                                                                                                       | Valor `abc` → resposta traz UUID novo.                                                                                                                    | `INT-090`             |
| SEC-BASE-18 | Baixa   | Produto                                      | `app.onError` global: log com nome, código e correlação (sem SQL/valores); resposta envelope 500.                                                                                                                                | Erro forçado de mysql2 → log sem SQL; resposta genérica.                                                                                                  | `INT-090`             |
| SEC-BASE-19 | Baixa   | Produto                                      | Revalidar `/connection` periodicamente; descartar pool se instância não estiver `ATIVA`.                                                                                                                                         | Suspender instância → em ≤ 10 min pool descartado; requisições `401/503`.                                                                                 | `INT-020.2`           |
| SEC-BASE-20 | Baixa   | Produto                                      | Paginação com teto (`deslocamento` ≤ 10.000) ou cursor.                                                                                                                                                                          | `offset=999999999` → `422`.                                                                                                                               | `INT-090`             |
| SEC-BASE-21 | Baixa   | Ambos                                        | CSV: neutralizar `=`, `+`, `-`, `@`, `\t`, `\r` iniciais.                                                                                                                                                                        | Célula `\t=1+1` exportada neutralizada.                                                                                                                   | —                     |
| SEC-BASE-22 | Baixa   | Core                                         | Cabeçalhos de segurança também nas respostas não HTML do Core.                                                                                                                                                                   | —                                                                                                                                                         | —                     |

## Kit de implementação recomendado por produto

Para não reescrever a mesma defesa em cada SaaS, cada produto implementa estes módulos com os
mesmos nomes e testes (copiar do primeiro produto que os entregar — previsto: Tuteli na feature
de endurecimento ou Cortivo em C01, o que vier primeiro):

| Módulo (`api/src/`)                               | Cobre            |
| ------------------------------------------------- | ---------------- |
| `middleware/client-ip.ts`                         | SEC-BASE-02      |
| `middleware/rate-limit-login.ts`                  | SEC-BASE-02      |
| `middleware/origin-check.ts` + `json-only.ts`     | SEC-BASE-05      |
| `middleware/session-cookie.ts` (AES-GCM, rotação) | SEC-BASE-06      |
| `middleware/require-auth.ts` (projeção D-04)      | SEC-BASE-04, -07 |
| `middleware/security-headers.ts`                  | SEC-BASE-10      |
| `middleware/correlation.ts` (UUID)                | SEC-BASE-17      |
| `core/client.ts` (timeout, correlação)            | SEC-BASE-07      |
| `db/connection-refresh.ts`                        | SEC-BASE-19, -15 |
| `db/pii.ts` (cifra + HMAC + máscara)              | SEC-BASE-11      |
| `routes/errors.ts` + `app.onError`                | SEC-BASE-18      |
| `modules/comum/paginacao.ts`                      | SEC-BASE-20      |
| `modules/comum/csv.ts`                            | SEC-BASE-21      |

Extrair esse kit para um pacote compartilhado (`@sparkling-hub/saas-kit`) é candidato a ADR
depois do segundo produto (regra de três): antes disso, a duplicação controlada é mais barata
que uma abstração prematura.

## Gate de segurança (G3)

Uma fatia só é concluída com: testes `SEC-BASE-*` aplicáveis verdes, `npm audit --omit=dev`
sem moderado+, teste de isolamento com duas instâncias e revisão de que nenhum segredo aparece em
log, URL, resposta, CSV ou bundle (`grep` do `web/dist` por `SPARKCORE_`/`SESSION_SECRET`).

## Fora desta linha de base

Pentest externo, WAF e MFA para usuários dos produtos (evolução prevista pelas diretrizes) ficam
para depois do primeiro piloto com dados reais, como recomendado pela auditoria.
