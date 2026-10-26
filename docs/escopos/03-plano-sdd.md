# Preparação do desenvolvimento — entrada para o SDD Toolkit

**Versão:** 1.0 · **Data:** 25/10/2026 · **Situação:** plano de especificação, não implementação executada.

## 1. Como usar este pacote

O escopo deve alimentar o fluxo real do SDD Toolkit instalado no ambiente de desenvolvimento. Como suas skills não estavam disponíveis nesta sessão, os passos abaixo descrevem resultados esperados, sem atribuir comandos fictícios à ferramenta.

1. Ler os quatro documentos em conjunto e registrar as decisões pendentes.
2. Transformar as fatias abaixo em especificações com histórias, cenários de sucesso/falha, contratos, estados e invariantes.
3. Elaborar plano técnico após decidir as alternativas que afetam dados e segurança.
4. Derivar tarefas pequenas, verificáveis e rastreáveis aos requisitos.
5. Implementar por fatias completas, com testes proporcionais aos riscos, revisão e evidências.

Não iniciar pelos componentes visuais como se regras de suspensão, identidade, recebimento e concorrência já estivessem resolvidas. A escolha de layout não precisa bloquear a especificação das regras do domínio.

## 2. Conteúdo esperado de cada especificação

| Artefato | Conteúdo mínimo |
|---|---|
| Contexto e problema | Usuário, situação concreta, resultado esperado, escopo e exclusões. |
| Histórias | Ator, intenção, valor e prioridade; identificar dependências sem duplicar capacidades. |
| Requisitos | IDs originais relacionados, regras, campos e comportamentos observáveis. |
| Exemplos e aceite | Sucesso, validação, autorização negada, conflito, indisponibilidade e repetição. |
| Estados | Estados válidos, transições, terminalidade, ator e pré-condições. |
| Modelo de dados | Agregados, unicidade, chaves, índices, snapshots, histórico e retenção. |
| Contratos | APIs e eventos versionados, schemas, erros, idempotência e correlação. |
| Plano técnico | Módulos, migrações, transações/travas, segurança, implantação e operação. |
| Tarefas | Entregáveis revisáveis com dependências e evidência de conclusão. |
| Verificação | Testes de regras, integração em MySQL, jornadas e ensaios de falha aplicáveis. |
| Registro de decisões | Alternativa escolhida, motivo, consequência e requisitos alterados. |

Separar requisito funcional da decisão técnica: “não vender a última unidade duas vezes” é requisito; a estratégia de trava em MySQL precisa ser escolhida e demonstrada no plano.

## 3. Ordem proposta de desenvolvimento e rastreabilidade

Os intervalos abaixo incluem todos os identificadores contidos no intervalo. As fatias são sequenciais por dependência; não constituem estimativa de prazo ou autorização de implantação pública.

| Fatia | Entrega demonstrável | Requisitos principais | Dependência |
|---|---|---|---|
| F00 — Base e decisões | Repositório dos sistemas, execução local, MySQL de desenvolvimento, contratos iniciais, decisões D-01 a D-04, pipeline e dados sintéticos. | COM-001 a COM-006; NFR-001, NFR-011, NFR-012, NFR-016. | Nenhuma. |
| F01 — Identidade e contextos | Bootstrap, login, MFA Core, sessão por contexto, convite, vínculo, revogação e duas instâncias sintéticas isoladas. | COM-007 a COM-020; SC-001, SC-002, SC-010 a SC-013; SP-001 a SP-005; NFR-008, NFR-009. | F00. |
| F02 — Catálogo e provisionamento | Contratante, produto SparkPet, instância, banco próprio, migrações, credencial restrita, falha e retomada. | SC-003 a SC-009; SC-014 a SC-024; COM-025 a COM-027; NFR-013, NFR-014. | F01 e schema mínimo SparkPet. |
| F03 — Ciclo e operação da instância | Ativação, suspensão com sessão aberta, reativação, manutenção, saúde e procedimento de recuperação. | SC-025 a SC-031; SC-042 a SC-045; SP-097, SP-099, SP-100; NFR-006, NFR-007. | F02. |
| F04 — Cadastros SparkPet | Estabelecimento, profissionais, tutores, animais, cuidados, serviços/variantes e catálogo de estoque. | SP-006 a SP-028; COM-021 a COM-024, COM-028; NFR-002. | F03. |
| F05 — Agenda e atendimento | Agenda sem conflito, entrada, checklist, etapas, pronto, retirada e retorno manual, com ganchos transacionais para pacotes. | SP-029 a SP-048; RN-SP-003 a RN-SP-005; CA-SP-003 a CA-SP-007. | F04. |
| F06 — Comanda, estoque e recebimentos | Venda simples, baixa única, consumo de insumos, pagamento parcial, caixa e estorno elegível. | SP-049 a SP-066; SP-077 a SP-088; COM-021 a COM-028; NFR-013. | F05; venda de pacote/resgate fica desabilitada até F07. |
| F07 — Pacotes | Venda, quitação, validade, reserva, consumo e bloqueio financeiro, sem dupla cobrança. | SP-067 a SP-076; SP-044, SP-055, SP-075; CA-SP-012 a CA-SP-014. | F06. |
| F08 — Auditoria e utilização Core | Eventos de acesso, outbox, deduplicação, dados atrasados, filtros e exportações. | SC-032 a SC-041; SP-096, SP-098; NFR-010, NFR-014. | F03 e F06; completar contagens F07. |
| F09 — Relatórios e experiência final | Painéis locais, relatórios, CSV, restrições por perfil e jornadas em celular. | SP-089 a SP-095; NFR-002, NFR-004, NFR-005, NFR-015. | F05 a F08. |
| F10 — Homologação e piloto | Recuperação testada, segurança, concorrência, desempenho, importação assistida e aceite do piloto. | Todos os critérios de conclusão dos produtos; NFR-003 a NFR-016 aplicáveis. | Todas as fatias anteriores. |

Auditoria e segurança não começam apenas em F08: cada fatia registra os eventos necessários desde sua implementação. F08 entrega a visão de consulta e consolidação. Da mesma forma, testes e tratamento de erros acompanham todas as fatias.

## 4. Cenários críticos para detalhar no SDD

### T-01 — Provisionamento repetido

**Dado** um contratante ativo e SparkPet provisionável, **quando** duas chamadas idênticas usam a mesma chave, **então** ambas referenciam a mesma instância/tarefa, sem banco ou vínculo duplicado. Mesma chave com payload diferente gera conflito. Slug igual com chaves diferentes não cria segunda instância.

Relacionar: `SC-014` a `SC-024`, `CA-SC-005`, `COM-026`.

### T-02 — Queda entre etapas do provisionamento

**Dado** banco criado e migração ainda não concluída, **quando** o trabalhador é interrompido e retomado, **então** ele verifica a propriedade, recupera a etapa válida e mantém uso bloqueado até prontidão. Recurso com identidade inesperada não é reutilizado ou apagado.

Relacionar: `SC-020` a `SC-024`, `CA-SC-006`, `CA-SC-007`, `NFR-014`.

### T-03 — Suspensão e transação em curso

**Dado** usuário autenticado em A e B, **quando** A é suspensa, **então** requisição cuja autorização inicia após a confirmação é negada em A e continua válida em B. Uma transação autorizada antes pode concluir, com correlação que demonstre a ordem. Reativação requer nova sessão.

Relacionar: `SC-025` a `SC-030`, `SP-099`, `CA-SC-008`, `CA-SC-009`.

### T-04 — Ataque entre instâncias

**Dado** usuário apenas de A, **quando** altera rota, corpo, cabeçalho, recurso ou identificador de exportação para B, **então** não obtém dados nem executa ação em B. Reutilização de pool após requisições alternadas não troca o banco por engano.

Relacionar: `COM-008` a `COM-012`, `COM-025`, `NFR-008`, `RN-SP-001`, `RN-SP-014`.

### T-05 — Último administrador e conta compartilhada entre vínculos

**Dado** apenas um administrador ativo na instância, **quando** tenta se rebaixar ou remover, **então** a ação é recusada. Duas revogações concorrentes de administradores distintos não podem deixar a instância sem administrador. **Dado** colaborador vinculado a A e B, **quando** A o remove, **então** B continua acessível e o usuário não perde sua conta global.

Relacionar: `COM-011`, `COM-012`, `COM-018`, `COM-020`, `SC-011`, `SP-005`.

### T-06 — Conflito parcial de agenda e corrida

**Dado** atendimento de 09h a 10h, **quando** outra reserva disputa 09h30 a 10h30 para o profissional, recurso ou animal, **então** há conflito mesmo com início diferente. Duas reservas concorrentes da mesma disponibilidade produzem somente uma alocação.

Relacionar: `SP-029` a `SP-036`, `CA-SP-003`, `CA-SP-004`.

### T-07 — Histórico de preço e tempo

**Dado** agendamento com snapshot válido, **quando** catálogo muda, **então** compromisso anterior preserva seu valor e duração. Recalcular exige administrador, justificativa, nova checagem de capacidade e versão; colaborador não troca o total no payload.

Relacionar: `SP-021` a `SP-024`, `SP-033`, `SP-052`.

### T-08 — Última unidade de produto

**Dado** saldo 1, **quando** duas comandas distintas tentam vender 1 simultaneamente, **então** uma confirma e outra recebe conflito, sem venda parcial nem conta a receber órfã. Repetir a confirmação da vencedora devolve o resultado original.

Relacionar: `SP-051` a `SP-053`, `SP-060` a `SP-064`, `CA-SP-008`, `CA-SP-010`.

### T-09 — Pacote: concessão, disputa e expiração

**Dado** pacote parcialmente pago, **quando** chega atendimento, **então** não há crédito utilizável. Após quitação, conceder uma vez; disputar o último crédito gera uma reserva. Na fronteira de validade local, a entrada fora do prazo é negada. Serviço iniciado validamente pode concluir depois de meia-noite conforme regra do atendimento contínuo.

Relacionar: `SP-067` a `SP-076`, `CA-SP-012`, `CA-SP-013`.

### T-10 — Pacote e relatório financeiro

**Dado** pacote vendido por R$ 200, quitado e com um banho resgatado, **quando** gerar relatório comercial, **então** o pacote soma R$ 200 e o resgate não soma nova cobrança. O serviço realizado aparece em quantidade. Em cenário alternativo com somente R$ 100 recebidos, o caixa mostra R$ 100, o pacote não está liberado e o resgate é recusado.

Relacionar: `SP-055`, `SP-068`, `SP-069`, `SP-092`, `SP-093`, `CA-SP-014`.

### T-11 — Pagamento parcial e correção após fechamento

**Dado** venda de R$ 100, pagamento de R$ 40 ontem e R$ 60 hoje, **quando** consultar, **então** há uma venda, dívida quitada e dois recebimentos nos dias correspondentes. Estornar hoje o recebimento de ontem preserva caixa fechado e reabre R$ 40 de dívida, sem repor estoque ou apagar execução.

Relacionar: `SP-058`, `SP-077` a `SP-088`, `CA-SP-015`, `CA-SP-017`.

### T-12 — Fechamento concorrente

**Dado** caixa aberto, **quando** recebimento e fechamento disputam o mesmo instante, **então** a serialização inclui o recebimento no fechamento ou recusa seu lançamento, sem gravá-lo em caixa fechado. Pix não aumenta dinheiro físico esperado.

Relacionar: `SP-084` a `SP-088`, `CA-SP-016`.

### T-13 — Cuidados, interrupção e retirada com débito

**Dado** alerta atualizado e animal presente, **quando** colaborador inicia, **então** precisa registrar ciência da versão. Interrupção mantém insumo efetivamente usado e custódia aberta. Entrega com débito exige administrador e autorização da pessoa que retirou, sem apagar a dívida.

Relacionar: `SP-016` a `SP-018`, `SP-038` a `SP-048`, `SP-065`, `RN-SP-015`.

### T-14 — Telemetria repetida, atrasada ou indisponível

**Dado** operação confirmada e evento na outbox, **quando** falha entrega ou lote é repetido, **então** a operação permanece válida e a contagem não duplica. Evento atrasado atualiza data de ocorrência; ausência de dados aparece explicitamente. Endpoint de telemetria indisponível com autorização ainda funcional não paralisa atendimento.

Relacionar: `SC-036` a `SC-041`, `SP-098`, `SP-100`, `CA-SC-011`, `CA-SC-012`.

### T-15 — Timeout e indisponibilidade de identidade

**Dado** confirmação que pode ter sido concluída antes de perder resposta, **quando** o usuário retorna, **então** a interface consulta protocolo ou repete a mesma chave. **Dado** falha da API de identidade, **quando** tentar nova operação protegida, **então** há erro temporário, sem recorrer a papel salvo no navegador.

Relacionar: `D-04`, `COM-026`, `SP-082`, `SP-097`, `SP-100`, `NFR-013`.

### T-16 — Restauração com acesso revogado

**Dado** backup anterior a uma revogação de colaborador, **quando** restaurar a instância em destino isolado, **então** conferir identidade, dados e estado, reaplicar permissões atuais e só então liberar. Usuário revogado não volta a operar e instância B não é modificada.

Relacionar: `SC-043`, `NFR-007`, diretrizes de continuidade e critérios finais Core.

Esses cenários são a base de aceite, não uma suíte executada nesta entrega. O SDD precisa desdobrar variações de campos, autorização e domínio nas especificações das respectivas fatias.

## 5. Decisões e pendências por momento

| Pendência | Momento limite | Encaminhamento / responsável sugerido |
|---|---|---|
| D-01: dois monólitos ou executável único | Antes de estruturar a base | Responsável técnico + produto; referência proposta: dois monólitos. |
| D-02: identidade central ou por instância | Antes do modelo de autenticação | Responsável técnico + produto; referência: central, sem duplicar senhas. |
| D-03: uma unidade por instância | Antes de modelar agenda/estoque | Produto; referência: uma unidade. |
| D-04: autorização síncrona no Core | Antes dos contratos de acesso | Responsável técnico; aceitar dependência ou revisar estratégia de revogação. |
| Hospedagem e privilégio para criar bancos/usuários | Antes da prova de provisionamento real | Operação; confirmar recursos do ambiente contratado. Se indisponível, propor ambiente compatível, sem substituir silenciosamente por banco compartilhado. |
| Canal de entrega de convite e recuperação | Antes do piloto | Operação + produto; validar entrega manual segura ou serviço transacional. |
| Recuperação de MFA e acesso emergencial | Antes de produção Core | Operação + responsável de segurança. |
| Cadastro de tutor/animal pelo colaborador | Antes de homologar recepção | Produto + pilotos; manter matriz proposta até decisão explícita. |
| Modelo de pacote e devoluções/reembolsos | Antes de implementar F07 e antes de abertura comercial, respectivamente | Produto + pilotos; registrar exemplos reais e promover ao escopo se obrigatório. |
| Campos e política de retenção | Antes da produção | Responsável pelo negócio e privacidade; distinguir exigência legal, contrato e preferência operacional. |
| Volumes, infraestrutura e janela de backup | Antes dos ensaios de carga/recuperação | Operação + responsável técnico; medir metas propostas. |
| Emissão fiscal externa e conciliação operacional | Antes de produção do pet shop | Responsável pelo estabelecimento; definir processo do MVP. |
| Importação inicial | Antes de cadastrar piloto | Produto + operação; mapear origem, limpeza, reconciliação e validação do cliente. |
| Repositório/local dos novos produtos | Antes de F00 | Responsável técnico; este diretório contém o site institucional, não a aplicação dos SaaS. |

Não é necessário resolver todas as pendências para iniciar a especificação. Trabalho dependente de decisão estrutural deve usar proposta explícita e registrar o ponto de confirmação antes de consolidar código e migrações.

## 6. Definition of Ready

Uma fatia está pronta para implementação quando:

1. Os requisitos e exclusões estão identificados e sem conflito com o escopo compartilhado.
2. As decisões que afetam segurança, dados e contratos da fatia estão resolvidas ou formalmente assumidas para um experimento delimitado.
3. Estados e transições têm ator, pré-condição e efeitos definidos.
4. Regras de preço, saldo, duração, período e arredondamento possuem exemplos concretos.
5. Contrato, erros, autorização, idempotência e concorrência estão especificados.
6. Migrações e necessidade de dados iniciais estão descritas.
7. Cenários de sucesso, negativa e recuperação possuem evidência de aceite esperada.
8. Dependências de ambiente e operação são conhecidas.

## 7. Definition of Done

Uma fatia concluída possui:

- Comportamento implementado em servidor e interface, com autorização no servidor.
- Tipagem, análise estática e testes relevantes aprovados; testes de persistência/concorrência usam MySQL compatível com produção.
- Migração e dados sintéticos reproduzíveis.
- Tratamento de carregamento, vazio, validação, conflito e indisponibilidade.
- Auditoria, correlação e métricas aplicáveis, sem segredos ou conteúdo excessivo.
- Evidência de cenários de aceite, inclusive repetição e contexto de instância quando houver gravação.
- Documentação de configuração, limitações e operação atualizada.
- Nenhuma regressão nas invariantes e contratos das fatias anteriores.

Entrega comercial depende adicionalmente dos critérios finais dos dois produtos e dos bloqueadores de produção. Publicação, contratação de serviços, migração de dados reais e cobrança não foram executadas nesta elaboração.

## 8. Instrução de entrada para a sessão do SDD Toolkit

Texto reutilizável, ajustando apenas a localização deste pacote e os nomes reais das skills instaladas:

> Use como fonte de produto os arquivos `README.md`, `00-diretrizes-compartilhadas.md`, `01-sparkcore-mvp.md`, `02-sparkpet-mvp.md` e `03-plano-sdd.md` deste pacote. Prepare as especificações e o plano técnico do MVP de SparkCore e SparkPet com o fluxo do SDD Toolkit disponível no ambiente. Preserve IDs, origem e exclusões. Trate decisões propostas como propostas, sem inventar aprovação. Comece por F00/F01 e explicite D-01 a D-04 antes de implementar identidade e provisionamento. Para cada fatia, detalhe histórias, aceite, estados, modelo de dados, contratos, permissões, transações, idempotência, concorrência, migrações, testes e operação. Garanta banco operacional por instância, identidade separada, suspensão sobre sessões existentes, ausência de dupla cobrança de pacote e distinção entre comanda, estoque, recebimento e atendimento. Não introduza microserviços, faturamento SaaS automático, prontuário veterinário ou integrações adiadas. Se houver conflito ou lacuna estrutural, registre a decisão e seu impacto antes do trabalho dependente; prossiga nas atividades independentes autorizadas. Não implemente os SaaS dentro do projeto Astro do site institucional apenas por ele já existir.

## 9. Limite desta entrega

Foram elaborados escopos, critérios, proposta de arquitetura e plano de preparação. Não foram executadas skills do SDD Toolkit, criado banco, desenvolvido sistema, realizado teste de software ou implantado serviço. Os próximos artefatos deverão registrar escolhas técnicas e evidências de implementação sem tratar os critérios aqui escritos como testes já aprovados.
