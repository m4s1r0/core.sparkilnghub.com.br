# Implementation Plan: F08-Core — Auditoria, utilização e painel do Core

**Branch**: `005-f08-core-auditoria-utilizacao` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-f08-core-auditoria-utilizacao/spec.md`

---

## Summary

F08-Core entrega quatro capacidades complementares sobre a infraestrutura de F01–F03:
(1) endpoint interno `POST /internal/v1/instances/{id}/usage-batches` para recepção e deduplicação
de lotes de utilização enviados pelo produto, com autenticação via credencial de escopo `utilizacao`;
(2) `GET /api/v1/dashboard/stats` expandido com métricas de utilização, telemetria e versão;
(3) rotas de consulta e exportação CSV de `security_event` e `core_audit_event` com paginação e
neutralização de fórmulas; (4) worker periódico que limpa `ip`/`user_agent` de `security_event`
após 180 dias. Requer migration spark_core 5→6 e spark_identity 4→5; atualização do design system
0.2.0→0.2.1 como primeira tarefa (API preservada).

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js 20 LTS

**Primary Dependencies**:
- Servidor: Fastify, MySQL2, Zod, Argon2, `@sparkling-hub/design-system` 0.2.1 (web)
- ORM/query: SQL raw via MySQL2 pool (padrão do projeto, sem ORM)
- Testes: Vitest, `supertest`, MySQL real (MySQL 8.0)
- Build: tsx (dev), esbuild (prod)

**Storage**:
- `spark_core` (MySQL 8.0): tabelas novas `instance_usage_batch`, `instance_usage_event`; ALTER em `app_credential.scopes` → ADD 'utilizacao' (migration 0006)
- `spark_identity` (MySQL 8.0): ADD INDEX em `security_event(instance_id, created_at)` (migration 0005)
- Tabelas lidas (sem alteração): `security_event`, `core_audit_event`, `instance`, `admin_task`, `app_credential`

**Testing**: Vitest — unit (regras de negócio), integration (MySQL real), contract (HTTP via supertest)

**Target Platform**: Linux server (Node 20), web browser (React 18 + Vite)

**Performance Goals**:
- `POST /internal/v1/.../usage-batches`: < 200ms p95 para lotes de até 500 eventos
- `GET /api/v1/dashboard/stats`: < 500ms p95 em tempo real (sem cache no MVP)
- Listagens paginadas: < 300ms p95

**Constraints**:
- CSV: máx. 10.000 linhas por exportação síncrona (R-05)
- Limpeza worker: LIMIT 1000 por ciclo, idempotente (R-03)
- Deduplicação: `INSERT IGNORE` com UNIQUE KEY — sem `SELECT` antes do `INSERT` (R-01)
- Senha/segredo MUST NOT aparecer em exports ou audit trail

**Scale/Scope**: MVP — dezenas de instâncias, poucos milhares de eventos por instância; ~5 telas novas/modificadas, ~4 rotas de API novas, 2 módulos novos de servidor

---

## Constitution Check

*Re-checked post-design (Phase 1 complete).*

| Princípio | Verificação | Status |
|-----------|-------------|--------|
| **I — Isolamento por instância** | `POST usage-batches` verifica que credencial pertence à instância do path antes de gravar; nenhum evento de instância A pode usar `instance_id` de instância B (I-01); testes negativos com 2 instâncias sintéticas exigidos | ✅ OK |
| **II — Identidade/autorização no servidor** | Credencial de app com escopo `utilizacao` validada no servidor; escopo separado de `connection` (princípio do menor privilégio) | ✅ OK |
| **III — Contratos versionados e mínimos** | `openapi-f08.yaml` define o contrato completo antes da implementação; produto de referência provará o contrato de lotes (R-06 / R-07); telemetria trafega apenas contagens e `kind` (sem dados financeiros ou PII de tutores/animais) | ✅ OK |
| **IV — Operações idempotentes** | Reenvio de mesmo `batch_id` retorna resultado original (CA-SC-011); `INSERT IGNORE` garante idempotência de evento individual | ✅ OK |
| **V — Verificação com MySQL real** | Testes de integração em MySQL real obrigatórios; deduplicação e isolamento testados com 2 instâncias; T-14 coberto (repetição, atraso, lacuna, indisponibilidade) | ✅ OK |
| **VI — Rastreabilidade, auditoria e privacidade** | Nenhuma rota de edição ou exclusão de `security_event`/`core_audit_event`; limpeza de IP é UPDATE (não DELETE) preservando o evento (I-04, SC-033, SC-035) | ✅ OK |
| **VII — Mínimo privilégio** | Escopo `utilizacao` separado de `connection` e `sessions`; credencial de utilização pode existir sem acesso ao banco da instância | ✅ OK |
| **VIII — Versionamento e atualização documentada** | Upgrade design system 0.2.0→0.2.1 registrado como primeira tarefa da fatia; versão anterior e nova documentadas (R-06) | ✅ OK |

**Resultado**: sem violações. Nenhuma justificativa de complexidade necessária.

---

## Project Structure

### Documentation (this feature)

```text
specs/005-f08-core-auditoria-utilizacao/
├── plan.md              ← este arquivo
├── spec.md
├── research.md          ← R-01 a R-10 (Phase 0)
├── data-model.md        ← tabelas, migrations, invariantes (Phase 1)
├── quickstart.md        ← guia de validação end-to-end (Phase 1)
├── contracts/
│   ├── openapi-f08.yaml ← API contracts (Phase 1)
│   └── ui-f08.md        ← UI screen contracts (Phase 1)
├── checklists/
│   └── requirements.md
└── tasks.md             ← Phase 2 output (/speckit-tasks — ainda não criado)
```

### Source Code

```text
server/
├── migrations/
│   ├── spark_core/
│   │   └── 0006_auditoria_utilizacao.sql    ← CREATE TABLE batch/event, ALTER app_credential.scopes
│   └── spark_identity/
│       └── 0005_auditoria_index.sql         ← ADD INDEX security_event(instance_id, created_at)
│
└── src/
    ├── modules/
    │   ├── utilization/                      ← NOVO módulo
    │   │   ├── utilization.ts               ← lógica: INSERT IGNORE, deduplicação, relatórios
    │   │   └── routes.ts                    ← POST /internal/..., GET /api/v1/instances/:id/usage, GET /api/v1/usage
    │   ├── audit/                            ← NOVO módulo (ou ampliar audit/audit.ts existente)
    │   │   └── routes.ts                    ← GET /api/v1/security-events, GET /api/v1/audit-events
    │   ├── system/
    │   │   └── routes.ts                    ← expandir GET /api/v1/dashboard/stats
    │   ├── audit/
    │   │   └── audit.ts                     ← já existe; ampliar com consulta paginada
    │   └── identity/
    │       └── security-events.ts           ← já existe; ampliar com rota paginada + CSV
    │
    └── workers/
        └── ip-retention.ts                  ← NOVO worker diário de limpeza de IP/agente

tests/
└── integration/
    ├── utilization/
    │   ├── receive-batch.test.ts            ← T-14 (repetição, atraso, lacuna, indisponibilidade)
    │   └── usage-report.test.ts
    ├── audit/
    │   ├── security-events.test.ts
    │   └── audit-events.test.ts
    ├── dashboard/
    │   └── stats.test.ts
    └── workers/
        └── ip-retention.test.ts

web/
├── package.json                             ← atualizar DS 0.2.0 → 0.2.1
└── src/
    ├── api/
    │   ├── utilization.ts                   ← hooks React Query
    │   ├── security-events.ts
    │   └── audit-events.ts
    └── pages/
        ├── dashboard/
        │   └── DashboardPage.tsx            ← expandir StatsBlock com novas métricas
        ├── security-events/
        │   └── SecurityEventsPage.tsx       ← NOVO
        ├── audit/
        │   └── AuditEventsPage.tsx          ← NOVO
        ├── usage/
        │   └── UsagePage.tsx               ← NOVO (consolidado)
        └── instances/
            └── InstancePage.tsx             ← adicionar aba Utilização
```

**Structure Decision**: Web app com servidor Fastify + React/Vite. Dois módulos novos no servidor
(`utilization/`, e expansão de `audit/`). Novas páginas no `web/src/pages/`. Convenção
um-módulo-por-assunto do projeto preservada.

---

## Complexity Tracking

> Nenhuma violação de constituição identificada. Tabela não necessária.
