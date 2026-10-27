# Implementation Plan: F01 — Identidade e contextos do SparkCore

**Branch**: `002-f01-identidade-contextos` | **Date**: 2026-10-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-f01-identidade-contextos/spec.md`

## Summary

Dar ao SparkCore identidade e contexto: contas centrais em `spark_identity` com Argon2id, MFA TOTP
obrigatório para administradores da plataforma, sessões opacas do Core, convites e vínculos com
proteção do último administrador, recuperação por link exibido uma vez (D-07) e bloqueio global.
Para produtos, a D-04 é implementada como **projeção de acesso**: o Core cria a sessão de produto e
mantém a réplica mínima dos vínculos num **banco de acesso** companheiro de cada instância
(`<instância>_acc`); o produto valida cada requisição localmente e só pode ler e encerrar sessões.
Tudo provado com duas instâncias sintéticas do produto de referência. Detalhes em
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 sobre Node.js 24 LTS (D-05)

**Primary Dependencies**: as de F00 + `@node-rs/argon2` 2.2 (hash de senha), `@fastify/cookie` 11
(cookies), `qrcode` 1.5 na interface (QR do TOTP); TOTP com `node:crypto`

**Storage**: MySQL 8.4 — `spark_identity` (identidade), `spark_core` (`instance_ref`,
`app_credential`, `access_sync_job`), `<instância>_acc` (projeção de acesso)

**Testing**: Vitest 5 (unitários com vetores do RFC 6238; integração com MySQL real, incluindo
concorrência e privilégios), Ajv contra OpenAPI, Playwright (login com TOTP, telas 360/1280 px)

**Target Platform**: igual a F00

**Project Type**: monólito modular (API + trabalhador + SPA)

**Performance Goals**: login do Core p95 ≤ 400 ms; login de produto p95 ≤ 1 s; validação de sessão
pelo produto p95 ≤ 10 ms; revogação aplicada em todas as instâncias acessíveis em ≤ 5 s (CS-003,
CS-006)

**Constraints**: nenhum segredo em claro no banco (exceto o segredo TOTP cifrado com chave
externa); produto sem privilégio de escrita na projeção além do logout; administrador da
plataforma sem acesso a instâncias; nada do SparkPet

**Scale/Scope**: ~15 tabelas novas, 2 artefatos de migração novos (`spark_identity` v2+,
`access_projection` v1), 36 endpoints, 12 telas, 3 comandos, 1 tarefa do trabalhador (sincronização e reconciliação)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio / regra (v1.2.1) | Como F01 atende | Resultado |
|---|---|---|
| I. Isolamento | Sessão de produto só no banco de acesso da própria instância; nome derivado do UUID; produto lê e encerra apenas; testes negativos com A e B (rota, corpo, token cruzado, credencial de outro produto, privilégio) | ✅ (ver nota 1) |
| I. Projeção mínima | Projeção sem e-mail, senha, MFA ou vínculos de outras instâncias (contrato `access-projection.md`) | ✅ |
| I/II. Admin da plataforma sem acesso a instâncias | Nenhuma sessão, vínculo ou credencial de instância para o papel de plataforma (FR-035); teste negativo | ✅ |
| II. Sessões opacas no servidor | Token aleatório; só sha256 persistido; cookie HttpOnly/SameSite=Strict; `Secure` fora de dev | ✅ |
| II. Senhas | Argon2id, sem senha padrão nem comunicada; política de senha | ✅ |
| II. Revogação alcança sessões abertas | `auth_revision` + encerramento na projeção antes de concluir; pendência persistente | ✅ |
| II. MFA do administrador, último administrador | TOTP obrigatório; reautenticação de 5 min; `FOR UPDATE` nos ativos; teste com 100 rodadas concorrentes | ✅ |
| II. Indisponibilidade | Login/convites/MFA → 503; sessões existentes de produto seguem pela projeção (v1.2.0) | ✅ |
| III. Contratos | OpenAPI v1.1.0 (compatível) + contrato de dados da projeção v1; provados com `sparkref` | ✅ |
| IV. Idempotência e concorrência | `Idempotency-Key` em convites e bloqueio; versão otimista em vínculos; `access_sync_job` com lease e repetição | ✅ |
| V. MySQL real e falhas | Integração com MySQL, privilégios reais, concorrência, banco de acesso inacessível; testes de alto risco antes | ✅ |
| VI. Auditoria e privacidade | `security_event` só inserção; IP/agente só em eventos de segurança; nenhum segredo em log | ✅ |
| VII. Monólito e escopo | Mesmos dois processos; sem broker; SparkPet intocado; sem SSO/impersonação | ✅ |
| VIII. Design system | Telas com componentes públicos; lacunas (campo OTP, QR) registradas | ✅ |
| Gate de prontidão | `npm run gate -- F01` = 0 (D-01, D-02, D-04, D-05 confirmadas) | ✅ |

**Nota 1 — banco de acesso companheiro**: como privilégios no MySQL são aditivos, a única forma de
impedir por privilégio que o produto crie sessões ou desfaça revogações (exigência do princípio I)
é um banco separado, exclusivo da instância, com o mesmo prefixo e UUID (research R-07). A emenda
PATCH v1.2.1 da constituição explicita que a projeção fica nesse banco de acesso e que "banco da
instância" abrange os dois.

**Pós-design (Phase 1)**: reavaliado com data-model e contratos — sem novas violações.

## Project Structure

### Documentation (this feature)

```text
specs/002-f01-identidade-contextos/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── openapi-f01.yaml        # incorporado a contracts/openapi.yaml (v1.1.0)
│   ├── access-projection.md    # contrato de dados v1 (publicado em contracts/)
│   ├── ui-f01.md
│   └── commands-f01.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
server/
├── migrations/
│   ├── spark_identity/          # 0002+ contas, credenciais, MFA, papéis, vínculos, convites,
│   │                            #       sessões, recuperação, throttle, eventos, idempotência
│   ├── spark_core/              # 0003+ instance_ref, app_credential, access_sync_job
│   └── access_projection/       # artefato do Core para <instância>_acc (v1)
├── assets/common-passwords.txt  # SecLists 10k (MIT), com ORIGEM
├── src/
│   ├── platform/
│   │   ├── crypto/              # tokens, sha256, AES-GCM (segredo TOTP), comparação constante
│   │   ├── http/                # cookies, verificação de origem (CSRF), guarda de sessão,
│   │   │                        # reautenticação, idempotência, credencial de aplicação
│   │   └── migrations/          # histórico parametrizável (_spark_access_history)
│   ├── modules/
│   │   ├── identity/            # contas, senha, TOTP, sessões do Core, convites, recuperação,
│   │   │                        # throttle, eventos de segurança, administradores
│   │   ├── memberships/         # vínculos, último administrador, convites de instância
│   │   ├── access-projection/   # escrita da projeção, sincronização, pendências
│   │   ├── instances/           # instance_ref (mínimo)
│   │   └── internal-api/        # /internal/v1 (sessões de produto, vínculos locais)
│   ├── worker/jobs/access-sync.ts
│   └── cli/{bootstrap-admin,app-credential}.ts
├── reference-product/           # + cliente de teste que valida pela projeção (sem UI)
└── tests/{unit,integration,contract}/   # + suítes F01
web/src/
├── app/{routes.tsx,auth-guard.tsx}
├── api/{auth,admins,members,accounts}.ts
└── pages/{login,mfa,invitation,recovery,security,admins,accounts,instances,pending}/
```

**Structure Decision**: mesmo monólito de F00; identidade e vínculos como módulos separados
(fronteira de dados `spark_identity`), projeção de acesso como módulo próprio porque escreve em
bancos de instância com credencial dedicada (`spark_access_writer`, papel `access`). O cliente de
validação do produto de referência mora em `server/reference-product/` e serve de implementação de
referência do contrato de dados para o futuro SparkPet.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Banco de acesso companheiro por instância (`<instância>_acc`) | Impedir por privilégio que o produto crie sessões, altere vínculos ou desfaça revogações (princípio I, FR-034) | Tabelas no banco operacional: o usuário do produto tem DML no banco inteiro e MySQL não subtrai privilégio por tabela |
| Credencial dedicada `spark_access_writer` | O processo web precisa escrever a projeção sem ter DDL nem acesso aos dados operacionais | Usar o provisionador no processo web daria DDL e acesso total aos bancos de produto |
| TOTP implementado internamente | ~40 linhas verificáveis por vetores do RFC; evita dependência pouco mantida | `speakeasy` sem manutenção; `otpauth` traria mais superfície que o necessário |

## Riscos e pontos de atenção

- **Segredo `IDENTITY_SECRET_KEY`**: perda impede verificar TOTP (todos precisariam recadastrar).
  Plano de rotação com `key_version`; armazenamento de produção fica para a hospedagem.
- **Provisionamento ainda é F02**: F01 cria os bancos de acesso das instâncias sintéticas pelo
  `apply-artifact`/sementes; F02 incorpora isso ao provisionador real.
- **Inatividade de sessão de produto**: depende do `touch` ao Core; com o Core fora por mais de
  2 h, sessões expiram por inatividade (comportamento seguro, documentado).
- **Bundle**: `qrcode` acrescenta ~25 kB; somado ao design system, revisar após F01.
