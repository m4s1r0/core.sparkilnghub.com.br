# Tuteli — escopo elaborado do MVP monolítico

**Versão:** 1.0 · **Data:** 25/10/2026 · **Situação:** proposta para especificação.

Aplicar em conjunto com as [diretrizes compartilhadas](./00-diretrizes-compartilhadas.md). Origem: `[U]` pedido atual, `[H]` análise anterior, `[P]` proposta desta elaboração. Os requisitos numerados integram o MVP proposto; a seção de evoluções delimita as demandas adiadas.

## 1. Visão e problema atendido

O Tuteli é um SaaS para pet shops com banho e tosa que precisam organizar o atendimento por animal, controlar a capacidade da equipe, vender serviços e produtos e acompanhar recebimentos, estoque e pacotes.

A agenda precisa considerar porte, pelagem, serviço e duração. A operação precisa acompanhar a chegada, os cuidados informados pelo tutor, a execução e a retirada. A administração precisa distinguir serviço realizado, venda confirmada, dinheiro recebido, produto vendido, insumo consumido e crédito de pacote utilizado.

O MVP proposto atende um estabelecimento por instância, com operação online, agenda e estoque únicos. Atendimento veterinário, prontuário clínico, hospital, vacinação como procedimento e prescrição não fazem parte do produto.

### 1.1 O que foi recuperado e o que foi ampliado

| Origem | Conteúdo |
|---|---|
| Pedido atual `[U]` | Administrador e Colaborador; clientes/animais, insumos, movimentos de serviços e vendas; banco de autenticação; React/TypeScript/Tailwind, Node.js e MySQL. |
| Análise anterior `[H]` | Estética animal, tutor e pets, cuidados informados, duração e preço do serviço, agenda, checklist de entrada, etapas, pacotes com saldo/validade, aviso de retirada e caixa. |
| Detalhamento proposto `[P]` | Capacidade com prevenção de corrida, recursos simples, permissões por ação, retirada autorizada, diferenciação de estoque/recebimentos/comanda, idempotência, baixa e estorno, relatórios e integração Core. |
| Repriorização proposta | Venda de produtos entra agora por solicitação atual. Comissões da análise anterior ficam para depois; capacidade detalhada por etapa e automações também ficam posteriores. |

A documentação setorial consultada descreve agenda de profissionais, bloqueios, pacotes, checklist e consumo interno como rotinas de banho e tosa. Isso apoia a pertinência operacional desses temas, sem comprovar demanda para cada regra proposta aqui. Referência: [SimplesVet — controle de banho e tosa](https://suporte.simples.vet/pt-BR/articles/9580224-plano-pet-shop-guia-completo-controle-de-banho-e-tosa).

### 1.2 Objetivos mensuráveis do piloto

- Agendar considerando duração e disponibilidade, sem sobreposição indevida.
- Encontrar rapidamente cuidados e histórico do animal no atendimento.
- Acompanhar animais aguardando, em execução, prontos e retirados.
- Concluir serviço e venda sem duplicar cobrança, estoque, pagamento ou pacote.
- Conferir recebimentos e saldo a receber; separar dinheiro físico dos outros meios.
- Identificar retornos sugeridos, pacotes próximos ao fim e estoque abaixo do mínimo.

Metas comerciais de redução de faltas, aumento de receita ou renovação serão definidas com o piloto; não são resultados garantidos por este escopo.

## 2. Perfis, permissões e responsabilidades

`SP-001 [U]` **Administrador do estabelecimento:** cadastra clientes/tutores, animais, insumos e movimentos; administra o negócio na sua instância.

`SP-002 [U]` **Colaborador:** lança movimentos de serviços e vendas na sua instância.

`SP-003 [P]` Para tornar a operação viável, propõe-se que o colaborador também possa agendar cadastros existentes, registrar entrada, executar etapas, registrar consumo vinculado, receber valores e entregar o animal. Essas permissões operacionais são detalhamentos propostos, não novos perfis.

### 2.1 Matriz de permissões do MVP

| Capacidade | Administrador | Colaborador |
|---|---|---|
| Configurar estabelecimento, expediente e políticas | Sim | Não |
| Convidar usuários, mudar papel e revogar vínculo | Sim | Não |
| Cadastrar/editar/inativar tutores e animais | Sim | Não; consulta dos dados necessários ao atendimento |
| Cadastrar serviços, preços, produtos, insumos e pacotes | Sim | Consulta de itens ativos e preços; custo restrito |
| Cadastrar profissionais, recursos e bloqueios | Sim | Consulta de disponibilidade |
| Agendar/reagendar cadastros existentes | Sim | Sim, conforme disponibilidade e regras |
| Alterar preço/duração calculados ou conceder desconto | Sim, com motivo | Não |
| Cancelar agendamento antes da entrada / marcar falta | Sim | Sim, com motivo e sem efeitos financeiros automáticos |
| Registrar entrada, etapas, cuidados lidos e retirada | Sim | Sim |
| Criar/editar comanda em rascunho | Sim | Sim, sob regras de versão e auditoria |
| Confirmar comanda e lançar recebimentos | Sim | Sim, com preço autorizado; caixa aberto quando houver recebimento |
| Vender e consumir pacote elegível | Sim | Sim, sem mudar saldo ou validade |
| Registrar consumo de insumo em atendimento | Sim | Sim, restrito ao atendimento e saldo disponível |
| Entrada/ajuste de estoque, perda e reversão | Sim, com motivo | Não |
| Estornar recebimento/cancelar venda confirmada | Sim, com motivo | Não |
| Abrir/fechar caixa, sangria e suprimento | Sim | Não |
| Ver próprios recebimentos do dia e comanda em operação | Sim | Sim |
| Relatórios globais financeiros, custos e exportações | Sim | Não |
| Consultar auditoria completa da instância | Sim | Não |
| Administrar outra instância ou usar SparkCore | Não por esse papel | Não |

A autorização é verificada na API em cada ação. Ocultar botão não implementa a permissão. A matriz não permite ao colaborador criar tutor apenas porque está abrindo uma comanda; esse possível gargalo deve ser validado no piloto antes de ampliar o perfil.

### 2.2 Contas e profissionais

`SP-004 [U]` Autenticar usuários pelo banco de autenticação definido nas diretrizes. A proposta é identidade central, com vínculo e papel por instância.

`SP-005 [P]` O administrador local convida, lista, muda papel e revoga vínculos da sua instância. Impedir remover, rebaixar ou bloquear o último administrador ativo. Revogar uma conta local não afeta vínculos em outros estabelecimentos.

`SP-006 [P]` Cadastrar profissionais separadamente de usuários: nome, situação, serviços que executa, expediente, intervalos e vínculo opcional com usuário. Um profissional sem login pode receber agendamentos, enquanto o registro das ações mantém o usuário que efetivamente as lançou. Inativação de profissional ou recurso com reservas futuras ou atendimento aberto é recusada até remanejamento explícito; revogar uma conta de usuário não remove automaticamente o cadastro do profissional.

**CA-SP-001:** um colaborador que chama a API de ajuste de estoque, desconto ou convite diretamente recebe negação e não altera o dado.

## 3. Fluxos principais e limites da operação

### 3.1 Atendimento com agendamento

Tutor e animal cadastrados → seleção de serviços → duração/preço previstos → profissional/recurso disponível → agendamento → confirmação manual opcional → entrada/checklist → execução e consumo de insumos → pronto para retirada → confirmação da comanda → recebimento integral ou saldo a receber → entrega autorizada → sugestão de retorno.

A confirmação da comanda e o pagamento são fluxos distintos do andamento físico. Um animal pode estar pronto antes de receber; retirada com débito exige o controle específico descrito adiante.

### 3.2 Atendimento sem agendamento

Selecionar tutor/animal existentes → conferir disponibilidade para o intervalo imediato → criar encaixe com os mesmos bloqueios → registrar entrada → seguir o atendimento. Não há botão que ignore conflito apenas por se tratar de encaixe.

### 3.3 Venda avulsa de produtos

Selecionar produtos ativos → conferir quantidade/preço → criar comanda → registrar pagamento na confirmação ou vincular tutor para saldo a receber → confirmar com baixa de estoque → gerar comprovante simples sem natureza fiscal.

### 3.4 Pacote

Selecionar animal/serviço e modelo ativo → vender pacote → receber integralmente → ativar créditos e validade → reservar crédito na entrada de um atendimento elegível → consumir quando o serviço for efetivamente concluído → exibir saldo e validade; nunca gerar segunda cobrança pelo serviço já coberto.

## 4. Configuração, tutores, animais e catálogo

### 4.1 Configuração do estabelecimento

`SP-007 [P]` Configurar nome de exibição, contato, fuso, horários de funcionamento, intervalos, calendário de bloqueios e identificação no comprovante. Dados administrativos do contratante e estado da instância permanecem sob controle do Core.

`SP-008 [P]` Definir meios manuais de pagamento permitidos, estoque mínimo, prazo sugerido de retorno por serviço e condições operacionais de pacote. A interface usa português do Brasil e BRL.

`SP-009 [P]` Guardar versionamento/auditoria de configurações relevantes. Mudar fuso requer análise de impacto em agenda futura e relatórios; no MVP, alteração após início da operação é procedimento assistido, sem recalcular silenciosamente horários históricos.

### 4.2 Tutores / clientes

`SP-010 [U/H]` Cadastrar, pesquisar, editar e inativar tutor. Mínimo: nome e ao menos um meio de contato utilizável. Campos opcionais: e-mail, telefone secundário, CPF, endereço e observação operacional restrita à finalidade.

`SP-011 [P]` Normalizar telefone para pesquisa e e-mail conforme política. Telefone pode ser compartilhado por familiares; nome ou telefone iguais produzem alerta de possível duplicidade, não bloqueio absoluto nem fusão automática. Documento informado deve passar pelas validações e unicidade definidas.

`SP-012 [P]` Permitir listar animais vinculados, próximos horários, histórico de atendimentos, pacotes e saldo a receber do tutor. Colaborador vê apenas o necessário para atendimento e recebimento, sem exportação global.

`SP-013 [P]` Registrar contatos autorizados a retirar o animal por nome e contato opcional, com indicação de como e quando o tutor autorizou. Não exigir documento civil de todo contato sem necessidade validada.

`SP-014 [P]` Inativar tutor bloqueia novos agendamentos/vendas a prazo. Se houver animal em atendimento, não permitir inativação até resolver a custódia. Débitos e histórico não são apagados; recebimento de saldo histórico continua permitido ao administrador.

### 4.3 Animais

`SP-015 [U/H]` Cadastrar animal vinculado a um tutor principal: nome, espécie, porte e tipo de pelagem. Raça, sexo, castração informada, data de nascimento exata ou estimada, peso e data da pesagem são opcionais. Animais com o mesmo nome são permitidos.

`SP-016 [H/P]` Registrar cuidados informados pelo tutor: sensibilidade a produto, comportamento, restrições de manejo, preferência de acabamento e observações de segurança para banho/tosa. Indicar origem da informação e última atualização; não emitir diagnóstico ou recomendação clínica.

`SP-017 [P]` Exibir alertas operacionais na agenda e antes de iniciar atendimento. O usuário registra ciência dos alertas vigentes; mudança relevante após a ciência exige nova confirmação antes de continuar a execução.

`SP-018 [P]` Consultar histórico cronológico com serviços, datas, responsável, observações de execução, pacote usado e retirada, preservando o conteúdo da época. Não criar prontuário veterinário.

`SP-019 [P]` Inativar animal impede novos agendamentos; pode sinalizar falecimento sem apagar histórico. Transferência de tutor principal é administrativa, auditada, exige confirmação registrada e não transfere débitos automaticamente. Não transferir com custódia aberta; reservas futuras e contatos autorizados precisam de revisão explícita. Pacote continua no mesmo animal; o responsável financeiro da venda original é preservado e eventual autorização de continuidade de uso pelo novo tutor deve ser registrada.

**CA-SP-002:** um tutor pode ter vários animais; agendar o animal A não exibe cuidados ou pacote do animal B como se fossem de A.

### 4.4 Serviços, preço e duração

`SP-020 [H]` Cadastrar serviços com código, nome, descrição, situação, preço, duração estimada em minutos e prazo opcional de retorno.

`SP-021 [H/P]` Manter variações por porte e pelagem. Regra específica de serviço/porte/pelagem tem prioridade; se não existir, usar a regra padrão explícita do serviço. Sem regra válida, bloquear agendamento em vez de assumir preço ou duração zero.

`SP-022 [P]` Duração prevista do atendimento = soma das durações dos serviços selecionados + intervalo de preparação/finalização configurado uma única vez. Valores e minutos são calculados no servidor; duração deve ser positiva e caber no expediente. Proposta de limite inicial: atendimento no mesmo dia local, duração total até 12 horas.

`SP-023 [P]` Gravar snapshot de nome, preço, duração, variante e regra aplicada ao agendar; confirmar os preços na comanda. Mudança posterior de catálogo não altera reserva, venda ou pacote já contratado. Administrador pode atualizar reserva futura de forma explícita e auditada, revalidando capacidade e valor.

`SP-024 [P]` Apenas administrador altera preço/duração calculados com justificativa. Desconto é valor fixo em centavos por comanda, limitado ao subtotal de itens avulsos elegíveis, sem tornar total negativo. Pacotes não recebem desconto adicional no MVP. Rateio de desconto entre itens usa regra determinística, com arredondamento em centavos documentado.

### 4.5 Produtos de revenda e insumos

`SP-025 [U/P]` Cadastrar itens de estoque com SKU, nome, tipo (`REVENDA` ou `INSUMO`), unidade, estoque mínimo, situação e custo opcional restrito ao administrador. Produto de revenda tem preço de venda e quantidade inteira; insumo utiliza unidade como mL, g ou unidade e quantidade com até três casas.

`SP-026 [P]` No MVP, um SKU pertence a um único tipo. Para comprar embalagem de revenda e usar fracionado no banho, cadastrar itens distintos e realizar ajuste administrativo documentado; transformação automática e conversão de unidade ficam fora.

`SP-027 [P]` Código de barras é opcional e único quando informado. Categoria, marca, fornecedor de referência e observação são opcionais. Não há cadastro completo de compras, contas a pagar, lotes ou validade de lote neste MVP.

`SP-028 [P]` Inativar serviço/produto bloqueia novas inclusões; histórico preserva snapshot. Agendamento futuro com serviço depois inativado é marcado para revisão administrativa, sem cancelamento automático; iniciar o atendimento exige validar substituição ou liberação administrativa registrada.

## 5. Agenda, capacidade e recorrência

### 5.1 Modelo de capacidade do MVP

Cada atendimento reserva um profissional e, se o serviço exigir, um recurso físico de capacidade unitária durante **todo o intervalo previsto**. Recursos podem representar mesa, estação ou sala. Serviços da mesma reserva podem exigir no máximo um recurso em conjunto; combinações incompatíveis precisam ser divididas em atendimentos separados.

Esse modelo é conservador: evita vender simultaneidade inexistente, mas não otimiza troca de profissional ou liberação de equipamento entre banho, secagem e tosa. Capacidade por etapa e múltiplos profissionais simultâneos são evoluções explícitas.

### 5.2 Requisitos de agendamento

`SP-029 [H]` Consultar agenda diária/semanal por profissional e visualização em lista no celular; filtros por status, animal e tutor, com início, fim previsto e serviços.

`SP-030 [H/P]` Criar agendamento com tutor, animal, serviços, profissional, recurso quando necessário, início, fim calculado, observação e preço previsto. O animal deve estar vinculado ao tutor selecionado e os cadastros precisam estar ativos.

`SP-031 [P]` Verificar expediente do estabelecimento, profissional habilitado para os serviços, intervalos, bloqueios, duração e recurso obrigatório. Impedir sobreposição do profissional, recurso e do próprio animal, inclusive entre profissionais diferentes.

`SP-032 [P]` Persistir capacidade com controle contra concorrência. As verificações de intervalos e a gravação precisam ocorrer na mesma seção protegida; índice único em horário inicial não resolve conflito parcial entre intervalos. Adquirir travas em ordem estável para reduzir deadlocks.

`SP-033 [P]` Reagendar ou trocar profissional/recurso exige nova verificação integral, versão do registro e auditoria. A reserva antiga só é liberada no mesmo commit que cria a nova alocação válida.

`SP-034 [P]` Confirmar manualmente agendamento, cancelar com motivo ou marcar falta após o início previsto e sem entrada registrada. Cancelamento e falta não cobram multa ou consomem crédito automaticamente. Proposta: estados da agenda separados do estado de atendimento.

`SP-035 [P]` Permitir bloqueio pontual por profissional/recurso e configuração recorrente do expediente. Se novo bloqueio conflitar com agendamento existente, mostrar os conflitos e recusar até o administrador reagendar; não excluir reservas em silêncio.

`SP-036 [P]` Atraso ou duração real maior que o previsto gera sinalização na agenda; não remarca automaticamente os próximos animais. Extensão explícita do horário precisa revalidar conflitos e ser resolvida pela equipe.

`SP-037 [H/P]` Oferecer retorno sugerido por serviço/animal e lista de animais sem novo agendamento após a data sugerida. Criar próximo horário é ação manual e passa pelas mesmas regras; não criar série recorrente infinita nem enviar campanha automática.

**CA-SP-003:** serviço de 60 minutos às 09h ocupa `[09h,10h)`; outro às 10h pode ser aceito se todo o restante for válido, mas às 09h30 deve ser recusado.

**CA-SP-004:** duas requisições simultâneas disputando o mesmo profissional/recurso/animal resultam em uma reserva válida e um conflito compreensível, sem dupla ocupação.

**CA-SP-005:** alterar preço de catálogo não muda um agendamento existente; recalcular explicitamente exige permissão e atualização de seu snapshot.

## 6. Atendimento, cuidados e retirada

`SP-038 [H]` Abrir atendimento a partir de um agendamento ou encaixe válido, com um único animal. Registrar chegada, usuário de entrada e checklist textual.

`SP-039 [H/P]` Checklist mínimo: serviços combinados, cuidados atuais lidos, condições aparentes relatadas sem interpretação clínica, pertences recebidos, instruções do tutor e previsão de retirada. Campo de condição é descritivo; fotos e anexos ficam para evolução.

`SP-040 [H]` Acompanhar estados `AGUARDANDO`, `EM_ATENDIMENTO`, `PRONTO`, `ENTREGUE` e `INTERROMPIDO`, com instantes e ator. Dentro de execução, permitir indicar etapa `BANHO`, `SECAGEM`, `TOSA` ou `FINALIZACAO`, conforme serviços; essa etapa não muda a alocação de capacidade.

`SP-041 [P]` Iniciar exige checklist e ciência de alertas. Verificar também que profissional e recurso não estejam em execução em outro atendimento; atraso do anterior exige aguardo ou replanejamento, sem liberar simultaneidade silenciosa. Registrar início/fim real, profissional executor e observação. Troca de profissional planejado exige autorização administrativa e revalidação de capacidade; autoria do lançamento continua sendo do usuário logado.

`SP-042 [P]` Acrescentar serviço durante atendimento exige aprovação de preço e tempo pelo administrador, registro de como o tutor autorizou e revalidação da agenda. Sem intervalo disponível, o sistema não promete um novo horário automaticamente; equipe resolve o conflito antes da alteração.

`SP-043 [P]` Registrar intercorrência operacional e interrupção com motivo, responsável e providência informada. Interrupção libera reservas de serviços não realizados; insumo já usado não retorna ao estoque. Retomar o mesmo atendimento exige nova previsão, capacidade validada e autorização administrativa; atendimento interrompido com animal presente continua no painel até entrega.

`SP-044 [H/P]` Marcar `PRONTO` após concluir os serviços e os registros obrigatórios. Consumir créditos reservados dos serviços efetivamente concluídos nesse ato, com transação e origem única. O horário real de conclusão não altera silenciosamente o agendamento original.

`SP-045 [H/P]` Disponibilizar aviso de retirada como texto revisável para copiar e registro manual de que a equipe avisou o tutor. Não enviar WhatsApp/SMS/e-mail automaticamente no MVP nem afirmar que houve entrega da mensagem sem integração.

`SP-046 [P]` Registrar entrega com instante, usuário e nome da pessoa que retirou; confrontar com tutor ou autorizado e confirmar devolução de pertences. Se não houver autorização cadastrada, administrador registra a autorização obtida antes de entregar. O sistema apoia o procedimento humano, sem autenticar fisicamente a pessoa.

`SP-047 [P]` A retirada exige comanda confirmada sempre que houver serviço realizado, resgate de pacote ou outro item comercial, inclusive com total zero, e saldo quitado ou liberação administrativa de débito com motivo. Atendimento interrompido sem serviço realizado ou item cobrável pode encerrar sem comanda, com motivo administrativo registrado. Um colaborador não pode ignorar saldo pendente. Um atendimento interrompido também precisa de entrega registrada se o animal estiver no estabelecimento.

`SP-048 [P]` Atendimento `ENTREGUE` não volta a execução por simples mudança de status. Correção administrativa de registro preserva histórico e exige motivo; novo serviço abre novo atendimento.

**CA-SP-006:** não iniciar sem ler os alertas; ao registrar entrega, deve ser possível reconstruir chegada, execução, conclusão, aviso manual e pessoa que retirou.

**CA-SP-007:** marcar pronto duas vezes, inclusive após timeout, não consome dois créditos nem cria duas vendas. Serviço concluído e pagamento são estados independentes.

## 7. Comandas, serviços e vendas

### 7.1 Modelo comercial

Uma comanda tem no máximo um tutor responsável e um atendimento vinculado. Vendas apenas de produtos podem ser avulsas; uma comanda com serviço exige animal/atendimento. Vários animais do mesmo tutor usam atendimentos e comandas separados no MVP. Uma operação não pode faturar o mesmo atendimento em duas comandas confirmadas.

`SP-049 [U]` Criar movimentos de serviços e vendas com itens de tipo serviço avulso, produto de revenda, venda de pacote ou utilização de crédito de pacote. Registrar quantidade, valor unitário, desconto autorizado, total, responsável financeiro, autor e datas.

`SP-050 [P]` Comanda em `RASCUNHO` é editável por administrador ou colaborador autorizado da instância, inclusive de outro turno, com controle de versão e autoria de cada alteração; não baixa produto nem ativa crédito. Pode ser descartada/cancelada sem efeito financeiro. Não funciona como reserva de estoque.

`SP-051 [P]` Confirmar comanda grava snapshots e total, cria conta a receber, baixa produtos e registra a origem de cada efeito na mesma transação. Venda de pacote só concede créditos após quitação integral, conforme seção 9. Serviço avulso só pode confirmar a cobrança após registrado como realizado ou como item explicitamente autorizado em atendimento interrompido pelo administrador.

`SP-052 [P]` A confirmação é idempotente. Quantidade/preço/desconto/total são recalculados e validados no servidor; alterar campos no navegador não modifica o preço autorizado. Itens vindos da agenda usam o snapshot contratado; itens adicionados usam a regra vigente ou exceção administrativa registrada, sem reprificar compromissos antigos silenciosamente. Comanda confirmada é imutável, salvo operações compensatórias previstas.

`SP-053 [P]` Produtos com estoque insuficiente bloqueiam toda a confirmação, sem gerar venda parcial, conta a receber ou baixa dos demais itens. A transação trata a disputa pela última unidade.

`SP-054 [P]` Venda de produto sem tutor só é permitida com quitação integral no mesmo commit da confirmação. Venda a prazo, serviço ou pacote exige responsável identificado. Estorno que criaria dívida de venda anônima exige atribuir responsável antes da correção.

`SP-055 [P]` Item coberto por pacote mostra o serviço e o valor de referência, mas gera cobrança nova de zero para aquela utilização. Somente itens extras efetivamente contratados são cobrados. A venda original do pacote permanece separada e rastreável.

`SP-056 [P]` Gerar comprovante simples para consulta/impressão do navegador com estabelecimento, data, itens, total, recebimentos e saldo. Deve ser identificado como comprovante não fiscal; não emitir NF-e, NFC-e ou NFS-e.

### 7.2 Cancelamentos e correções

`SP-057 [P]` Apenas administrador cancela comanda confirmada, com motivo e reautenticação conforme política. O MVP suporta cancelamento integral, sujeito a estas condições:

- Nenhum serviço dessa comanda foi efetivamente executado; execução já realizada não é apagada por cancelamento comercial.
- Produto entregue precisa ter sido integralmente devolvido e conferido para reentrada de estoque; a ação registra essa confirmação.
- Pacote vendido não pode ter crédito consumido nem reservado.
- Recebimentos associados são integralmente estornados, em caixa aberto atual, com confirmação de devolução efetiva quando aplicável.
- Lançamentos compensatórios, redução da conta a receber e estado de cancelamento são atômicos. Histórico original permanece.

`SP-058 [P]` Estorno de recebimento é ação distinta de cancelamento de venda: corrige registro de pagamento e reabre saldo a receber, sem repor produto, apagar serviço ou recriar pacote. Regras de caixa e pacote se aplicam.

`SP-059 [P]` Devolução parcial de produto, abatimento posterior à confirmação e reembolso comercial de serviço já prestado ficam para evolução. Durante o piloto, situações desse tipo exigem procedimento administrativo externo documentado e conciliação; se forem recorrentes, promovê-las ao escopo antes de comercializar amplamente. Não simular devolução por ajuste de estoque sem registro financeiro correspondente.

**CA-SP-008:** três cliques para confirmar a mesma comanda produzem uma venda, uma baixa por item e uma conta a receber.

**CA-SP-009:** cancelar uma venda não executada preserva os documentos e lança compensações; serviço já prestado impede esse cancelamento no MVP.

## 8. Estoque de produtos e consumo de insumos

`SP-060 [U/P]` Consultar saldo por SKU e manter livro de movimentações: saldo inicial, entrada manual, venda, consumo em atendimento, perda, ajuste justificado e compensação identificada.

`SP-061 [P]` Entrada manual registra item, quantidade, unidade, data do registro, referência opcional de compra e responsável. Isso não cria pedido de compra ou conta a pagar. Datas operacionais não podem ser manipuladas para reescrever fechamento passado.

`SP-062 [P]` Produto de revenda é baixado na confirmação da comanda, com unicidade por item/origem. Rascunho não reserva nem garante a última unidade.

`SP-063 [P]` Consumo de insumo é lançado durante o atendimento com quantidade na unidade cadastrada, profissional/usuário, instante e atendimento de origem. Não gerar baixa automática estimada e manual para o mesmo consumo. Ficha técnica para consumo automático é evolução.

`SP-064 [P]` Impedir saldo negativo em toda saída, inclusive consumo e ajuste. Entrada ou correção necessária é feita pelo administrador antes de tentar novamente. Registrar perda e ajuste com motivo; ajuste não é mecanismo para esconder venda ou pagamento.

`SP-065 [P]` Devolver insumo ao estoque apenas quando o material não utilizado foi efetivamente recuperado e conferido. Cancelar atendimento não repõe automaticamente shampoo usado nem outro insumo consumido.

`SP-066 [P]` Alertar saldo abaixo ou igual ao mínimo; listar movimentações por período, item, origem e usuário. Custos e relatórios de valorização são restritos ao administrador; não apresentar lucro ou margem completa com base apenas no custo opcional de cadastro.

**CA-SP-010:** com saldo 1, duas confirmações concorrentes de quantidade 1 resultam em uma venda e uma recusa; saldo final 0 e livro de estoque coerente.

**CA-SP-011:** interromper um banho mantém o insumo consumido; uma reversão administrativa só retorna a quantidade efetivamente recuperada, vinculada ao lançamento original.

## 9. Pacotes pré-pagos e créditos

### 9.1 Recorte do pacote

O MVP atende modelo simples: **um animal, um tipo de serviço elegível, quantidade inteira de créditos, preço fechado e validade em dias corridos**. Não há compartilhamento entre animais/tutores, assinatura recorrente, pacote misto, transferência de crédito, crédito em reais ou fracionamento de uma utilização.

`SP-067 [H/P]` Cadastrar modelo de pacote com nome, serviço elegível, quantidade inteira de utilizações maior que zero, preço maior que zero, validade e situação. Proposta inicial: validade de 1 a 365 dias; qualquer faixa diferente exige ajuste explícito no plano.

`SP-068 [H/P]` Vender pacote para tutor e animal identificados, gravando snapshot de condições. Preço/quantidade/validade de modelo editado não alteram pacote vendido. Pacote pode ter pagamento parcial, mas só fica utilizável após quitação integral.

`SP-069 [P]` Ativar créditos uma única vez ao quitar. A validade começa na data local da primeira quitação e vale no intervalo de datas `[ativação, ativação + dias_validade)`. Mostrar ao usuário o último dia válido inclusivo. Pagar de novo após estorno não cria créditos nem reinicia a validade.

`SP-070 [P]` Reservar crédito na entrada do atendimento, validando pacote quitado, animal, serviço, saldo livre e data. Reserva de agenda não prende crédito com semanas de antecedência. Por isso, a indicação de pacote na agenda é previsão; a elegibilidade é confirmada na entrada.

`SP-071 [P]` Saldo livre = créditos concedidos − créditos consumidos − créditos reservados, considerando reversões válidas. Atualizar com transação/trava; dois atendimentos não podem reservar o último crédito simultaneamente.

`SP-072 [P]` Consumir reserva quando o serviço elegível for concluído. Se entrada ocorreu em data válida e o atendimento contínuo terminar após meia-noite, a reserva daquele atendimento pode ser consumida sem conceder novo prazo a outros usos; registrar ambos os instantes.

`SP-073 [P]` Cancelar antes da execução ou interromper sem realizar o serviço elegível libera a reserva. Um serviço já concluído consome crédito, mesmo que o animal ainda não tenha sido retirado. Não aplicar multa automática por falta e não conceder crédito extra por expiração.

`SP-074 [P]` Consultar histórico de concessão, reserva, liberação, consumo e reversão, sempre com origem. Alteração manual livre de saldo/validade e concessão promocional ficam fora. Corrigir conclusão lançada por engano exige administrador, motivo e registro que comprove não execução; reversão não pode funcionar como reutilização de serviço efetivamente prestado.

`SP-075 [P]` Cancelar venda de pacote apenas se não houver consumo nem reserva, compensando a concessão e os recebimentos. Estorno de recebimento de pacote com reserva ativa é recusado até resolver o atendimento. Se houver créditos já consumidos, estorno de pagamento permitido para correção abre débito e bloqueia o saldo remanescente até nova quitação, sem apagar usos anteriores.

`SP-076 [H/P]` Exibir saldo, reservado, consumido, último dia válido e situação derivada: aguardando quitação, ativo, esgotado, expirado, bloqueado por saldo financeiro ou cancelado. Flags financeiras e de validade devem ser avaliadas sem depender de tarefa noturna para impedir uso indevido.

**CA-SP-012:** pacote de quatro banhos pago integralmente concede quatro créditos uma única vez; usar um banho reduz o disponível sem gerar novo valor a receber por esse banho.

**CA-SP-013:** duas entradas disputando o último crédito permitem no máximo uma reserva. A outra deve oferecer cobrança avulsa ou outro pacote, com concordância explícita e sem aplicar automaticamente uma cobrança.

**CA-SP-014:** a venda do pacote aparece uma vez no total comercial; a utilização aparece como serviço realizado e crédito consumido, sem somar novamente o preço do pacote ou o valor de referência do banho.

## 10. Recebimentos, saldo a receber e caixa

### 10.1 Separação dos conceitos

| Conceito | Definição |
|---|---|
| Total comercial confirmado | Soma dos valores cobrados em comandas confirmadas, incluindo venda de pacote e excluindo valor de referência de resgates. Cancelamentos são apresentados como compensação. |
| Recebido líquido | Recebimentos efetivamente registrados menos estornos de recebimento, no período em que cada lançamento ocorreu. |
| Saldo a receber | Valor devido de comanda não cancelada menos recebimentos líquidos vinculados; deve ser não negativo. |
| Serviço realizado | Evento operacional; pode ter sido pago agora, anteriormente por pacote ou continuar a receber. |
| Dinheiro esperado no caixa | Abertura + recebimentos em dinheiro − estornos em dinheiro + suprimentos − sangrias. Pix e cartão são mostrados separadamente. |
| Resultado contábil | Não calculado neste MVP; não confundir venda, caixa e reconhecimento contábil de receita de pacote. |

### 10.2 Recebimentos

`SP-077 [P]` Registrar recebimento manual vinculado a comanda confirmada, com valor positivo, meio, instante, usuário e caixa aberto. Meios iniciais: dinheiro, Pix manual, cartão de débito e cartão de crédito informado, sem armazenar número do cartão, código de segurança ou credencial bancária.

`SP-078 [P]` Permitir pagamentos parciais e combinação de meios, desde que o total líquido não ultrapasse o saldo devido. Não criar parcelamento com juros, agenda de parcelas, taxa de adquirente ou conciliação automática. Saldo a receber tem data de vencimento única definida na confirmação, sugerida para a data da venda.

`SP-079 [P]` Confirmar Pix/cartão manualmente apenas após verificação humana do recebimento. O sistema não pode mostrar “Pix confirmado pelo banco” ou status de liquidação automática. Venda de crédito a prazo depende do responsável identificado, sem análise automática de crédito.

`SP-080 [P]` Recebimento em dinheiro pode registrar valor entregue e troco; o valor apropriado à dívida e ao caixa é o valor devido/recebido líquido, e o troco é informativo. Não aceitar excedente como crédito genérico do cliente neste MVP.

`SP-081 [P]` Estornar integralmente um recebimento por vez, apenas por administrador, com motivo e confirmação da correção/devolução. Estorno é novo lançamento no caixa aberto atual; o lançamento original e o caixa já fechado permanecem intactos. Estorno parcial de um único recebimento fica fora do MVP.

`SP-082 [P]` Dois pagamentos simultâneos não podem quitar em duplicidade. Confirmar pagamento/venda em operação combinada é transação única; uma indisponibilidade de resposta permite consultar protocolo ou repetir a chave idempotente sem pagar novamente no sistema.

`SP-083 [P]` Listar débitos por tutor, comanda, vencimento e situação, com saldo e histórico. Receber dívida antiga não altera o total comercial de hoje; entra nos recebimentos de hoje.

### 10.3 Caixa simples

`SP-084 [H/P]` Manter um único caixa operacional aberto por estabelecimento, com data operacional, responsável e valor de abertura em dinheiro. Proposta inicial: administrador abre e fecha; equipe registra recebimentos no caixa ativo.

`SP-085 [P]` Registrar suprimento e sangria em dinheiro pelo administrador, com valor positivo, motivo e usuário. Esses lançamentos alteram caixa físico, sem gerar venda, despesa contábil ou pagamento de tutor.

`SP-086 [P]` Fechar caixa informando contagem física, esperado, diferença, totais por meio e justificativa quando houver diferença. Caixa fechado não aceita novas gravações; correções usam o próximo caixa aberto e referência à origem. Não permitir reabertura/edição do caixa fechado no MVP.

`SP-087 [P]` Fechamento e recebimento concorrentes usam controle transacional: o recebimento entra antes do fechamento ou é recusado por caixa fechado, sem lançamento órfão. Não é permitido lançar recebimento, estorno, sangria ou suprimento sem caixa aberto.

`SP-088 [P]` Comanda sem novo recebimento pode confirmar com saldo a receber identificado ou total zero, sem caixa aberto. O fechamento físico não equivale a saldo bancário e não presume que cartão de crédito liquidou naquele dia.

**CA-SP-015:** venda de R$ 100 com R$ 40 recebidos fica com saldo R$ 60; os R$ 60 recebidos no dia seguinte entram no caixa seguinte, sem duplicar a venda.

**CA-SP-016:** pagamento de R$ 50 em dinheiro e R$ 30 em Pix acrescenta R$ 50 ao dinheiro físico esperado, preservando os R$ 30 no total separado de Pix.

**CA-SP-017:** estorno hoje de recebimento de ontem registra a compensação hoje, mantém o fechamento de ontem e reabre o saldo da comanda, quando a venda continua válida.

## 11. Estados e invariantes de negócio

### 11.1 Agenda e atendimento

| Objeto | Estados | Regras de transição |
|---|---|---|
| Agendamento | `AGENDADO`, `CONFIRMADO`, `CANCELADO`, `FALTOU`, `COMPARECEU` | Entrada transforma agendado/confirmado em compareceu e cria atendimento único. Cancelado/faltou não recebe entrada sem novo agendamento ou reativação administrativa com capacidade validada. |
| Atendimento | `AGUARDANDO`, `EM_ATENDIMENTO`, `PRONTO`, `ENTREGUE`, `INTERROMPIDO` | Aguardando → em atendimento → pronto → entregue. Interrupção a partir de aguardando/em atendimento; se o animal está presente, registrar entrega. Retomada de interrompido exige validação administrativa; entregue é terminal operacional. |
| Aviso de retirada | `NAO_REGISTRADO`, `AVISO_MANUAL_REGISTRADO` | Registro humano não equivale a confirmação de entrega digital ou de leitura pelo tutor. |

Cancelamento de agendamento antes da chegada não cria atendimento. Um animal não pode ter dois atendimentos com custódia aberta ao mesmo tempo. `INTERROMPIDO` pode ainda representar animal presente; um campo próprio de custódia/entrega impede perdê-lo do painel.

### 11.2 Comercial e financeiro

| Objeto | Estados / situação | Regras |
|---|---|---|
| Comanda | `RASCUNHO`, `CONFIRMADA`, `CANCELADA` | Confirmada não volta a rascunho. Cancelar confirmada exige pré-condições e compensação. |
| Conta a receber | `ABERTA`, `PARCIAL`, `QUITADA`, `CANCELADA`; vencida é indicador derivado | Calculada por valor devido e recebimentos líquidos. Estorno pode reabrir. Cancelamento segue cancelamento elegível da venda. |
| Recebimento | `REGISTRADO`, `ESTORNADO` | Estornado uma única vez por sua totalidade; correção é novo lançamento, sem editar o original. |
| Caixa | `ABERTO`, `FECHADO` | Um aberto por estabelecimento. Fechado é imutável na operação comum. |
| Crédito de pacote | Concedido, reservado, liberado, consumido ou revertido por lançamentos | Não atualizar saldo diretamente nem conceder novamente ao repetir pagamento. |

### 11.3 Regras invariantes

- `RN-SP-001` Todo recurso operacional pertence a uma instância resolvida e autorizada no servidor.
- `RN-SP-002` Administrador de estabelecimento não altera estado da instância, contratante ou conta global.
- `RN-SP-003` Um animal tem um tutor principal atual; débito pertence ao responsável da venda na época.
- `RN-SP-004` Profissional, recurso e animal não recebem intervalos sobrepostos no planejamento válido.
- `RN-SP-005` Um agendamento gera no máximo um atendimento; um atendimento tem no máximo uma comanda confirmada.
- `RN-SP-006` Quantidade de estoque e crédito livre nunca fica negativa.
- `RN-SP-007` Nenhuma baixa, reserva, consumo ou compensação se repete para a mesma origem.
- `RN-SP-008` Preço e duração históricos são snapshots; catálogo não reescreve compromissos existentes.
- `RN-SP-009` Recebimentos líquidos não ultrapassam valor devido; sobrepagamento não vira crédito invisível.
- `RN-SP-010` Venda de pacote e uso do serviço são registrados sem dupla cobrança e sem somar duas vezes no total comercial.
- `RN-SP-011` Desfazer pagamento não desfaz execução do serviço, entrega do animal ou consumo real de insumo.
- `RN-SP-012` Inativar cadastro não apaga transação; ajuste e estorno exigem origem e motivo.
- `RN-SP-013` Suspensão bloqueia nova requisição protegida; transação autorizada antes da suspensão pode concluir conforme regra compartilhada.
- `RN-SP-014` O usuário não escolhe banco, papel ou ator efetivo em campos do formulário.
- `RN-SP-015` Entrega com saldo pendente exige administrador e motivo; débito continua visível.

## 12. Relatórios e indicadores locais

`SP-089 [H/P]` Painel do dia com agenda, animais presentes por etapa, prontos aguardando retirada, atrasos previstos, recebimentos do dia e pendências compatíveis com o papel. Valores globais ficam restritos ao administrador.

`SP-090 [P]` Relatório de agenda com previstos, cancelados, faltas, duração prevista e realizada, ocupação planejada e divergência de tempo por profissional.

`SP-091 [P]` Relatório de atendimento com serviços realizados, tempo de permanência, prontos sem retirada, interrupções e retorno sugerido. Registrar retirada é necessário para medir permanência; registro ausente aparece como pendência, não como zero.

`SP-092 [P]` Relatório comercial com comandas, itens, serviços avulsos, produtos e pacotes vendidos; cancelamentos, descontos autorizados e utilizações de pacote separados.

`SP-093 [P]` Relatório financeiro operacional com recebido por meio, estornos, saldo a receber, vencidos e fechamento de caixa, sem apresentar esse conjunto como contabilidade completa.

`SP-094 [P]` Relatório de pacotes com vendidos, aguardando quitação, ativos, saldo reservado/disponível, esgotados e próximos da expiração; relatório de estoque com saldo, entradas, vendas, consumo e ajustes.

`SP-095 [P]` Exportar relatórios e cadastros operacionais em CSV pelo administrador, respeitando instância, filtros, finalidade e campos necessários. Neutralizar fórmulas e auditar a exportação. Para exportação integral de saída do cliente, disponibilizar procedimento assistido com dicionário de campos; backup MySQL não é entregue como arquivo de consulta cotidiana.

### 12.1 Fórmulas e cuidados de interpretação

| Indicador | Definição |
|---|---|
| Ocupação planejada por profissional | Minutos dos intervalos agendados válidos no período ÷ minutos disponíveis de expediente menos bloqueios. Excluir cancelados/faltas e recortar intervalos no período; sem disponibilidade, mostrar não aplicável. |
| Ocupação por recurso | Mesma fórmula para cada recurso unitário; não somar porcentagens de recursos e pessoas. |
| Taxa de faltas | Agendamentos marcados como faltou ÷ agendamentos elegíveis com início no período, excluindo cancelados; sem denominador, não aplicável. |
| Duração de execução | Fim real − início real; interrupções e retomadas usam segmentos válidos, sem inventar duração quando incompleto. |
| Permanência | Entrega − entrada; atendimento ainda presente é mostrado como aberto. |
| Ticket comercial | Total comercial líquido ÷ comandas confirmadas não canceladas com cobrança positiva. Resgates gratuitos não entram como nova venda positiva. |
| Saldo a receber | Valor devido − recebimentos líquidos por comanda; exportar tutor, vencimento e origem para conciliação. |
| Renovação de pacote | No MVP, lista de nova compra por mesmo animal/serviço após pacote anterior, com janela informada; não classificar automaticamente toda compra como renovação. |

Relatórios usam o instante adequado: venda pela confirmação, recebimento pelo lançamento, serviço pelo fim real e agenda pela data prevista. Estorno aparece no período da compensação e também no histórico da origem. Não recalcular fechamento passado com o resultado de hoje.

## 13. Modelo conceitual e restrições de dados

| Agregado / entidade | Conteúdo mínimo | Relações / restrições |
|---|---|---|
| Configuração da instância | UUID da instância, fuso, estabelecimento, expediente e políticas. | Marcador deve coincidir com catálogo Core; não editável pelo cliente. |
| Tutor | UUID, nome, contatos, situação e dados opcionais. | Um tutor possui vários animais e comandas. |
| Autorizado para retirada | Tutor/animal, nome, contato opcional, evidência da autorização. | Histórico da autorização e entrega preservado. |
| Animal | Tutor principal, nome, espécie, porte, pelagem e dados opcionais. | Nome não é chave; inativação não remove histórico. |
| Cuidado / alerta do animal | Descrição, origem, revisão, vigência e autor. | Ciência vinculada à revisão e ao atendimento. |
| Profissional | Nome, situação, serviços e vínculo opcional de usuário. | Agenda é independente de possuir conta de login. |
| Recurso | Nome, situação, expediente/bloqueios e capacidade unitária. | Combinação de serviços usa no máximo um por atendimento no MVP. |
| Serviço e variante | Nome, preço, duração, porte/pelagem, situação. | Regra de resolução determinística; sem preço/duração implícitos. |
| Agendamento e itens | Animal, tutor, profissional, recurso, intervalos, snapshots, estado e versão. | Trava protege intervalo; uma entrada por agendamento. |
| Atendimento e eventos | Agendamento, animal, checklist, estado, custódia, segmentos de execução e entrega. | Linha do tempo e usuário real de cada ação. |
| Comanda e itens | Tutor opcional sob regra, atendimento opcional, snapshots, desconto, total e estado. | No máximo uma confirmada por atendimento; item é produto/serviço/pacote/resgate. |
| Conta a receber | Comanda, responsável, valor devido, vencimento e situação. | Uma por comanda; saldo reconciliável. |
| Recebimento e estorno | Comanda, meio, valor, caixa, ator e origem compensada. | Um estorno integral por recebimento; sem exceder dívida. |
| Sessão de caixa e lançamentos | Abertura, fechamento, dinheiro contado, suprimento/sangria e referência. | Uma aberta; fechamento imutável. |
| Item de estoque | SKU, tipo, unidade, preço quando aplicável, mínimo e situação. | Custo restrito; tipo/unidade não mudam com saldo/histórico sem procedimento. |
| Movimento de estoque | Item, quantidade assinada, tipo, origem, usuário e instante. | Origem única; saldo protegido e reconciliável. |
| Modelo de pacote | Serviço, quantidade, preço, validade e situação. | Alterações só afetam novas vendas. |
| Pacote vendido | Animal, tutor financeiro, snapshots, comanda, primeira quitação e validade. | Concessão única; não transferível no MVP. |
| Livro de créditos | Pacote, atendimento, tipo, quantidade e origem. | Reserva/consumo/reversão protegidos contra repetição e corrida. |
| Auditoria operacional | Ator, contexto, ação, objeto, alteração segura, instante e correlação. | Sem edição funcional; acesso apenas do administrador local. |
| Outbox de utilização | Evento, tipo, quantidade, ocorrência e estado de envio. | Commit junto à operação e deduplicação no Core. |

IDs de contas/vínculos são externos ao banco operacional. O modelo físico, índices, travas e constraints serão detalhados na etapa técnica; não substituir essas garantias apenas por validação do formulário.

## 14. Telas e comportamento da experiência

| Tela | Tarefa principal |
|---|---|
| Login e seleção de instância | Autenticar, recuperar acesso e escolher apenas vínculos autorizados. |
| Início / hoje | Ver agenda, animais presentes, prontos, atrasos e pendências permitidas. |
| Agenda | Criar, confirmar, reagendar, cancelar, marcar falta e abrir entrada. |
| Tutores | Cadastrar, pesquisar e consultar animais, contatos, débitos e histórico. |
| Animal | Consultar cuidados, histórico, próximos horários e pacotes. |
| Entrada | Conferir serviços, cuidados, pertences e previsão. |
| Painel de atendimento | Alterar etapa, lançar consumo, concluir, avisar manualmente e entregar. |
| Comanda / venda | Itens, pacote elegível, totais, confirmação, recebimentos e comprovante. |
| Pacotes | Modelos, venda, saldo, validade, reservas e histórico. |
| Estoque | Itens, saldos, entradas, consumo, perdas, ajustes e mínimos. |
| Caixa / receber | Abertura, recebimentos, saldos de tutores e fechamento. |
| Relatórios | Filtros, definições, atualização e exportação de administrador. |
| Configurações e equipe | Estabelecimento, usuários, profissionais, recursos, serviços e políticas. |
| Auditoria | Eventos relevantes da própria instância. |

As jornadas prioritárias são “agendar”, “receber animal”, “concluir e receber” e “entregar”. Cada uma deve caber em um fluxo legível no celular, preservando avisos críticos e totais. Lista diária é alternativa à grade de agenda em tela pequena.

Telas precisam tratar vazio, carregamento, erro, cadastros inativos, sessão expirada, instância suspensa, conflito de agenda/versão, estoque insuficiente, pacote indisponível e caixa fechado. Se a resposta de confirmação se perder, a interface consulta o resultado por protocolo antes de oferecer nova tentativa. Não mostrar operação concluída só porque o botão foi pressionado.

Antes de sair de formulário com alterações, avisar sobre perda de dados. Ao expirar a sessão, não expor dados da instância para a próxima pessoa que usar o dispositivo; reautenticação deve restaurar o fluxo apenas se ainda autorizado e sem repetir operações financeiras automaticamente.

## 15. Auditoria e integração com SparkCore

`SP-096 [P]` Auditar cadastro/inativação, mudança de cuidado, agenda, preço/duração excepcionais, etapas, retirada, estoque, pacote, comanda, recebimento, caixa, usuários e exportação. Registrar antes/depois seguro, ator e origem quando relevante, sem duplicar senha ou token.

`SP-097 [P]` Integrar autorização ao SparkCore para todo acesso protegido, incluindo consulta, exportação e tarefas iniciadas pelo usuário. Uma tarefa assíncrona precisa revalidar contexto e estado antes de executar ação protegida; sistema e usuário são identidades distintas.

`SP-098 [P]` Publicar eventos agregados de utilização por outbox. Core recebe contagens e contexto mínimo, sem valores financeiros, nomes de tutores, pets, observações ou itens da venda.

`SP-099 [P]` Quando houver suspensão, impedir novas ações protegidas e mostrar orientação. O estado do formulário no navegador não representa uma reserva ou recebimento concluído. Reativação exige nova sessão, com revalidação dos objetos e saldos.

`SP-100 [P]` Disponibilizar healthcheck e versão de schema para operação da plataforma, sem expor dados de negócio ou segredos. Telemetria atrasada não desfaz atendimento/venda; falha na API de identidade bloqueia operação conforme decisão `D-04`.

## 16. Demandas potenciais e tratamento de escopo

| Demanda | Necessidade a investigar | Recorte proposto |
|---|---|---|
| Cadastro rápido pelo colaborador | Recepção pode ficar parada esperando administrador. | Validar no piloto; perfil atual não ganha esse poder sem revisão da matriz. |
| Profissionais e recursos por etapa | Banho/secagem/tosa podem se sobrepor com pessoas diferentes. | Pós-MVP; reserva conservadora de um profissional/recurso no intervalo inteiro. |
| WhatsApp automático | Confirmação, aviso de retirada e retorno. | Pós-MVP; modelo de mensagem e registro manual no MVP. |
| Leva e traz | Coleta/entrega, rota, motorista e custódia. | Pós-MVP; não confundir contato autorizado com gestão de transporte. |
| Comissões | Repasse por serviço, produto, profissional e estorno. | Pós-MVP, apesar de constar da análise inicial. |
| Devoluções/reembolsos parciais | Produtos devolvidos parcialmente e insatisfação com serviço já realizado. | Fora do MVP proposto; validar frequência antes de abertura comercial. |
| Pacotes mistos e compartilhados | Vários serviços ou animais na mesma contratação. | Pós-MVP; estrutura inicial usa um animal e um serviço. |
| Assinatura recorrente | Renovação/cobrança automática e regras de uso. | Pós-MVP, com contrato e integração de pagamento. |
| Ficha técnica de consumo | Baixa automática de shampoo/condicionador e custo do serviço. | Pós-MVP; consumo real manual vinculado no MVP. |
| Lotes e validade | Rastreabilidade de produto/insumo e perdas por vencimento. | Pós-MVP; o MVP não atende operação que exija esse controle desde o início. |
| Compras e fornecedores | Pedido, entrada por nota, reposição e contas a pagar. | Pós-MVP; entrada manual e fornecedor de referência no MVP. |
| Fiscal e contabilidade | Emissão fiscal, tributos, DRE e integração contábil. | Pós-MVP; cliente mantém processo fiscal externo aplicável. |
| Autoagendamento do tutor | Portal, disponibilidade pública, sinal e cancelamento. | Pós-MVP; usuários do MVP pertencem à equipe. |
| Fotos, anexos e autorização digital | Condição de entrada, acabamento e comprovantes. | Pós-MVP; checklist e autorização textual registrados por equipe no MVP. |
| Multiunidade | Consolidação, compartilhamento de tutor, estoque e usuários. | Pós-MVP; cada instância é estabelecimento isolado. |
| Funcionamento offline | Continuar atendimento sem internet e sincronizar depois. | Pós-MVP; depende de revisão de conflitos, segurança e revogação. |
| Importação inicial | Migrar tutores, animais, catálogo e saldo de outro sistema. | Procedimento assistido controlado; importador genérico não entra no MVP. Piloto precisa definir amostra, validação, duplicidade e reconciliação. |
| Clínica veterinária | Agenda médica, prontuário, vacinação, prescrições e exames. | Produto/escopo separado. |

## 17. Critérios de conclusão do MVP Tuteli

1. Administrador cadastra tutor, dois animais, serviços com variantes, profissional, recurso, produtos, insumos e modelo de pacote.
2. Colaborador opera cadastros existentes, sem obter administração ou custo de estoque por chamada direta.
3. Agenda usa preço/duração corretos e recusa conflito parcial e concorrente de profissional, recurso ou animal.
4. Atendimento registra checklist, ciência de cuidados, etapas, consumo, pronto e retirada autorizada.
5. Venda de produto baixa saldo uma única vez; disputa pela última unidade não gera saldo negativo.
6. Pacote quitado concede uma vez, reserva/consome sem saldo negativo e não gera cobrança duplicada pelo serviço coberto.
7. Venda e recebimentos suportam parcial, mistura de meios e recebimento posterior, com saldos coerentes.
8. Estorno e cancelamento elegível geram compensações, preservam histórico e não alteram caixa fechado.
9. Liberação de retirada com débito exige administrador e deixa a dívida em aberto.
10. Relatórios distinguem venda, execução, pacote e caixa; CSV respeita instância e permissão.
11. Core suspende a instância com sessão aberta; próxima requisição é negada sem afetar outra instância.
12. Reinício, timeout e falha de entrega de telemetria não duplicam operações nem apagam eventos pendentes.
13. Requisitos não funcionais aplicáveis foram demonstrados e o procedimento de backup/restauração foi executado.
14. Limites de devolução, pacote, agenda, cadastro do colaborador e controle fiscal foram validados com os responsáveis pelo piloto; decisões estão registradas antes de ampliar comercialização.
