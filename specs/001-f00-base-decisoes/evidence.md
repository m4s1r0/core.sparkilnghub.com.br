# Evidências — F00

Ambiente de referência: Windows 10 Pro 19045, Node.js 24.18.0, npm 11.16, Docker 29.9.2,
MySQL 8.4 (`mysql:8.4`), Edge local para E2E. Data: 2026-10-26.

## Verificação completa (`npm run verify`)

`E2E_EXPECT_HEALTHY=1 npm run verify` — **16/16 etapas verdes em 98 s**:

| Etapa | Resultado |
|---|---|
| typecheck, lint, format:check | sem erros |
| test:scripts | 37 testes (ADR, portão, check:ds, check:migrations) |
| check:adr / gate | 5 ADRs válidas; nenhuma fatia `pronta` com decisão pendente |
| check:ds | 6 arquivos da interface; pacote 0.2.0 registrado |
| check:secrets | gitleaks v8.24.2: nenhum segredo; chave fictícia plantada → falha (conferido) |
| check:migrations | imutabilidade (sem base em origin/main ainda) e sem `DROP DATABASE` em server/src |
| ref:validate | `sparkref` v1/v2, checksums conferidos |
| test:unit | 52 testes |
| test:component | 5 testes (matriz de estados da página) |
| test:integration | 23 testes contra MySQL real (migrador, privilégios, status, artefato, sementes, atualização) |
| check:upgrade | sem versão anterior em origin/main → passa trivialmente |
| test:contract | 14 testes (OpenAPI × respostas reais, correlação, segurança de erros) |
| test:e2e | 12 testes (360 e 1280 px, teclado, estados, axe sem violações sérias) |

## CI no GitHub (T056)

PR #1, execução [40311206343](https://github.com/m4s1r0/core.sparkilnghub.com.br/actions/runs/40311206343)
no commit `a5ee333`: **4/4 jobs verdes** — `static` 44 s, `secrets` 12 s, `test` 48 s,
`e2e` 73 s. Jobs em paralelo; o mais longo bem abaixo da meta de 15 min (CS-004).

Ajustes feitos até ficar verde: gitleaks rodando pela mesma imagem do `check:secrets` (a
`gitleaks-action` falhava sem apontar vazamento); runners fixados em `ubuntu-24.04`; E2E com o
Google Chrome da imagem do runner, porque `playwright install --with-deps` travava.

## Desempenho (T084)

200 requisições sequenciais a `GET /api/v1/system/status` no build de produção, com MySQL e
trabalhador ativos, após 10 de aquecimento:

| p50 | p95 | p99 | máx |
|---|---|---|---|
| 15,5 ms | **16,2 ms** | 16,5 ms | 16,6 ms |

Meta do plano: p95 ≤ 300 ms — atendida.

## Quickstart em Windows (T085, parcial)

| Seção | Resultado |
|---|---|
| §1 Ambiente do zero | `npm run dev:up` → "SparkCore saudável"; status `SAUDAVEL` com 4 componentes; interface em :5173 |
| §2 Privilégios | `privileges.test.ts` verde: web/worker/inst_* sem DDL; provisionador só em `sparkref_`/`sparkpet_` |
| §3 Indisponibilidade | MySQL parado → `503`, `Retry-After: 10`, `DB_UNREACHABLE`, `/health/live` 200; religado → `SAUDAVEL` em ~6 s sem reiniciar |
| §4 Repetição e reinício | `db:migrate`/`db:seed` idempotentes (0 inseridos na 2ª vez); `dev:reset` ok; `SPARK_ENV=production db:seed` → saída 2 + `env_guard_refused` |
| §5 Decisões | `gate -- F01` → saída 3 (D-04, D-05) |
| §6 Produto de referência | `ref:validate` e `reference-artifact.test.ts` verdes |
| §8 Interface | E2E verde nas duas larguras |

Pendente: cronometrar o §1 a partir de um clone limpo (CS-001) e repetir em Linux.

## Defeitos encontrados e corrigidos durante a validação

- `GRANT` com `_` no nome do banco funciona como curinga e era recusado ao provisionador;
  nomes agora escapados (`grantDatabaseName`).
- Portas lidas do ambiente não eram convertidas para número (esquema TypeBox espalhado).
- Erros apareciam como `[object Object]` no log (redação convertia `Error` em objeto comum).
- Ordem de camadas CSS do design system × reset do Tailwind (ver `docs/design-system-updates.md`).
- `dev:down` no Windows deixava servidor e Vite órfãos; agora encerra a árvore (`taskkill /T`).
- Avisos de depreciação do Fastify (`requestIdLogLabel`, `disableRequestLogging`) → `logController`.

## Limitações conhecidas

- Bundle da interface ~754 kB (o design system traz o Tiptap); proposta registrada.
- `/api/v1/system/status` é público em F00; passa a exigir sessão em F01.
- PRs de falha deliberada (T086) e proteção de `main` (configuração manual) pendentes.
