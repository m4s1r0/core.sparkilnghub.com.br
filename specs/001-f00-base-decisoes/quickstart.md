# Quickstart de validação — F00

Roteiro para provar que F00 está concluída. Comandos em [contracts/commands.md](./contracts/commands.md);
respostas em [contracts/openapi.yaml](./contracts/openapi.yaml); tela em
[contracts/ui-base-page.md](./contracts/ui-base-page.md).

## Pré-requisitos

- Git, Node.js 24 LTS (npm 11), Docker com Compose v2. Windows (PowerShell) ou Linux.
- Portas livres: 3000 (API), 5173 (interface em desenvolvimento), 3307 (MySQL local).
- Nenhuma instalação nativa de MySQL é necessária.

## 1. Ambiente local do zero (US2, CS-001)

```powershell
git clone https://github.com/m4s1r0/core.sparkilnghub.com.br.git
cd core.sparkilnghub.com.br
Copy-Item .env.example .env      # Linux: cp .env.example .env ; preencher senhas locais
npm ci
npm run dev:up
```

Esperado: o comando termina com "SparkCore saudável" e lista as URLs. Cronometre do clone até
aqui (meta ≤ 30 min).

- `GET http://127.0.0.1:3000/health/live` → `200 {"status":"ok"}`.
- `GET http://127.0.0.1:3000/api/v1/system/status` → `200`, `status: "SAUDAVEL"`, quatro
  componentes saudáveis, `X-Correlation-Id` no cabeçalho.
- Abrir `http://127.0.0.1:5173/` → página base com a marca e a tabela de componentes.

## 2. Privilégios separados (US2 cenário 2, FR-008)

Executar o teste dedicado: `npm run test:integration -- privileges`. Esperado: a credencial web
e a de instância recebem erro de privilégio ao tentar `CREATE DATABASE` e `ALTER TABLE`; o
provisionador cria banco apenas com prefixo `sparkref_`/`sparkpet_`.

## 3. Indisponibilidade (US2 cenário 3, US4 cenários 2–3)

```powershell
docker compose stop mysql
```

- `/api/v1/system/status` → `503`, `Retry-After`, `spark_core`/`spark_identity` com
  `reason: "DB_UNREACHABLE"`; corpo sem SQL, usuário ou stack trace.
- Página base mostra o aviso de indisponibilidade com correlação.
- Parar só o trabalhador (encerrar o processo `worker`) → após 30–120 s `worker: DEGRADADA`,
  depois `INDISPONIVEL`, com servidor ainda saudável.

`docker compose start mysql` restaura o estado saudável sem reiniciar o servidor.

## 4. Repetição e reinicialização (US2 cenários 4–5, US7)

- `npm run dev:up` duas vezes → sem duplicidade (`db:seed` informa "0 inseridos").
- `npm run dev:reset` → bancos recriados, migrados e semeados.
- `$env:SPARK_ENV="production"; npm run db:seed` → saída 2 e log `env_guard_refused`.

## 5. Decisões e portão (US1)

- `docs/adr/` contém `D-01` a `D-05` com os campos do [data-model](./data-model.md).
- `npm run gate -- F01` → saída 3 listando `D-04` (proposta).
- Marcar uma ADR como `confirmada` sem `owner` → `npm run verify` falha na etapa de ADR.

## 6. Produto de referência (US6)

- `npm run ref:validate` → 0.
- `npm run test:integration -- reference-artifact` → v1→v2 igual a v1+v2 no banco vazio;
  checksum alterado e versão fora de sequência recusados.

## 7. Verificação completa e bloqueio (US3, CS-003, CS-004)

- `npm run verify` → todas as etapas verdes.
- Em uma branch de teste, abrir PRs com: teste quebrado, erro de tipo, migração publicada
  alterada, segredo fictício em arquivo, campo removido da resposta de status. Cada PR deve
  falhar na etapa correspondente. Duração do workflow ≤ 15 min.
- Configurar no GitHub a proteção de `main` exigindo os jobs `static`, `secrets`, `test` e
  `e2e` (passo manual, uma vez).

## 8. Interface (US4, CS-007)

`npm run test:e2e` cobre 360 px e 1280 px, teclado e estados carregando/sucesso/503/erro.
Conferir manualmente o foco visível e a ausência de rolagem horizontal em 360 px.
