# SparkCore — escopo elaborado do MVP monolítico

**Versão:** 1.0 · **Data:** 25/10/2026 · **Situação:** proposta para especificação.

Aplicar em conjunto com as [diretrizes compartilhadas](./00-diretrizes-compartilhadas.md). Origem dos itens: `[U]` pedido atual, `[H]` análise anterior, `[P]` proposta desta elaboração. Todos os requisitos numerados deste documento integram o MVP proposto, salvo indicação explícita de evolução.

## 1. Visão do produto

O SparkCore é o sistema interno da Sparkling Hub para administrar clientes contratantes, usuários, catálogo de SaaS e ciclo de vida das instâncias. Deve tornar verificável a passagem de uma contratação administrativa para uma instância pronta, segura e rastreável.

O administrador precisa saber **quem contratou, qual produto utiliza, onde estão seus dados, se a instância pode operar, quem tem acesso, se o provisionamento concluiu e como o produto está sendo utilizado**. O painel não deve precisar consultar o conteúdo operacional dos estabelecimentos para responder a essas perguntas.

### 1.1 Objetivos do MVP

1. Cadastrar contratantes e habilitar instâncias de SparkPet, com possibilidade de cadastrar outros produtos futuramente.
2. Criar banco isolado, aplicar versão de schema e preparar o administrador inicial.
3. Ativar, suspender e reativar instâncias, com efeito sobre novas operações e sessões existentes.
4. Administrar acessos internos e vínculos de acesso aos produtos.
5. Consultar acessos, utilização agregada, situação técnica e trilha administrativa.
6. Permitir suporte operacional por evidências, sem usar senhas de clientes ou acesso irrestrito aos dados de negócio.

### 1.2 Indicadores de sucesso do produto

Indicadores de piloto, sem promessa comercial de resultado:

- Contratantes implantados sem execução manual de SQL em cada nova contratação.
- Percentual de provisionamentos concluídos e falhos, tempo até prontidão e causas de falha.
- Nenhuma duplicidade de instância/banco por clique repetido ou retomada de tarefa.
- Suspensão aplicada às requisições iniciadas depois de sua confirmação.
- Percentual de instâncias com uso recente, métricas atualizadas e administrador ativo.
- Recuperação de instância demonstrada em ensaio, sem alteração de outra instância.

## 2. Atores, acesso e limites

### 2.1 Papel funcional

`SC-001 [U]` **Administrador da plataforma:** cadastra clientes contratantes, usuários e novas instâncias; consulta relatórios e executa ações administrativas previstas neste escopo.

Não criar papéis comerciais, suporte, financeiro ou superadministrador adicionais no MVP. A aplicação pode ter identidades técnicas de serviço e trabalhador; elas não são perfis de usuário da interface.

### 2.2 Matriz de permissões

| Ação | Administrador da plataforma | Administrador SparkPet |
|---|---|---|
| Usar o painel SparkCore | Sim | Não |
| Cadastrar contratante ou produto | Sim | Não |
| Solicitar provisionamento | Sim, com MFA | Não |
| Ativar/suspender/reativar instância | Sim, com motivo e MFA nas ações críticas | Não |
| Criar administrador da plataforma | Sim, com reautenticação e auditoria | Não |
| Definir administrador inicial da instância | Sim | Não |
| Consultar vínculos da própria instância | Sim, na administração da plataforma | Sim, pela interface SparkPet |
| Consultar acessos agregados e utilização | Sim | Apenas relatórios locais autorizados no SparkPet |
| Ler tutores, animais, comandas e recebimentos | Sem acesso funcional pelo Core | Sim, em sua instância |
| Exibir credencial MySQL ou senha de usuário | Não | Não |
| Apagar banco/instância pela interface | Não | Não |

### 2.3 Acesso administrativo

`SC-002 [P]` Aplicar login, MFA, convites, expiração, bloqueio e revogação definidos em `COM-007` a `COM-020`. Toda ação deve ser atribuída à pessoa autenticada; contas compartilhadas não atendem à rastreabilidade.

**CA-SC-001:** dado um usuário com papel de administrador apenas no SparkPet, quando tentar usar qualquer endpoint protegido do SparkCore, então o servidor nega o acesso, mesmo que a interface seja chamada diretamente.

## 3. Jornadas principais

### Jornada A — implantar um novo estabelecimento

1. Administrador cadastra o contratante e verifica possível duplicidade.
2. Seleciona SparkPet, informa nome de exibição, identificador de acesso, fuso e e-mail do administrador inicial.
3. Revisa um resumo sem credenciais, confirma e recebe protocolo de provisionamento.
4. Acompanha criação de recursos, migrações, configuração e verificação.
5. Recebe resultado de prontidão ou falha com orientação segura para tratar.
6. Ativa a instância pronta e libera o convite inicial; ativação pode ser uma etapa explícita da tela final, sem presumir contratação automática.
7. Primeiro administrador aceita o vínculo, define ou usa sua conta e acessa apenas a nova instância.

### Jornada B — suspender e reativar

1. Administrador abre a instância, consulta situação e informa motivo da suspensão.
2. Reautentica quando exigido e confirma o impacto no acesso.
3. O estado e a revisão de autorização são persistidos; sessões são revogadas no contexto.
4. Requisições protegidas iniciadas após o commit da suspensão são negadas.
5. Reativação exige prontidão técnica, administrador local válido e novo motivo registrado.
6. Usuários fazem novo login; sessões revogadas não voltam a funcionar.

### Jornada C — investigar baixa utilização

1. Administrador filtra produto, período, contratante e estado.
2. Consulta última autenticação bem-sucedida, usuários ativos, dias com uso e volumes agregados.
3. Verifica se os dados estão atualizados ou se existe atraso de telemetria.
4. Exporta o relatório com filtros e instante da geração, sem dados dos tutores ou vendas individuais.

## 4. Requisitos funcionais

### 4.1 Contratantes

`SC-003 [U]` Cadastrar, consultar, editar e inativar clientes contratantes. Dados mínimos: identificador, nome/razão social, nome de exibição, tipo pessoa física/jurídica, contato responsável, e-mail, telefone opcional, situação, data e ator de criação/alteração.

`SC-004 [P]` CPF/CNPJ e endereço são opcionais no cadastro inicial, salvo exigência comercial definida depois. Quando documento for informado, validar formato e consistência, aplicar normalização e impedir duplicidade indevida. Um contato de e-mail pode ser comum a contratantes diferentes e não prova que sejam a mesma pessoa jurídica.

`SC-005 [P]` Pesquisar por nome, documento e contato; paginar resultados; mostrar produtos e instâncias vinculados. Exibir alertas de possíveis homônimos antes de criar, sem fundir cadastros automaticamente.

`SC-006 [P]` Inativar contratante impede novas instâncias. Se existir instância ativa, exigir suspensão prévia ou uma ação conjunta explicitamente revisada; não deixar acesso em situação ambígua nem executar suspensão em cascata invisível. Proposta do MVP: inativação recusada enquanto houver instância ativa.

**CA-SC-002:** uma edição do nome comercial não altera UUID, banco, rota ou histórico das instâncias existentes.

**CA-SC-003:** ao tentar inativar contratante com instância ativa, o sistema informa quais instâncias impedem a ação e preserva todos os estados.

### 4.2 Catálogo de produtos

`SC-007 [P]` Manter catálogo com código único e imutável, nome, descrição curta, situação, versão implantada, versão de schema suportada e identificador do provisionador. SparkPet é o primeiro produto implementado.

`SC-008 [P]` Permitir inativar produto para novas contratações sem suspender as instâncias existentes. Habilitar o cadastro de um produto não implementa seu adaptador, telas ou operação; outros SaaS precisam de desenvolvimento próprio.

`SC-009 [P]` Bloquear criação de instância se o produto não tiver provisionador, versão e migrações válidas. Interface de administração não permite enviar scripts arbitrários, executáveis ou URLs de código.

### 4.3 Usuários da plataforma e vínculos

`SC-010 [U]` Cadastrar usuários administrativos por convite, consultar estado, nome e e-mail e inativar ou reativar acesso interno. Aplicar a proteção ao último administrador ativo.

`SC-011 [P]` Consultar vínculos de usuários por instância e convidar administrador de estabelecimento, revogar vínculo ou reenviar convite. Para mudar papéis, registrar autor, valor anterior, novo valor e motivo.

`SC-012 [P]` Tratar bloqueio global de conta como ação separada de revogação de vínculo, mostrando as instâncias afetadas antes da confirmação. O bloqueio global é reservado à plataforma e a eventos de segurança ou verificação de identidade; não deve ser usado para retirar colaborador de apenas um cliente.

`SC-013 [P]` Recuperação de conta não exibe senha atual, não gera senha comum e não altera senha diretamente pela tela. A entrega de link de uso único segue `D-07`; recuperação MFA segue procedimento próprio, com identidade verificada.

**CA-SC-004:** se o mesmo usuário tiver acesso às instâncias A e B, revogar A não afeta B nem apaga o histórico do usuário em A.

### 4.4 Cadastro de instância

`SC-014 [U]` Criar instância vinculada a um contratante e um produto, contendo UUID, nome, identificador de acesso, estado, fuso, administrador inicial, versões e metadados de infraestrutura sem segredo exposto.

`SC-015 [P]` Permitir várias instâncias por contratante, inclusive do mesmo produto. Impedir duplicidade do identificador de acesso no escopo do produto, normalizando caracteres e palavras reservadas. Proposta de acesso: rota `/i/<slug>` no SparkPet, com domínio da aplicação configurado; subdomínio próprio de cliente fica fora do MVP.

`SC-016 [P]` O slug é imutável no MVP após o início do provisionamento. Nome de exibição pode mudar. Nome do banco deriva do UUID, sem concatenação de texto livre em comandos administrativos.

`SC-017 [P]` Guardar anotações administrativas e datas opcionais de início/fim de vigência, sem cálculo de cobrança ou suspensão automática. Uma vigência vencida aparece como pendência administrativa.

`SC-018 [P]` Listar e filtrar instâncias por contratante, produto, estado, criação, uso recente e situação técnica. Detalhe apresenta linha do tempo, administrador inicial, histórico de transições, tarefas e versões.

### 4.5 Provisionamento de banco e prontidão

`SC-019 [U]` Criar um banco MySQL operacional exclusivo por instância. O mesmo servidor MySQL pode hospedar vários bancos, conforme capacidade e segurança da infraestrutura.

`SC-020 [P]` Provisionar por tarefa assíncrona persistente, com protocolo, etapas, tentativas, responsável técnico, horário de início/fim e erro sanitizado. A resposta inicial não espera a tarefa inteira terminar.

Etapas mínimas:

1. Validar contratante, produto, slug, autorização e chave de idempotência.
2. Reservar identidade da instância e tarefa com unicidade.
3. Criar banco com parâmetros de charset/collation definidos pela plataforma.
4. Criar credencial operacional exclusiva com acesso limitado àquele banco.
5. Aplicar migrações versionadas do produto e registrar checksums/versões.
6. Criar configurações obrigatórias e marcador de identidade da instância no banco.
7. Preparar vínculo/convite inicial sem liberar uso antes da ativação.
8. Validar conexão com a credencial operacional, versão, integridade mínima e prontidão do produto.
9. Concluir em `PRONTA`, liberando ativação explícita.

`SC-021 [P]` Tornar etapas idempotentes e retomáveis após interrupção. Registrar propriedade dos recursos; encontrar banco com o mesmo nome não autoriza usá-lo sem conferir UUID e tarefa proprietária.

`SC-022 [P]` Uma única tarefa de provisionamento ou migração pode operar a mesma instância por vez. Usar trava com lease/heartbeat e estratégia documentada de recuperação; nova execução não pode disputar com trabalhador ainda válido.

`SC-023 [P]` Permitir consultar erro e solicitar repetição após correção. Não permitir editar SQL, credencial ou status técnico para simular sucesso. Após limite de tentativas, manter falha e pedir ação administrativa.

`SC-024 [P]` Falha na entrega do convite não recria banco. Identidade preparada e pendência de entrega são estados verificáveis e independentes. Uma instância pronta só pode ativar se houver caminho válido para um primeiro administrador: vínculo ativo ou convite inicial válido, com destinatário e canal de entrega definidos. Convite de bootstrap ainda pendente é exceção explícita à exigência de administrador já ativo; não concede acesso de negócio antes da aceitação. A plataforma deve renovar o convite se ele expirar.

**CA-SC-005:** duas solicitações simultâneas para o mesmo identificador produzem no máximo uma instância, uma tarefa efetiva e um banco. Se a mesma chave for reapresentada com conteúdo diferente, retornar conflito.

**CA-SC-006:** dado reinício após a criação do banco e antes da migração, a retomada reconhece o recurso correto, conclui a versão e não perde o histórico de falha.

**CA-SC-007:** se uma migração falhar, login operacional continua bloqueado; o painel informa etapa e protocolo, sem revelar SQL sensível ou senha.

### 4.6 Ativação, suspensão, manutenção e encerramento

`SC-025 [U]` Ativar e desativar instâncias. Neste escopo, desativação corresponde a **suspensão reversível**, com preservação dos dados.

`SC-026 [P]` Registrar estado anterior, novo estado, ator, instante e motivo em toda transição. Exigir reautenticação/MFA nas ações de risco previstas pela política de sessão.

`SC-027 [P]` Suspender bloqueia autenticação e autorização operacional, inclusive leitura, exportação e sessões abertas. Uma página pública mínima informa indisponibilidade e orientação de contato, sem expor motivo financeiro ou detalhes internos.

`SC-028 [P]` Definir o limite transacional da suspensão: requisições autorizadas antes do commit podem concluir uma transação já iniciada; requisições com autorização posterior são negadas. A tela deve explicar esse comportamento; a suspensão não promete abortar comandos MySQL em execução.

`SC-029 [P]` Reativação exige instância tecnicamente pronta, contratante elegível, schema compatível e administrador local ativo; se o bootstrap inicial nunca foi aceito, aplica-se a exceção de convite válido de `SC-024`. Reativação não restaura sessões revogadas, muda senhas ou executa cobranças.

`SC-030 [P]` Estado de manutenção impede operações de negócio durante migração ou restauração. O ingresso e a saída devem ser explícitos, com checagem de saúde ao final e controle para concluir transações em curso antes de intervir no banco.

`SC-031 [P]` Encerrar instância é ação administrativa terminal no MVP, após suspensão e procedimento de saída: registrar motivo, exportação/backup aplicável e política de retenção. Encerrar não executa `DROP DATABASE`. Reabertura de encerrada e eliminação definitiva não fazem parte da interface do MVP.

**CA-SC-008:** uma sessão aberta da instância A deixa de acessar os endpoints depois da suspensão confirmada; a instância B continua operando.

**CA-SC-009:** reativar A permite novo login autorizado e não torna válida a sessão revogada anteriormente.

### 4.7 Acessos e auditoria

`SC-032 [U]` Consultar acessos por produto, instância, usuário, data e resultado. Eventos mínimos: login bem-sucedido, falha de login, logout, expiração, revogação, convite aceito e tentativa negada por suspensão.

`SC-033 [P]` Registrar IP e agente do navegador apenas no registro de segurança, com acesso e retenção controlados. Falha de login com e-mail inexistente não cria conta nem identifica publicamente se o cadastro existe; evitar armazenar senha e limitar exposição de endereço digitado.

`SC-034 [P]` Consultar auditoria administrativa de contratantes, produto, instância, usuário, vínculo, provisionamento, suspensão, exportação e configuração. Campos alterados não incluem segredo, token completo ou conteúdo operacional do pet shop.

`SC-035 [P]` Eventos de auditoria não podem ser editados ou excluídos na interface. A aplicação grava com privilégio restrito e política de retenção; isso não equivale a garantia de imutabilidade contra um administrador de infraestrutura.

**CA-SC-010:** uma mudança de papel informa quem alterou, em qual contexto, de qual valor para qual valor e em que instante, mesmo se a conta envolvida for inativada depois.

### 4.8 Utilização, painel e relatórios

`SC-036 [U]` Elaborar relatórios de utilização por instância e consolidado por produto/período, com paginação, filtros e exportação CSV.

`SC-037 [P]` Receber apenas eventos e agregados definidos pelo contrato. Não consultar bancos operacionais a partir do relatório para obter vendas, dados pessoais ou textos de atendimento.

`SC-038 [P]` Exibir no painel: instâncias por estado, provisionamentos pendentes/falhos, acessos recentes, instâncias sem uso, atraso de telemetria, falhas técnicas e versão incompatível.

`SC-039 [P]` Exibir as métricas abaixo com definição, período e horário de atualização:

| Métrica | Definição no MVP |
|---|---|
| Último acesso | Instante da última autenticação operacional bem-sucedida da instância. Não equivale à última ação de negócio. |
| Usuários ativos no período | Contagem de usuários distintos com ao menos um login bem-sucedido ou ação operacional autenticada elegível no período, excluindo identidades de sistema e suporte. |
| Dias com uso | Quantidade de datas locais com ação operacional autenticada; polling, healthcheck e atualização automática de sessão não contam. |
| Agendamentos criados | Quantidade de eventos de criação deduplicados; cancelamentos são contados separadamente e não apagam o evento original. |
| Atendimentos concluídos | Quantidade de atendimentos que chegaram a pronto para retirada; entregas e interrupções têm contagens separadas. |
| Movimentos comerciais confirmados | Contagem de comandas/vendas confirmadas; cancelamentos aparecem à parte. Não há valor financeiro no relatório Core. |
| Pacotes vendidos e créditos utilizados | Contagens separadas; sem dados do animal ou preço. |
| Instâncias sem uso | Nenhum evento de uso elegível nos últimos 7 ou 30 dias; instância sem telemetria confiável aparece como dados insuficientes. |
| Saúde de utilização | Último lote recebido, atraso em relação ao evento mais recente e indício de lacuna. |

`SC-040 [P]` Relatórios por mês usam intervalo e fuso explícitos. Eventos atrasados atualizam o período de ocorrência; a data de recebimento é mantida para diagnóstico. Reprocessar o mesmo lote não altera totais.

`SC-041 [P]` Exportação respeita filtros, ordenação e autorização; inclui cabeçalho de significado e geração. Neutralizar conteúdo que possa ser interpretado como fórmula em planilha. Arquivo não contém senha, segredo ou dados operacionais do pet shop.

**CA-SC-011:** um lote repetido não aumenta contagem; um lote atrasado atualiza o dia de ocorrência e sinaliza a nova atualização.

**CA-SC-012:** se não chegaram dados de uma instância, o relatório mostra “sem dados suficientes”, sem concluir que a empresa não utiliza o produto.

### 4.9 Operação, backup e versões

`SC-042 [P]` Consultar versão do produto/schema, conectividade, última verificação de saúde e resultado do último backup conhecido. A origem do status de backup deve ser a ferramenta que realmente o executa, sem marcar sucesso apenas por existir uma tarefa agendada.

`SC-043 [P]` Disponibilizar procedimento operacional versionado para backup/restauração de uma instância e do conjunto Core/identidade. Agendamento de cópias pode ser feito na infraestrutura; um console de restauração com um clique fica fora do MVP.

`SC-044 [P]` Entregar executor controlado de migrações por instância, com verificação de versão, backup prévio, janela de manutenção e registro. Rollout em massa, canário automatizado e rollback automático de schema ficam para evolução; o primeiro release precisa pelo menos demonstrar atualização de uma instância anterior de homologação.

`SC-045 [P]` Exibir falhas operacionais acionáveis sem disponibilizar terminal, SQL livre ou gerenciador de arquivos na interface administrativa.

## 5. Máquina de estados da instância

| Estado | Significado | Transições permitidas |
|---|---|---|
| `CADASTRADA` | Metadados reservados, sem execução iniciada. | `PROVISIONANDO`; cancelamento administrativo para `ENCERRADA` se não houver tarefa/recursos em uso. |
| `PROVISIONANDO` | Tarefa exclusiva criando/verificando recursos. | `PRONTA` ou `FALHA_PROVISIONAMENTO`. |
| `FALHA_PROVISIONAMENTO` | Recursos ausentes ou parciais; operação bloqueada. | `PROVISIONANDO` após correção; `ENCERRADA` por procedimento administrativo de saída. |
| `PRONTA` | Banco, schema e acesso inicial preparados; ainda sem uso liberado. | `ATIVA` ou `ENCERRADA`. |
| `ATIVA` | Uso autorizado conforme usuário e vínculo. | `SUSPENSA` ou `MANUTENCAO`. |
| `SUSPENSA` | Bloqueio administrativo reversível. | `ATIVA`, `MANUTENCAO` ou `ENCERRADA`. |
| `MANUTENCAO` | Intervenção técnica com tráfego operacional bloqueado. | Estado anterior seguro (`ATIVA` ou `SUSPENSA`) após verificação; manter manutenção se houver falha. |
| `ENCERRADA` | Sem acesso e sem reabertura pela interface do MVP. | Nenhuma transição funcional do MVP. |

Saúde técnica (`SAUDAVEL`, `DEGRADADA`, `INDISPONIVEL`, `DESCONHECIDA`), estado do convite e estado de cobrança externa são dimensões separadas. Falha de healthcheck não cancela contrato nem suspende automaticamente o cliente.

**RN-SC-001:** não ativar por edição direta de campo; toda ativação executa pré-condições.

**RN-SC-002:** somente uma tarefa estrutural por instância, inclusive migração e restauração.

**RN-SC-003:** não suspender automaticamente por falha de telemetria ou por data de vigência.

**RN-SC-004:** não excluir recurso físico ao inativar contratante, usuário, produto ou instância.

**RN-SC-005:** transferir instância entre contratantes fica fora do MVP, para não mudar propriedade sem processo contratual e técnico.

## 6. Modelo conceitual

| Entidade | Campos e relações principais | Restrições |
|---|---|---|
| Contratante | UUID, nome, documento opcional, contato, situação. | Documento informado com unicidade conforme tipo/política; nome não é chave. |
| Produto | UUID/código, nome, situação, provisionador, versões suportadas. | Código imutável; produto sem adaptador não provisiona. |
| Instância | UUID, contratante, produto, slug, fuso, estado, revisão de autorização, versão. | `(produto, slug)` único; identidade imutável. |
| Recurso de instância | Instância, tipo, identificador do banco, referência de segredo, marcador de propriedade. | Sem senha em texto; recurso pertence a uma única instância. |
| Tarefa administrativa | UUID, instância, tipo, estado, chave idempotente, lease, tentativas, timestamps. | Uma tarefa estrutural ativa por instância. |
| Etapa de tarefa | Tarefa, nome, versão, estado, início/fim, erro sanitizado. | Retomada não perde execuções anteriores. |
| Transição de estado | Instância, estado anterior/novo, motivo, ator, instante. | Append-only no acesso normal da aplicação. |
| Evento de acesso | Conta/contexto quando conhecido, tipo, resultado, instante, dados técnicos mínimos. | Não armazenar segredo nem inferir conta a partir de falha. |
| Evento de utilização | `event_id`, produto, instância, tipo, versão, ocorrência, recebimento, quantidade. | Deduplicação por instância e evento. |
| Agregado diário | Instância, data/fuso, métrica, total, última atualização, qualidade. | Reconstruível a partir de eventos retidos ou checkpoint documentado. |
| Auditoria Core | Ator, objeto, ação, alteração segura, correlação, instante. | Leitura restrita, sem edição funcional. |

Conta, credencial, vínculo, convite e sessão pertencem ao banco de identidade descrito nas diretrizes; não duplicar essas entidades no banco Core.

## 7. Inventário de telas

| Tela | Conteúdo e ações principais |
|---|---|
| Login e segurança | Login, MFA, recuperação e sessão expirada. |
| Visão geral | Estados, falhas, tarefas e uso com atualização explícita. |
| Contratantes | Lista, filtros, cadastro, edição e histórico de vínculos com instâncias. |
| Produtos | Catálogo e situação; detalhes técnicos de versão sem SQL editável. |
| Instâncias | Lista, filtros e criação guiada. |
| Detalhe de instância | Situação, linha do tempo, prontidão, usuários, versão, saúde e ações de estado. |
| Provisionamento | Protocolo, etapas, falha, repetição e pendência de convite. |
| Usuários | Contas administrativas, vínculos de produto, convites e revogações. |
| Acessos e utilização | Filtros, definições, atualização e CSV. |
| Auditoria | Busca por ator, ação, objeto, instância, período e correlação. |

Toda tela de lista precisa de carregamento, vazio, erro, acesso negado e paginação. Botões de ação em andamento não bastam para evitar duplicidade; a proteção também existe no servidor.

## 8. Fora do MVP e demandas posteriores

| Demanda potencial | Encaminhamento |
|---|---|
| Contratação pública, planos pagos, cobrança e inadimplência automática | Evolução de billing, após definir contrato e provedor. |
| Limites comerciais por plano e medição para cobrança | Evolução; os limites técnicos do MVP não são franquias contratadas. |
| Portal do contratante para administrar suas assinaturas | Evolução; Core é interno neste MVP. |
| Suporte com impersonação | Evolução com autorização, consentimento, tempo e trilha específicos. |
| SSO corporativo, provedores sociais e MFA obrigatório em todos os produtos | Evolução de identidade. |
| Domínios personalizados e automação de DNS/certificado por cliente | Evolução de infraestrutura. |
| Autoscaling e servidor dedicado por cliente | Evolução baseada em carga; instância inicial é lógica. |
| Transferência de propriedade e fusão/divisão de clientes | Processo futuro específico. |
| Restauração pela interface e atualização em massa | Evolução após procedimento assistido comprovado. |
| Exclusão definitiva automatizada | Evolução após política contratual, retenção e recuperação. |
| Faturamento e conteúdo operacional dos SaaS no painel central | Fora deste recorte; só com finalidade e autorização explícitas futuras. |

## 9. Critérios de conclusão do MVP SparkCore

1. Criar duas instâncias SparkPet de contratantes distintos, em bancos distintos, e concluir o convite inicial.
2. Demonstrar que credencial operacional de A não consulta B e que usuários não atravessam o contexto por parâmetro.
3. Interromper provisionamento no meio, retomar e provar ausência de banco/vínculo duplicado.
4. Suspender A com sessão aberta, negar a próxima requisição protegida e manter B utilizável.
5. Reativar A, exigir novo login e preservar o histórico.
6. Gerar relatório com acessos e eventos reais de homologação, repetição e atraso de lote tratados corretamente.
7. Demonstrar que telemetria atrasada é marcada e que nenhuma informação de tutor ou comanda é exibida no Core.
8. Proteger o último administrador e auditar alteração de vínculo, estado e exportação.
9. Executar backup e restauração assistida de A em destino isolado sem modificar B; revalidar permissões atuais.
10. Atender aos requisitos não funcionais compartilhados aplicáveis, com limitações conhecidas documentadas.
