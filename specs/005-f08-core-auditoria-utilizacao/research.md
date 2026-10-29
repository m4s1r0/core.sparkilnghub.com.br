# Research: F08-Core — Auditoria, utilização e painel do Core

**Branch**: `005-f08-core-auditoria-utilizacao` | **Date**: 2026-10-28

## R-01: Deduplicação de eventos de utilização

**Decisão**: `UNIQUE KEY (instance_id, event_id)` em `instance_usage_event` com `INSERT IGNORE`.
Um `batch_id` único por instância (`UNIQUE KEY (instance_id, batch_id)`) em `instance_usage_batch`
cobre a repetição de lote inteiro sem varrer a tabela de eventos.

**Rationale**: `INSERT IGNORE` no MySQL descarta duplicatas silenciosamente sem lançar exceção;
a query de contagem de linhas afetadas (`affectedRows`) distingue "aceito" de "ignorado".
Adequado para volumes de MVP; escala em lotes com `INSERT IGNORE INTO ... VALUES (...), (...)`.

**Alternativas consideradas**: `ON DUPLICATE KEY UPDATE` (seria necessário para atualizar campos,
mas eventos de utilização são imutáveis); `SELECT + INSERT` em transação (sofre de TOCTOU sob
concorrência, sem vantagem sobre o UNIQUE KEY).

---

## R-02: Autenticação do endpoint de recepção de utilização

**Decisão**: Adicionar escopo `'utilizacao'` ao `SET` em `app_credential.scopes`
(migração 0006 de `spark_core`). O endpoint `/internal/v1/instances/{id}/usage-batches` exige
`utilizacao` na credencial apresentada, verificando que a credencial pertence à instância do path.

**Rationale**: Reutilizar o escopo `connection` conflatiria duas capacidades distintas (obter
credenciais de banco × publicar telemetria). O princípio do menor privilégio (constituição VII)
requer escopos separados. Uma credencial de utilização pode ser emitida para um processo separado
(o produtor de outbox) sem expor o acesso ao banco da instância.

**Alternativas consideradas**: Escopo `connection` reutilizado (privilegia simplicidade, viola
mínimo privilégio); token dedicado via endpoint novo (mais granular, mas acrescenta complexidade
sem ganho no MVP).

---

## R-03: Limpeza periódica de IP e agente

**Decisão**: Worker periódico (`cleanIpRetention`) executado diariamente via o loop do trabalhador
de tarefas existente, processando `UPDATE security_event SET ip = NULL, user_agent = NULL WHERE
created_at < DATE_SUB(NOW(), INTERVAL 180 DAY) AND (ip IS NOT NULL OR user_agent IS NOT NULL)
LIMIT 1000`. Itera até `affectedRows = 0`.

**Rationale**: `ip` e `user_agent` já são `NULL`able na tabela (F01); não há alteração de schema.
Limitar a 1000 linhas por rodada evita lock contention. Idempotência natural: `WHERE ip IS NOT
NULL OR user_agent IS NOT NULL` nunca retoca registros já limpos. A frequência diária satisfaz
SC-033 sem infra extra; a data de corte de 180 dias é computada no momento da execução.

**Alternativas consideradas**: Cron externo (dependência de infraestrutura fora do MVP);
DELETE-e-archive (remove o evento, violando SC-035); trigger MySQL (não auditável pela aplicação).

---

## R-04: Índice em security_event por instance_id

**Decisão**: Adicionar `KEY security_event_instance (instance_id, created_at)` em migração
da `spark_identity` (versão 5 → 0005_auditoria_index.sql).

**Rationale**: As telas de consulta filtram por instância + intervalo de datas; sem índice a query
faz full scan em toda a tabela de eventos de segurança. O índice composto `(instance_id,
created_at)` cobre a maioria dos filtros da tela. Migração não-destrutiva (só ADD INDEX).

**Alternativas consideradas**: Índice só em `instance_id` (menos seletivo); filtrar por
`type` e depois por instância (requer índice diferente, só vale se houver filtro de tipo obrigatório).

---

## R-05: Paginação de listas de auditoria e acessos

**Decisão**: Paginação por offset/limit com cursor opcional (`after_id` = UUID do último item)
para exportação contínua. Tamanho de página padrão: 50 itens. Exportação CSV limitada a
10.000 linhas por arquivo no MVP; acima disso, a API orienta a refinar filtros.

**Rationale**: Volumes de MVP (centenas a poucos milhares de eventos por instância) não exigem
cursor keyset para performance aceitável. O `after_id` opcional cobre a exportação iterativa
sem reordenar o offset toda vez que uma linha é inserida. Limite de 10.000 linhas por arquivo
mantém a geração síncrona (< 2s para CSV) sem streaming assíncrono.

**Alternativas consideradas**: Keyset apenas (mais eficiente, mais complexo, desnecessário no
MVP); streaming assíncrono + polling (complexidade de filas sem ganho no MVP).

---

## R-06: Atualização do design system para 0.2.1

**Decisão**: Atualizar `@sparkling-hub/design-system` de 0.2.0 para 0.2.1 **ao início de
F08-Core**, como primeira tarefa da fatia, antes de qualquer tela nova.

**Rationale**: O usuário informou alterações de layout em contexto paralelo; o CHANGELOG de
0.2.1 confirma "API pública preservada" — atualização segura sem código de adaptação. A versão
0.2.1 traz: indicador de abas contínuo (relevante para as abas de auditoria/utilização), tokens
de movimento e transições melhoradas de Dialog (relevante para o Dialog de confirmação de
exportação). Registrar a versão anterior (0.2.0) e nova (0.2.1) conforme constituição VIII.
Reexecutar testes de componente após a atualização.

**Alternativas consideradas**: Manter 0.2.0 (perde os melhoramentos de tab indicator e Dialog,
cria divergência em relação ao design system atual); atualizar em fatia separada (desnecessário
— 0.2.1 é compatível e F08-Core introduz telas que se beneficiam das melhorias).

---

## R-07: Novos endpoints e módulo de utilização

**Decisão**: Criar o módulo `server/src/modules/utilization/` com as rotas internas e
administrativas de F08-Core; ampliar o módulo `server/src/modules/access-projection/` ou
criar `server/src/modules/audit/` para as rotas de auditoria e acessos de segurança.

As rotas novas são:
- `POST /internal/v1/instances/:instanceId/usage-batches` (módulo utilization)
- `GET /api/v1/instances/:instanceId/usage` (módulo utilization)
- `GET /api/v1/usage` consolidado (módulo utilization)
- `GET /api/v1/security-events` (módulo audit)
- `GET /api/v1/audit-events` (módulo audit)
- `GET /api/v1/dashboard/stats` ampliado com métricas de utilização (módulo existente ou novo)
- Rotas de exportação CSV derivadas das consultas acima com `?format=csv`

**Rationale**: Separar utilização (responsabilidade nova) de auditoria (leitura de tabelas
já existentes) em módulos distintos respeita a convenção um-módulo-por-assunto do projeto.
Exportação CSV como parâmetro `?format=csv` reutiliza a mesma handler e filtros em vez de
duplicar lógica em rotas separadas.

**Alternativas consideradas**: Tudo em `instances/` (acoplamento excessivo); rotas de exportação
separadas (duplicação de filtros e autorização).

---

## R-08: Métricas do painel expandido

**Decisão**: Novo endpoint `GET /api/v1/dashboard/stats` retornando:
```
{
  instancesByState: Record<InstanceState, number>,
  pendingProvisionings: number,
  failedProvisionings: number,
  instancesWithoutRecentUsage: { last7d: number, last30d: number },
  instancesWithTelemetryDelay: number,      // received_at - max occurred_at > limiar
  instancesWithSchemaIssue: number,
  lastUpdatedAt: string                      // instante de cálculo
}
```
As contagens são calculadas em tempo real sem cache para MVP; tempo de resposta alvo < 500ms.

**Rationale**: Mantém o endpoint de `system/status` focado em disponibilidade técnica;
o novo `dashboard/stats` agrega estado operacional e de utilização. A contagem em tempo real
é aceitável no MVP (poucas dezenas de instâncias); cache pode ser adicionado em fatia futura
sem alterar o contrato.

**Alternativas consideradas**: Ampliar `/api/v1/system/status` (mistura saúde técnica com
métricas operacionais); endpoint dedicado por tipo de métrica (proliferação de rotas).

---

## R-09: Neutralização de fórmulas em CSV

**Decisão**: Prefixar com `'` (aspa simples) qualquer célula cujo valor começa com `=`, `+`,
`-` ou `@` antes de escrever no CSV. O cabeçalho nunca começa com esses caracteres.

**Rationale**: Padrão OWASP para prevenção de CSV Injection; suportado por Excel, LibreOffice e
Google Sheets. A aspa simples é interpretada como indicador de texto pela maioria das planilhas,
tornando o conteúdo inofensivo. (SC-041)

**Alternativas consideradas**: Remover os caracteres (altera dados); envolver em aspas duplas
(não impede `="CMD"` que ainda executa em algumas versões do Excel).

---

## R-10: Retenção e política de dados de auditoria

**Decisão**: Sem deleção automática de `security_event` ou `core_audit_event` no MVP. Política
de retenção é definida pelo operador diretamente no banco (PR-003 do plano-sdd); a interface
não oferece exclusão. A limpeza de `ip`/`user_agent` (R-03) não é uma política de retenção — é
apagar campos dentro de um evento preservado.

**Rationale**: SC-035 proíbe edição/exclusão pela interface; a decisão de quando arquivar ou
expurgar eventos compete ao operador e à política de privacidade, não ao MVP (SC-033 cobre
apenas IP/agente). Registrar essa limitação em `evidence.md` ao final da fatia.

**Alternativas consideradas**: TTL automático via `EVENT` do MySQL (executável sem decisão de
operação, mas cria comportamento invisible à auditoria da aplicação).
