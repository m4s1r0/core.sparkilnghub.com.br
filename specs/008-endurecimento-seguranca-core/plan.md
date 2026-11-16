# Implementation Plan: Endurecimento de segurança — parte SparkCore

**Branch**: `008-hardening-seguranca-core` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-endurecimento-seguranca-core/spec.md`

## Summary

Fechar no Core as falhas `SEC-01, 02, 04, 09, 12–16, 21, 22` da auditoria de 15/11/2026, com um
teste por item que falha antes e passa depois. O centro é a **credencial por instância**: a
resolução de instância de `/internal/v1` passa a exigir o vínculo da credencial, e a CLI ganha
`--instance` e `bind`. O contrato interno sobe para **v1.4** de forma compatível (touch devolve
`200 {role, membershipStatus}`; `/connection` ganha `tls`). O restante é endurecimento local:
limitação progressiva, `trustProxy`, privilégios por tabela com tabelas só-inserção declaradas no
artefato, TLS no MySQL, serializer de log, CSV e cabeçalhos globais. Decisões em
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9, Node 24

**Primary Dependencies**: Fastify 5, Kysely 0.29, mysql2 3, pino 10, TypeBox 1.4, ajv-formats

**Storage**: MySQL 8.4 — `spark_identity`, `spark_core`, bancos de instância `<produto>_<uuid>` e
de acesso `<…>_acc`

**Testing**: Vitest (projetos `unit`, `integration`, `contract`) contra MySQL real
(`MysqlTestContext`, bancos `t_<run>_*`)

**Target Platform**: Linux (homologação/produção) atrás de proxy reverso; dev Windows/Linux com
compose

**Project Type**: web-service (monólito modular) + CLI

**Performance Goals**: sem regressão; touch continua ≤ 1 consulta na projeção + no máximo 1
escrita a cada 5 min

**Constraints**: contrato `/internal/v1` compatível com o Tuteli v1.3 em produção; nenhuma recusa
revela existência; segredos fora de log/URL

**Scale/Scope**: dezenas de instâncias; 10 itens SEC; ~25 arquivos de produção tocados

## Constitution Check

| Princípio | Verificação | Resultado |
| --- | --- | --- |
| I. Isolamento por instância | SEC-01 fecha o último caminho entre instâncias; pools continuam por banco | ✅ reforça |
| II. Identidade e autorização no servidor | Papel vem da projeção (touch v1.4); IP real só de proxy confiável | ✅ |
| III. Contratos versionados e mínimos | v1.4 aditiva e compatível, registrada no CHANGELOG e no OpenAPI; manifesto ganha campo opcional | ✅ |
| IV. Idempotente e seguro sob concorrência | Sincronização de privilégios idempotente (`GRANT`/`REVOKE IF EXISTS`), concede antes de revogar; limitação sob `FOR UPDATE` como hoje | ✅ |
| V. MySQL real e cenários de falha | Testes de integração com duas instâncias, privilégios e TLS reais | ✅ |
| VI. Rastreabilidade e privacidade | Novos eventos de segurança; tokens mascarados no log | ✅ |
| VII. Monólito e escopo disciplinado | Sem dependência nova; sem canal de e-mail (premissa) | ✅ |
| VIII. Design system | Sem mudança de interface | — |

Sem violações. Reavaliado após o desenho: sem mudanças.

## Project Structure

### Documentation (this feature)

```text
specs/008-endurecimento-seguranca-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/internal-v1.4.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
server/src/
├── platform/http/app-credential.ts        # SEC-01: recusa credencial por produto nos escopos de instância
├── modules/internal-api/sessions.ts       # SEC-01 resolução; SEC-02 clientIp + teto; SEC-04 touch 200
├── modules/internal-api/{connection,members}.ts  # SEC-01 evento; /connection.tls
├── modules/app-credentials/app-credentials.ts    # resolveInstance, bind, list com instância
├── cli/app-credential.ts                  # --instance, bind
├── modules/identity/throttle.ts           # SEC-14 progressivo; teto por credencial
├── modules/identity/login.ts              # SEC-14 regras novas + aviso
├── modules/identity/security-events.ts    # tipos novos
├── platform/migrations/{manifest,artifact-validator,apply-artifact}.ts  # SEC-12
├── platform/db/grants.ts (novo)           # SEC-12 sincronização; SEC-15 conta/host/TLS
├── modules/provisioning/{steps,migration-steps}.ts  # SEC-12/15 chamadas
├── cli/instances-sync-grants.ts (novo)    # SEC-12/15 instâncias existentes
├── platform/config/{schema,load}.ts       # TRUSTED_PROXIES, MYSQL_TLS*, INSTANCE_DB_USER_HOST
├── platform/db/pools.ts                   # SEC-15 ssl
├── app/build-app.ts                       # SEC-13 trustProxy
├── app/plugins/security-headers.ts (novo) # SEC-22
├── platform/logging/logger.ts             # SEC-16 serializer de req
└── lib/csv.ts                             # SEC-21
compose.yaml                               # SEC-15 127.0.0.1
scripts/verify.ts, package.json            # SEC-09 audit:deps
contracts/{openapi.yaml,CHANGELOG.md,access-projection.md,commands.md,migration-artifact.md}
docs/operacao/credenciais-aplicacao.md (novo), docs/ecossistema/06-conformidade-produtos.md
```

**Structure Decision**: módulos existentes; dois arquivos novos de plataforma (`db/grants.ts`,
`plugins/security-headers.ts`) e um CLI.

## Complexity Tracking

Nenhuma violação a justificar.
