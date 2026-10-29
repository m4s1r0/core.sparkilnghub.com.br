# UI Contracts: F08-Core — Auditoria, utilização e painel do Core

**Branch**: `005-f08-core-auditoria-utilizacao` | **Date**: 2026-10-28  
**Design System**: `@sparkling-hub/design-system` → atualizar de **0.2.0 → 0.2.1** (primeira tarefa da fatia; API preservada)

---

## Visão geral das telas novas/modificadas

| Tela | Rota | Ação | US |
|------|------|------|----|
| Painel (Dashboard) | `/` | Expandir métricas de utilização e saúde de telemetria | US2 |
| Acessos e segurança | `/acessos` | Nova tela | US3 |
| Auditoria administrativa | `/auditoria` | Nova tela | US4 |
| Utilização da instância | `/instancias/:id` → aba Utilização | Nova aba na página da instância | US5 |
| Utilização consolidada | `/utilizacao` | Nova tela | US5 |

---

## 1. Painel expandido — `/` (US2, SC-038, SC-039)

### Seção existente preservada

A seção atual de contagem de instâncias por estado (cards com `StatsBlock`) é preservada e expandida com novos indicadores.

### Novos indicadores a adicionar

```
StatsBlock (seção: "Provisionamento")
  ├── "Pendentes"   → pendingProvisionings      (tone: pendingProvisionings > 0 ? 'warning' : 'neutral')
  └── "Com falha"   → failedProvisionings        (tone: failedProvisionings > 0 ? 'error' : 'neutral')

StatsBlock (seção: "Utilização — últimos 7 dias")
  ├── "Sem dados (7d)"  → instancesWithoutRecentUsage.last7d   (tone: > 0 ? 'warning' : 'success')
  ├── "Sem dados (30d)" → instancesWithoutRecentUsage.last30d  (tone: > 0 ? 'warning' : 'success')
  └── "Sem histórico"   → instancesWithoutAnyData              (tone: > 0 ? 'warning' : 'neutral')

StatsBlock (seção: "Telemetria")
  ├── "Com atraso"  → instancesWithTelemetryDelay  (tone: > 0 ? 'warning' : 'success')
  └── "Schema desatualizado" → instancesWithSchemaIssue (tone: > 0 ? 'warning' : 'success')

Text muted (rodapé)
  → "Calculado em: <calculatedAt formatado pt-BR>"
```

### Dados

- Endpoint: `GET /api/v1/dashboard/stats`
- Hook React Query: `useDashboardStats()`
- Skeleton: `<Skeleton label="Carregando painel" lines={4} />` durante fetch

---

## 2. Acessos e segurança — `/acessos` (US3, SC-032, SC-033, SC-035, SC-041)

### Layout

```
Heading level={1}: "Acessos e segurança"

[Filtros — inline form]
  Select "Resultado"   → sucesso | falha | negado | (todos)
  Input  "Instância"   → UUID ou slug
  Input  "Conta"       → UUID
  DateRangePicker      → from / to
  Button "Filtrar"
  Button "Exportar CSV" (secondary) → href com Accept: text/csv

DataTable colunas:
  | # | Data/hora         | Tipo          | Ator (kind) | Instância | Resultado |
  |---|-------------------|---------------|-------------|-----------|-----------|
  | → | created_at pt-BR  | type          | actor_kind  | instance_id (link) | Badge tone |

Pagination: Page / PageSize (50 por padrão; max 100)
```

### Componentes design system

| Elemento | Componente DS |
|----------|--------------|
| Tabela de eventos | `DataTable` com `TableColumn[]` |
| Badge de resultado | `Badge` (sucesso→success, falha→error, negado→warning) |
| Paginação | `Pagination` |
| Carregamento | `Skeleton label="Carregando acessos" lines={6}` |
| Erro | `Alert tone="error"` |

### Nota sobre IP/agente

A coluna `ip` pode exibir `—` quando `null` (evento com mais de 180 dias ou nunca capturado).
A UI não oferece forma de editar ou excluir eventos (SC-035).

### Exportação CSV

- Botão "Exportar CSV" chama `GET /api/v1/security-events?...&format=csv` com `Accept: text/csv`.
- Trigger de download via `<a download>` gerado pelo `href` da resposta ou via `Blob` + `URL.createObjectURL`.
- Nome do arquivo sugerido: `acessos-YYYY-MM-DD.csv`.
- Limite visível na UI: aviso "Exportação limitada a 10.000 linhas. Refine os filtros para exportar um período menor" quando a API retornar header `X-Truncated: true`.

---

## 3. Auditoria administrativa — `/auditoria` (US4, SC-034, SC-035, SC-041)

### Layout

```
Heading level={1}: "Auditoria administrativa"

[Filtros — inline form]
  Input  "Entidade"  → object_type
  Input  "ID"        → object_id
  Input  "Usuário"   → actor_id UUID
  Input  "Ação"      → action (texto livre)
  DateRangePicker    → from / to
  Button "Filtrar"
  Button "Exportar CSV" (secondary)

DataTable colunas:
  | Data/hora         | Ação         | Entidade      | ID da entidade | Ator          |
  |-------------------|--------------|---------------|----------------|---------------|
  | created_at pt-BR  | action       | object_type   | object_id      | actor_kind/id |

  Expandível: clicar na linha abre painel lateral (Drawer ou seção inline) com `changes` JSON formatado e `reason`
```

### Componentes design system

| Elemento | Componente DS |
|----------|--------------|
| Tabela | `DataTable` |
| Detalhes expandidos | `Drawer` (0.2.1: transições melhoradas) |
| Carregamento | `Skeleton` |
| Erro | `Alert tone="error"` |

### Exportação CSV

Idêntica à tela de acessos. Nome do arquivo: `auditoria-YYYY-MM-DD.csv`.

---

## 4. Utilização por instância — aba na `/instancias/:id` (US5, SC-036, SC-040)

### Integração na página existente

A página da instância ([InstancePage.tsx](web/src/pages/instances/InstancePage.tsx)) já usa `Tabs`. A nova aba "Utilização" é inserida como último item.

```
<Tabs>
  <Tab label="Resumo">    ...existing...  </Tab>
  <Tab label="Saúde">     ...existing...  </Tab>
  <Tab label="Migração">  ...existing...  </Tab>
  <Tab label="Utilização"> ← NOVO
    DateRangePicker (from/to padrão: últimos 30 dias)
    Button "Aplicar"

    [por kind de evento]
    StatsBlock: "Atendimentos iniciados", "Atendimentos concluídos",
                "Vendas confirmadas", "Usuários ativos"

    Text muted: "Dados de ocorrência (não de recebimento)"

    [data_status]
    Alert tone="warning" quando data_status == 'dados_insuficientes'  → "Nenhum evento no período."
    Alert tone="warning" quando data_status == 'atraso_detectado'     → "Telemetria com atraso detectado."
  </Tab>
</Tabs>
```

### Nota sobre Tabs 0.2.1

O design system 0.2.1 adiciona indicador contínuo de aba ativa (animação com tokens de 120/160ms). Nenhuma mudança de código necessária — basta atualizar o pacote.

---

## 5. Utilização consolidada — `/utilizacao` (US5, SC-036, SC-040, SC-041)

### Layout

```
Heading level={1}: "Utilização"

[Filtros]
  DateRangePicker (from/to)
  Select "Instância" (opcional, filtra por instance_id)
  Select "Fuso horário" (padrão: America/Sao_Paulo)
  Button "Aplicar"
  Button "Exportar CSV" (secondary)

DataTable colunas:
  | Instância | Período | Atend. iniciados | Atend. concluídos | Vendas | Usuários ativos | Status |
  |-----------|---------|-----------------|-------------------|--------|-----------------|--------|

  Badge de status:
    ok               → Badge tone="success"  "OK"
    dados_insuficientes → Badge tone="neutral"  "Sem dados"
    atraso_detectado → Badge tone="warning"  "Atraso"
```

### Exportação CSV

Nome do arquivo: `utilizacao-YYYY-MM-DD.csv`.

---

## Roteamento (web/src/App.tsx ou equivalente)

Novas rotas a adicionar no roteador principal:

```tsx
<Route path="/acessos"    element={<SecurityEventsPage />} />
<Route path="/auditoria"  element={<AuditEventsPage />} />
<Route path="/utilizacao" element={<UsagePage />} />
```

A rota `/instancias/:id` já existe; a aba Utilização é adicionada internamente.

---

## Navegação (Sidebar)

Adicionar no menu lateral ([sidebar](web/src/components/layout/)) os novos itens:

| Ícone sugerido | Label | Rota |
|----------------|-------|------|
| `shield` ou `lock` | Acessos | `/acessos` |
| `clipboard` | Auditoria | `/auditoria` |
| `bar-chart` | Utilização | `/utilizacao` |

Posição: após "Instâncias", antes de "Sistema".

---

## Notas sobre o design system 0.2.1

- Atualizar `web/package.json`: `"@sparkling-hub/design-system": "file:../vendor/design-system/sparkling-hub-design-system-0.2.1.tgz"`
- API de componentes 100% preservada em relação a 0.2.0 (CHANGELOG confirma).
- Novidades relevantes para F08-Core: indicador contínuo de aba (automático ao atualizar), tokens de movimento (`--motion-duration-*`), transições melhoradas em `Dialog` e `Drawer`.
- Após atualizar: `npm install` no `web/` e executar suite de componentes (`npm run test` ou `npm run verify`).
