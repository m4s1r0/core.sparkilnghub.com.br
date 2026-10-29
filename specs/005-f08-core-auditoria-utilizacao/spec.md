# Feature Specification: F08-Core — Auditoria, utilização e painel do Core

**Feature Branch**: `005-f08-core-auditoria-utilizacao`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "F08-Core — Auditoria, utilização e painel do Core"

**Rastreabilidade**: `SC-032` a `SC-041`; `SP-098`; `NFR-010`, `NFR-014`; aceites `CA-SC-011`,
`CA-SC-012`; cenário `T-14` (telemetria repetida, atrasada ou indisponível); decisões `D-01`
(confirmada) e `D-02` (confirmada); constituição v1.2.1, princípios I, II, III, IV, V, VI, VII e
VIII. Critérios de sucesso usam o prefixo `CS-` continuando a numeração de F03 (CS-020+).

## Contexto e limites

F03 conclui o ciclo operacional da instância: ativação, suspensão, manutenção, saúde, backup e
encerramento. Desde F01 e F02 os eventos de segurança (`security_event`) e os eventos de auditoria
administrativa (`core_audit_event`) são gravados a cada ação relevante, mas ainda não há tela de
consulta, exportação nem mecanismo de limpeza dos campos de privacidade.

F08-Core entrega quatro coisas complementares:

1. **Recepção de utilização** — o endpoint que o produto envia lotes de uso (outbox), com
   deduplicação por `event_id` e confronto da instância contra a credencial emissora. Verificado
   com o produtor do produto de referência, cobrindo repetição, atraso, lacuna e indisponibilidade
   (T-14), sem esperar o Tuteli.

2. **Painel de estado expandido** — o painel administrativo existente ganha as métricas de
   utilização, versão e saúde de telemetria exigidas por `SC-038`/`SC-039`, tornando o estado
   operacional do Core totalmente visível numa única tela.

3. **Consulta e exportação de acessos e auditoria** — o administrador filtra e exporta eventos de
   segurança (`SC-032`) e eventos de auditoria administrativa (`SC-034`), com paginação, CSV e
   neutralização de fórmulas.

4. **Limpeza automática de IP e agente** — trabalhador que apaga os campos `ip_address` e
   `user_agent` de `security_event` após 180 dias, mantendo o evento (`SC-033`).

Atores:

- **Administrador da plataforma** — único papel do painel Core (`SC-001`); consulta e exporta
  eventos; dispara verificações e lê o painel.
- **Produto (Tuteli ou produto de referência)** — publica lotes de utilização ao Core via
  credencial de instância.
- **Trabalhador técnico** — executa a limpeza de IP/agente e o worker de recepção de utilização;
  identidade de sistema, sem perfil de usuário.

**Fora de F08-Core**: auditoria per-instância do Tuteli (`SP-096` — Tuteli grava e gerencia
seus próprios eventos operacionais); relatórios locais por instância e dashboards do Tuteli
(`F09`); exportação de dados operacionais do pet shop; rotação de credencial operacional;
infraestrutura de monitoramento/alertas externa (Prometheus, OpenTelemetry); faturamento SaaS;
transferência de instância entre contratantes (`RN-SC-005`); reabertura ou exclusão de instância
`ENCERRADA`; telas e código do Tuteli.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receber e deduplicar lotes de utilização (Priority: P1) 🎯 MVP

O produto publica um lote de eventos de uso ao Core via um endpoint interno autenticado pela
credencial de instância. O Core valida a origem, grava os eventos novos e descarta duplicatas sem
alterar contagens já registradas. Se o endpoint estiver indisponível, a autorização de acesso ao
produto continua funcionando normalmente.

**Why this priority**: é o contrato que o SparkCore oferece ao Tuteli (`SP-098`); sem ele, o
Core não pode ser declarado finalizado (constituição, "SparkCore primeiro"). Precisa ser provado
com o produto de referência antes de aguardar qualquer fatia do Tuteli.

**Independent Test**: com o produto de referência publicando um lote; confirmar eventos gravados,
contagens corretas e deduplicação em relote; depois suspender o endpoint e confirmar que o
produto continua autorizando sessões abertas.

**Acceptance Scenarios**:

1. **Given** uma instância `ATIVA` com credencial operacional válida, **When** o produto envia
   `POST /internal/v1/instances/{id}/usage-batches` com `batch_id` e lista de eventos, **Then**
   os eventos novos são gravados com `occurred_at` do evento e `received_at` atual, e o servidor
   devolve `202 Accepted` com a contagem de eventos aceitos e descartados (`SC-037`, `SC-040`,
   `CA-SC-011`).
2. **Given** um lote idêntico já processado, **When** o produto reenvia com o mesmo `batch_id` e
   os mesmos `event_id`s, **Then** o servidor devolve `200 OK` com resultado original e nenhuma
   contagem é incrementada (`CA-SC-011`).
3. **Given** um lote com alguns `event_id`s já processados e outros novos, **When** o produto
   envia o lote parcialmente novo, **Then** só os eventos novos são gravados; os duplicados são
   descartados silenciosamente (`CA-SC-011`).
4. **Given** um lote com `occurred_at` de 3 dias atrás, **When** o produto publica com atraso,
   **Then** os eventos são gravados com o `occurred_at` original do evento, não a data de
   recebimento, e o painel sinaliza atraso de telemetria (`SC-040`, `CA-SC-011`).
5. **Given** o endpoint de recepção de utilização indisponível, **When** o produto tenta publicar,
   **Then** recebe erro temporário (`503`); entretanto, a validação de sessão do produto na
   projeção de acesso continua funcionando sem interrupção (`T-14`).
6. **Given** um lote para a instância `B` enviado com a credencial da instância `A`, **When**
   o Core recebe, **Then** recusa com `403`, sem revelar dados de `B` (constituição I).
7. **Given** uma instância `SUSPENSA` ou `ENCERRADA`, **When** o produto tenta publicar um lote,
   **Then** o Core recusa com código estável indicando estado inválido (`SC-037`).

---

### User Story 2 - Painel de estado expandido com utilização (Priority: P1)

O administrador abre o painel e vê numa única tela o estado operacional completo: instâncias por
estado, provisionamentos em curso ou com falha, instâncias sem uso recente, atraso de telemetria,
versões incompatíveis e falhas técnicas (`SC-038`, `SC-039`).

**Why this priority**: o painel atual (F02/F03) já tem estado das instâncias; adicionar a camada
de utilização fecha o quadro operacional que SC-038 exige e é o requisito de visibilidade mais
diretamente ligado à operação diária.

**Independent Test**: com instâncias em estados variados e lotes de utilização com datas distintas,
abrir o painel e conferir cada métrica; inserir um lote com data de ocorrência muito antiga e
verificar que o campo "atraso de telemetria" reflete o atraso; confirmar que instância sem nenhum
evento de uso aparece como "dados insuficientes" (`CA-SC-012`).

**Acceptance Scenarios**:

1. **Given** o painel carregado, **When** o administrador visualiza, **Then** vê contagem por
   estado (`ATIVA`, `SUSPENSA`, `MANUTENCAO`, `ENCERRADA`, `PRONTA`), provisionamentos pendentes e
   falhos, instâncias sem evento de uso elegível nos últimos 7 e 30 dias, instâncias com atraso
   de telemetria acima do limiar configurado e instâncias com `schema_version` diferente da versão
   vigente (`SC-038`).
2. **Given** uma instância sem nenhum evento de uso registrado, **When** o painel exibe a métrica
   "instâncias sem uso", **Then** essa instância aparece como "dados insuficientes", não como "sem
   utilização" (`CA-SC-012`).
3. **Given** instâncias com dados de utilização, **When** o painel exibe "saúde de utilização",
   **Then** informa o último lote recebido, o atraso em relação ao evento mais recente e, se
   detectar lacuna, sinaliza explicitamente (`SC-039`).
4. **Given** o painel carregado, **When** qualquer métrica de utilização não tem dados suficientes,
   **Then** a tela informa o período e horário de atualização de cada indicador (`SC-039`).

---

### User Story 3 - Consultar e exportar acessos de segurança (Priority: P2)

O administrador filtra eventos de segurança por produto, instância, usuário, data e resultado, e
exporta o resultado filtrado em CSV com cabeçalho de significado.

**Why this priority**: SC-032/SC-034 e SC-041; acesso a auditoria de segurança é requisito de
operação. Depende dos dados já gravados em F01; F08-Core entrega a tela de consulta e a exportação.

**Independent Test**: filtrar por instância e data; confirmar paginação; exportar CSV e verificar
cabeçalho, neutralização de fórmulas e ausência de campos sensíveis; tentar filtrar por instância
de outro produto sem permissão e confirmar recusa.

**Acceptance Scenarios**:

1. **Given** o administrador acessa a tela de acessos, **When** aplica filtros (produto, instância,
   usuário, data de início/fim, resultado), **Then** vê lista paginada de eventos com tipo, ator,
   instância, resultado e instante; eventos de outra plataforma ou produto não aparecem (`SC-032`).
2. **Given** a lista filtrada, **When** o administrador solicita exportação CSV, **Then** recebe
   arquivo com cabeçalho de significado, linha de geração, filtros aplicados, cada campo com
   conteúdo seguro (sem senha, token, stack trace ou SQL) e conteúdo de célula que começa com `=`,
   `+`, `-` ou `@` neutralizado (`SC-041`).
3. **Given** evento de segurança com IP e agente do navegador com menos de 180 dias, **When**
   o administrador consulta, **Then** vê IP e agente do navegador presentes. **Given** o mesmo
   evento com mais de 180 dias (após limpeza), **When** consulta, **Then** esses campos aparecem
   como ausentes, sem remover o evento (`SC-033`).
4. **Given** evento de auditoria, **When** o administrador tenta editá-lo ou excluí-lo pela
   interface, **Then** não existe esse controle; nenhuma rota de edição/exclusão existe para esses
   registros (`SC-035`).

---

### User Story 4 - Consultar e exportar auditoria administrativa (Priority: P2)

O administrador filtra eventos de auditoria administrativa (`core_audit_event`) por entidade
(contratante, instância, usuário, vínculo, provisionamento, suspensão), ator, data e ação, e
exporta em CSV.

**Why this priority**: SC-034/SC-041; fechamento da auditoria administrativa iniciada em F02/F03.
Dados já existem; F08-Core entrega a superfície de consulta e exportação.

**Independent Test**: criar uma transição de instância e uma ação de vínculo em F02/F03; filtrar
por entidade e data; exportar CSV; confirmar que campos antes/depois seguros estão presentes e
sem dados operacionais do pet shop (`SC-034`).

**Acceptance Scenarios**:

1. **Given** o administrador acessa a tela de auditoria administrativa, **When** filtra por entidade,
   ator e intervalo de datas, **Then** vê lista paginada com ator, ação, entidade afetada, valores
   anterior/novo seguros, correlação e instante; campos sensíveis (senha, token, conteúdo
   operacional do Tuteli) não aparecem (`SC-034`, `CA-SC-010`).
2. **Given** a lista filtrada, **When** exporta CSV, **Then** o arquivo segue as mesmas regras de
   SC-041 (cabeçalho, geração, neutralização de fórmulas, sem segredos).
3. **Given** conta de ator inativada depois de um evento, **When** o administrador consulta o
   evento, **Then** o ator é identificado pelo valor gravado no momento do evento, sem depender
   da conta estar ativa (`CA-SC-010`).

---

### User Story 5 - Relatórios de utilização por instância e consolidado (Priority: P2)

O administrador consulta relatórios de uso por instância e consolidado por produto/período, com
filtros, paginação e exportação CSV. Os dados refletem apenas o que chegou via lotes de utilização
(`SC-036`), nunca consultando bancos operacionais do produto.

**Why this priority**: SC-036; encerra a visibilidade de utilização iniciada em US1 e US2 com
uma superfície de consulta histórica filtrável e exportável.

**Independent Test**: publicar lotes para múltiplas instâncias em períodos distintos; consultar
relatório consolidado por produto; filtrar por intervalo de datas; exportar; confirmar que
totais não duplicam após relote; confirmar que período com dados ausentes aparece como "sem dados
suficientes" e não como zero (`CA-SC-012`).

**Acceptance Scenarios**:

1. **Given** lotes de utilização para o período, **When** o administrador consulta o relatório por
   instância com intervalo e fuso explícitos, **Then** vê contagens por tipo de evento e período,
   sem valores financeiros, nomes de tutores, animais ou itens de venda (`SC-036`, `SC-037`,
   `SC-040`).
2. **Given** lote atrasado (ocorrência 3 dias antes do recebimento), **When** o administrador
   consulta o período de ocorrência, **Then** o evento aparece no período correto de ocorrência
   e o período de recebimento permanece disponível para diagnóstico (`SC-040`).
3. **Given** período sem dados de uma instância, **When** o relatório exibe esse período, **Then**
   aparece "sem dados suficientes", não zero (`CA-SC-012`).
4. **Given** exportação CSV do relatório, **When** baixada, **Then** segue SC-041: cabeçalho,
   neutralização de fórmulas, sem dados operacionais do produto.

---

### User Story 6 - Limpeza automática de IP e agente após 180 dias (Priority: P3)

O trabalhador de limpeza apaga os campos `ip_address` e `user_agent` de `security_event` com mais
de 180 dias, mantendo o evento completo. O painel exibe o estado da limpeza como trabalho de
manutenção.

**Why this priority**: SC-033; retenção de IP/agente já documentada como limitação pendente em
F01. Implementação aqui antes de qualquer piloto, conforme a spec de F01.

**Independent Test**: inserir eventos com datas antigas (>180 dias), executar o trabalhador,
confirmar que IP e agente foram apagados, que o evento permanece com todos os outros campos, e
que eventos com menos de 180 dias não foram modificados.

**Acceptance Scenarios**:

1. **Given** eventos de segurança com `created_at` superior a 180 dias, **When** o trabalhador
   executa, **Then** `ip_address` e `user_agent` são definidos como `NULL` naqueles registros; os
   demais campos permanecem intactos (`SC-033`).
2. **Given** eventos com menos de 180 dias, **When** o trabalhador executa, **Then** IP e agente
   não são alterados.
3. **Given** a limpeza executada mais de uma vez sobre o mesmo conjunto de registros, **When**
   o trabalhador roda novamente, **Then** não falha e não altera registros já limpos (idempotência).
4. **Given** o painel administrativo, **When** o administrador visualiza, **Then** vê o horário
   da última execução de limpeza e a contagem de registros limpos na rodada mais recente.

---

### Edge Cases

- O que acontece com um lote cujo `batch_id` é válido mas `events` está vazio? (aceitar silenciosamente com `202` e zero eventos registrados)
- O que acontece quando o mesmo `event_id` aparece em lotes diferentes com `occurred_at` distintos? (primeiro grava, subsequente descarta — o `event_id` é a chave de deduplicação)
- O que acontece com exportações CSV de grandes conjuntos? (paginação server-side; exportação de até N registros por arquivo; arquivos maiores indicam filtro insuficiente)
- O que acontece quando o trabalhador de limpeza é interrompido no meio do processamento em lote? (retomada sem duplicar limpeza; registros já limpos não são retocados)
- O que acontece ao consultar acessos de uma instância `ENCERRADA`? (dados históricos continuam visíveis para o administrador; instância encerrada não apaga auditoria)

## Clarifications

### Tipos de evento de utilização aceitos no contrato

O contrato de utilização (`SP-098`) define que o Core recebe "contagens e contexto mínimo".
Para F08-Core (verificado com o produto de referência), o conjunto inicial de tipos de evento
(`kind`) é:

| Tipo | Significado |
| --- | --- |
| `atendimentos_iniciados` | Atendimentos abertos no período |
| `atendimentos_concluidos` | Atendimentos finalizados no período |
| `vendas_confirmadas` | Comandas confirmadas |
| `usuarios_ativos` | Usuários únicos com sessão no período |

Esse conjunto é o contrato mínimo do produto de referência. O Tuteli pode estender em F06/F07
com novos tipos; o Core aceita tipos desconhecidos com aviso de log sem falhar (forward
compatibility). Novos tipos obrigam nova versão do contrato se alterarem semântica dos existentes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O Core MUST expor `POST /internal/v1/instances/{id}/usage-batches` autenticado pela
  credencial operacional de instância, aceitando um `batch_id` e uma lista de eventos com
  `event_id`, `occurred_at`, `kind` e `count` (`SP-098`, princípio III).
- **FR-002**: O Core MUST deduplicate eventos por `(instance_id, event_id)`: evento já registrado é
  descartado sem alterar a contagem; a resposta informa quantos foram aceitos e quantos
  descartados (`CA-SC-011`).
- **FR-003**: O Core MUST gravar `occurred_at` do evento (não a data de recebimento) como instante
  de ocorrência, mantendo também `received_at` para diagnóstico de atraso (`SC-040`).
- **FR-004**: O Core MUST recusar lote enviado com credencial de instância `A` para instância `B`
  com `403`, sem revelar a existência de `B` (constituição I, `NFR-008`).
- **FR-005**: O Core MUST recusar lote para instância `SUSPENSA`, `ENCERRADA` ou `CADASTRADA`
  com código estável; a recusa MUST NOT expor informação interna (`SC-037`).
- **FR-006**: A indisponibilidade do endpoint de recepção de utilização MUST NOT impedir a
  validação de sessões do produto na projeção de acesso (`T-14`).
- **FR-007**: O painel administrativo MUST exibir instâncias por estado, provisionamentos
  pendentes e falhos, instâncias sem uso elegível nos últimos 7 e 30 dias, instâncias com atraso
  de telemetria e instâncias com schema incompatível (`SC-038`).
- **FR-008**: Instância sem nenhum evento de uso MUST aparecer como "dados insuficientes" no painel
  e nos relatórios, nunca como "utilização zero" (`CA-SC-012`, `SC-039`).
- **FR-009**: O painel MUST informar o período e horário de atualização de cada indicador de
  utilização (`SC-039`).
- **FR-010**: A tela de acessos de segurança MUST permitir filtro por produto, instância, usuário,
  data de início/fim e resultado, com paginação (`SC-032`).
- **FR-011**: A tela de auditoria administrativa MUST permitir filtro por entidade, ator, ação e
  intervalo de datas, com paginação (`SC-034`).
- **FR-012**: Exportações CSV MUST incluir cabeçalho com significado dos campos e linha de geração
  (data, filtros aplicados), e MUST neutralizar conteúdo de célula que inicia com `=`, `+`, `-`
  ou `@` para evitar injeção de fórmula em planilha (`SC-041`).
- **FR-013**: Exportações e telas MUST NOT conter senha, token completo, SQL, stack trace, valores
  financeiros do Tuteli, nomes de tutores, animais ou itens de venda (constituição VI, `SC-037`).
- **FR-014**: Eventos de auditoria MUST NOT ter opção de edição ou exclusão na interface; nenhuma
  rota de escrita sobre `security_event` ou `core_audit_event` a partir de sessão administrativa
  (`SC-035`).
- **FR-015**: O trabalhador de limpeza MUST apagar `ip_address` e `user_agent` de `security_event`
  com `created_at` superior a 180 dias, sem remover o evento (`SC-033`).
- **FR-016**: O trabalhador de limpeza MUST ser idempotente: executar sobre registros já limpos não
  falha nem os modifica.
- **FR-017**: Relatórios de utilização MUST usar intervalo e fuso horário explícitos; eventos
  atrasados MUST aparecer no período de ocorrência (`SC-040`).
- **FR-018**: Toda ação de exportação iniciada pelo administrador MUST gerar evento de auditoria
  administrativa com ator, filtros e quantidade exportada, sem o conteúdo do arquivo (constituição
  VI, `SC-034`).
- **FR-019**: O trabalhador de recepção de utilização MUST sobreviver a reinício: ao retomar, não
  processa o mesmo lote duas vezes (`NFR-014`).

### Key Entities

- **LoteUtilizacao** (`instance_usage_batch`): lote recebido do produto; chaves `id`, `instance_id`,
  `batch_id` (único por instância), `received_at`, `events_accepted`, `events_discarded`.
- **EventoUtilizacao** (`instance_usage_event`): evento individual deduplicated; chaves `id`,
  `instance_id`, `event_id` (único por instância — chave de deduplicação), `occurred_at`,
  `received_at`, `kind`, `count`.
- **EventoSegurança** (`security_event`, F01): login, logout, falhas, revogações; campos
  `ip_address` e `user_agent` nullable (limpos após 180 dias).
- **EventoAuditoria** (`core_audit_event`, F02): ações administrativas; somente leitura na
  interface.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **CS-020**: O produto de referência publica um lote, recebe relote e publica com atraso —
  em todos os casos o painel reflete contagens corretas e sem duplicação (T-14 verificado).
- **CS-021**: Um lote repetido não altera nenhuma contagem já registrada; o endpoint devolve o
  resultado original com indicação dos eventos descartados (`CA-SC-011`).
- **CS-022**: O endpoint de recepção indisponível não impede validações de sessão do produto em
  andamento (separação de responsabilidades confirmada por teste de integração).
- **CS-023**: Evento com mais de 180 dias tem IP e agente apagados pelo trabalhador; evento com
  menos de 180 dias permanece intacto; o evento em si não é removido em nenhum caso (`SC-033`).
- **CS-024**: Exportação CSV passa na verificação de neutralização de fórmulas: nenhuma célula
  inicia com `=`, `+`, `-` ou `@` no arquivo gerado, independente do conteúdo dos campos (`SC-041`).
- **CS-025**: Instância sem nenhum evento de uso nunca aparece como "utilização zero" — aparece
  como "dados insuficientes" no painel e nos relatórios (`CA-SC-012`).
- **CS-026**: O administrador que exporta dados de instância `A` não recebe nenhum dado de
  instância `B` no mesmo arquivo (`NFR-008`, constituição I).
- **CS-027**: Lote enviado com credencial da instância `A` para a rota da instância `B` é recusado
  com `403` sem revelar a existência de `B`.
- **CS-028**: O painel mostra em tempo útil (dados atualizados no máximo em 1 minuto após recepção
  de lote) instâncias sem uso, atraso de telemetria e versões incompatíveis (`SC-038`).

## Assumptions

- Os dados de `security_event` e `core_audit_event` já existem e são gravados corretamente pelas
  fatias F01, F02 e F03; F08-Core adiciona apenas a superfície de consulta e exportação.
- A credencial operacional de instância (já existente em F02) é reutilizada para autenticar os
  lotes de utilização no endpoint interno.
- O produto de referência (artefato mínimo, sem regras de negócio do Tuteli) implementa o
  produtor de outbox para verificação de F08-Core; o Tuteli real integra em F06.
- A limpeza de IP/agente roda como trabalhador periódico no mesmo processo do Core (monólito
  modular, constituição VII), sem dependência de infraestrutura externa.
- Dados sintéticos de utilização serão gerados para desenvolvimento e homologação, sem usar dados
  reais de produção (`NFR-016`).
- O fuso horário padrão para relatórios é `America/Sao_Paulo`, configurável por instância em
  fatia futura (`D-09`).
