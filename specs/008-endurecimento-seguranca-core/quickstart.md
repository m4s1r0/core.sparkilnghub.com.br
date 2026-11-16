# Quickstart — validar o endurecimento do Core

Pré-requisitos: `npm run dev:up` (MySQL no ar), `.env` de desenvolvimento.

1. Testes por item (cada um falha sem a correção):

   ```bash
   npx vitest run --project integration server/tests/integration/security/hardening
   npx vitest run --project unit server/tests/unit/hardening
   npx vitest run --project contract server/tests/contract/http-security.test.ts
   ```

   | SEC | Teste |
   | --- | --- |
   | 01 | `integration/security/hardening/instance-credential-isolation.test.ts` |
   | 02 | `…/hardening/product-login-limits.test.ts` |
   | 04 | `…/hardening/touch-role.test.ts` |
   | 12 | `…/hardening/append-only-grants.test.ts` |
   | 13 | `…/hardening/trust-proxy.test.ts` |
   | 14 | `…/hardening/progressive-throttle.test.ts` |
   | 15 | `…/hardening/mysql-tls.test.ts`, `unit/hardening/config-tls.test.ts` |
   | 16 | `unit/hardening/log-redaction.test.ts` |
   | 21 | `unit/hardening/csv.test.ts` |
   | 22 | `contract/http-security.test.ts` |
   | 09 | `npm run audit:deps` |

2. CLI: `npm run app-credential -- create sparkref teste --scopes sessions --instance <slug>`
   imprime `<id>.<segredo>`; sem `--instance` → erro; `list` mostra a instância.

3. Verificação completa: `npm run verify` (inclui `audit:deps` e o teste de isolamento).
