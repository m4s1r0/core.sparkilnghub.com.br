# Quickstart: F08-Core — Auditoria, utilização e painel do Core

**Branch**: `005-f08-core-auditoria-utilizacao` | **Date**: 2026-10-28

Este guia descreve como validar cada User Story da fatia de forma end-to-end após a implementação.
Não repete implementação — aponta para os artefatos de contrato e modelo de dados.

---

## Pré-requisitos

| Item | Requisito |
|------|-----------|
| Branch | `005-f08-core-auditoria-utilizacao` |
| Node | ≥ 20 |
| MySQL | spark_core @ v6, spark_identity @ v5 (migrações 0006 e 0005 aplicadas) |
| Design system | `@sparkling-hub/design-system` 0.2.1 instalado no `web/` |
| Produto de referência | produto-referencia.sparklinghub.com.br disponível e com credencial emitida com escopo `utilizacao` |

### Subir o ambiente

```bash
# Terminal 1 — server
cd server && npm run dev

# Terminal 2 — worker
cd server && npm run worker

# Terminal 3 — web
cd web && npm run dev
```

Verificar saúde: `GET http://localhost:3000/health` deve retornar `200`.

---

## US1 — Receber e deduplicar lotes de utilização

**Contrato**: [openapi-f08.yaml](./openapi-f08.yaml) — `POST /internal/v1/instances/{instanceId}/usage-batches`

### Cenário 1: lote novo aceito

```bash
curl -s -X POST http://localhost:3000/internal/v1/instances/<INSTANCE_ID>/usage-batches \
  -H "Authorization: Bearer <CRED_ID>:<SECRET em base64>" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "aaaaaaaa-0001-0001-0001-aaaaaaaaaaaa",
    "events": [
      { "event_id": "evt-0001", "occurred_at": "2026-10-28T10:00:00Z", "kind": "atendimentos_iniciados", "count": 5 },
      { "event_id": "evt-0002", "occurred_at": "2026-10-28T10:00:00Z", "kind": "vendas_confirmadas", "count": 3 }
    ]
  }'
```

**Esperado**: `202 Accepted` com `{ "events_accepted": 2, "events_discarded": 0 }`.

### Cenário 2: reenvio do mesmo lote (idempotência de lote)

Reenviar o mesmo `curl` acima.

**Esperado**: `200 OK` com resultado original `{ "events_accepted": 2, "events_discarded": 0 }`. Sem duplicação em `instance_usage_event`.

### Cenário 3: evento duplicado dentro de lote novo

```bash
# Enviar lote com batch_id diferente, mas mesmo evt-0001
curl ... -d '{ "batch_id": "aaaaaaaa-0002-...", "events": [{ "event_id": "evt-0001", ... }] }'
```

**Esperado**: `202 Accepted` com `{ "events_accepted": 0, "events_discarded": 1 }`. A linha `evt-0001` em `instance_usage_event` não é duplicada.

### Cenário 4: credencial de outra instância (CA-SC-011)

Apresentar credencial de instância B ao path de instância A.

**Esperado**: `403 Forbidden`.

### Cenário 5: instância não ativa

Instância em estado `SUSPENSA`.

**Esperado**: `409 Conflict` com `code: CONFLICT_STATE`.

---

## US2 — Painel de estado expandido

**Contrato**: [openapi-f08.yaml](./openapi-f08.yaml) — `GET /api/v1/dashboard/stats`

### Verificação de API

```bash
curl -s http://localhost:3000/api/v1/dashboard/stats \
  -H "Cookie: sh_core_session=<SESSION>"
```

**Esperado**: JSON com todos os campos de `DashboardStats` (ver schema no contrato).  
Verificar que `instances_by_state` lista todos os estados presentes no sistema.

### Verificação na UI

1. Abrir `http://localhost:5173/` com sessão administrativa ativa.
2. Os novos cards de provisionamento, utilização (7d/30d), sem histórico, atraso de telemetria e schema devem aparecer.
3. Após enviar um lote (US1), o contador "Sem histórico" da instância correspondente deve zerar.

---

## US3 — Consulta e exportação de acessos e segurança

**Contrato**: [openapi-f08.yaml](./openapi-f08.yaml) — `GET /api/v1/security-events`

### Cenário: listagem paginada

```bash
curl -s "http://localhost:3000/api/v1/security-events?page=1&page_size=10" \
  -H "Cookie: sh_core_session=<SESSION>"
```

**Esperado**: JSON com `items`, `total`, `page`, `page_size`.

### Cenário: filtro por instância

```bash
curl -s "http://localhost:3000/api/v1/security-events?instance_id=<ID>&result=falha" ...
```

**Esperado**: somente eventos da instância e resultado filtrando corretamente.

### Cenário: exportação CSV

```bash
curl -s "http://localhost:3000/api/v1/security-events?from=2026-01-01T00:00:00Z" \
  -H "Accept: text/csv" \
  -H "Cookie: sh_core_session=<SESSION>" \
  -o acessos.csv
```

**Esperado**: arquivo CSV com cabeçalho, linha de geração e filtros; células com `=`/`+`/`-`/`@` prefixadas com `'`.

### Verificação na UI

Abrir `/acessos`, filtrar por resultado "falha", verificar tabela e badge de resultado.

---

## US4 — Consulta e exportação de auditoria administrativa

**Contrato**: [openapi-f08.yaml](./openapi-f08.yaml) — `GET /api/v1/audit-events`

### Cenário: listar ações de um objeto

```bash
curl -s "http://localhost:3000/api/v1/audit-events?object_type=Instance&object_id=<ID>" \
  -H "Cookie: sh_core_session=<SESSION>"
```

**Esperado**: eventos de auditoria para a instância.

### Cenário: exportação CSV

```bash
curl -s "http://localhost:3000/api/v1/audit-events" \
  -H "Accept: text/csv" -H "Cookie: ..." -o auditoria.csv
```

**Esperado**: CSV bem formado, sem fórmulas não neutralizadas.

### Verificação na UI

Abrir `/auditoria`, expandir uma linha; o `Drawer` deve mostrar `changes` formatado e `reason`.

---

## US5 — Relatórios de utilização

**Contrato**: [openapi-f08.yaml](./openapi-f08.yaml) — `GET /api/v1/instances/{instanceId}/usage` e `GET /api/v1/usage`

### Cenário: relatório por instância

```bash
curl -s "http://localhost:3000/api/v1/instances/<ID>/usage?from=2026-10-01&to=2026-10-28" \
  -H "Cookie: sh_core_session=<SESSION>"
```

**Esperado**: JSON com `events` por `kind`, `data_status: ok`.

### Cenário: instância sem dados (CA-SC-012)

```bash
curl -s "http://localhost:3000/api/v1/instances/<ID_SEM_USO>/usage?from=2026-10-01&to=2026-10-28" ...
```

**Esperado**: `data_status: dados_insuficientes`, `events: []`.

### Verificação na UI

1. Abrir `/instancias/<ID>`, ir à aba "Utilização".
2. Selecionar período com dados → `StatsBlock` exibe contagens corretas.
3. Selecionar período sem dados → `Alert` "Nenhum evento no período." aparece.
4. Abrir `/utilizacao`, filtrar por instância e exportar CSV.

---

## US6 — Limpeza de IP e agente

**Mecanismo**: worker periódico; não tem endpoint HTTP.

### Verificação direta no banco (spark_identity)

```sql
-- Inserir evento antigo (> 180 dias) com ip preenchido
INSERT INTO security_event (id, type, actor_kind, result, ip, user_agent, created_at)
  VALUES (UNHEX(REPLACE(UUID(),'-','')), 'login_ok', 'usuario', 'sucesso',
          '127.0.0.1', 'TestAgent/1.0',
          DATE_SUB(NOW(), INTERVAL 181 DAY));

-- Executar worker manualmente (ou aguardar ciclo diário)
-- Verificar limpeza
SELECT ip, user_agent FROM security_event WHERE created_at < DATE_SUB(NOW(), INTERVAL 180 DAY);
-- Esperado: ip IS NULL AND user_agent IS NULL; outros campos intactos.
```

### Verificação no painel (US2)

O campo `cleanup_last_run` em `GET /api/v1/dashboard/stats` deve refletir o instante da última execução bem-sucedida.

---

## Checklist final de validação

- [ ] US1: lote aceito (`202`), reenvio idempotente (`200`), duplicata descartada, credencial errada (`403`), instância inativa (`409`)
- [ ] US2: `GET /api/v1/dashboard/stats` retorna todos os campos; UI exibe novos indicadores
- [ ] US3: listagem com filtros funciona; CSV gerado sem fórmulas injetáveis; IP aparece `null` em evento > 180 dias
- [ ] US4: listagem com filtros funciona; Drawer abre com `changes` e `reason`; CSV correto
- [ ] US5: relatório por instância e consolidado corretos; `data_status: dados_insuficientes` em instância sem dados; exportação CSV com nome sugerido
- [ ] US6: worker limpa `ip`/`user_agent` de eventos > 180 dias sem apagar o evento; `cleanup_last_run` atualizado no painel
- [ ] Design system 0.2.1: indicador contínuo de aba visível; sem regressões visuais
- [ ] `npm run verify` verde (16/16)
