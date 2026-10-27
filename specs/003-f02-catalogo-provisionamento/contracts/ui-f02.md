# Contrato de interface — F02

Telas do painel do Core em F02, com o design system 0.2.0 apenas pela API pública (constituição
VIII). Todas em `.sh-theme`, dentro do layout autenticado de F01, pt-BR, 360 px a desktop sem
rolagem horizontal. Menu lateral ganha "Contratantes", "Produtos" e "Instâncias" (esta já existia).

| Rota | Tela | Componentes | Estados obrigatórios |
|---|---|---|---|
| `/contratantes` | Lista com busca (nome, documento, contato), filtro de situação, paginação; colunas nome, documento, situação, produtos, instâncias | `Input type=search`, `Select` (situação), `DataTable`, `Badge`, `Pagination`, `Button` "Novo contratante", `EmptyState` | inicial, carregando (`Skeleton`), vazio (sem cadastro / sem resultado da busca), erro de rede, sem permissão |
| `/contratantes/novo` e `/contratantes/:id/editar` | Formulário: tipo (física/jurídica), nome/razão social, nome de exibição, documento, contato, e-mail, telefone, endereço (seção recolhível) | `RadioGroup` (tipo), `Input`, `FieldMessage`, `Collapse` (endereço), `Select` (UF), `Button`, `Alert` | inicial, inválido por campo (documento com DV errado), enviando, **possíveis homônimos** (`Alert` com `ListGroup` e ação "Continuar mesmo assim"), documento já usado (link para o existente), conflito de versão (recarregar preservando o digitado), sucesso só após 201/200 |
| `/contratantes/:id` | Dados, instâncias vinculadas, ações inativar/reativar | `DescriptionList`, `DataTable` (instâncias), `Badge`, `DropdownButton` (ações), `Dialog` (motivo), `Alert` | carregando, não encontrado, inativação recusada com lista das instâncias ativas, conflito de versão |
| `/produtos` | Catálogo: código, nome, situação, versão implantada, provisionável (ou motivo) | `DataTable`, `Badge`, `Tooltip` (motivo), `EmptyState` | carregando, erro; nenhum campo de SQL, script, URL ou código |
| `/produtos/:code` | Edição de nome e descrição; inativar/reativar com motivo; versões e provisionador somente leitura | `SettingsBlock`, `Input`, `Textarea`, `DescriptionList`, `Dialog`, `Alert` | conflito de versão, inativação com aviso "instâncias existentes não mudam" |
| `/instancias` | Lista com filtros (contratante, produto, estado, período de criação), estado, protocolo da última tarefa, pendência de vigência | `Select` ×3, `Input type=date` ×2, `DataTable`, `Badge` (estado), `Pagination`, `Button` "Nova instância", `EmptyState` | inicial, carregando, vazio, erro; filtros na URL (não são autoridade) |
| `/instancias/nova` | Criação guiada em 3 passos: (1) contratante e produto; (2) nome, slug, fuso, e-mail do administrador inicial, anotações e vigência; (3) resumo sem credenciais e confirmação | `Stepper`, `Select` (contratante ativo, produto provisionável), `Input`, `Select` (fuso), `Textarea`, `DescriptionList` (resumo), `Button`, `Alert` | produto não provisionável (desabilitado com motivo), slug normalizado exibido ao lado do digitado, slug em uso, reservado ou inválido, reautenticação pedida (diálogo de F01), enviando, repetição após timeout reaproveita a mesma `Idempotency-Key` guardada no estado do formulário |
| `/instancias/:id` | Detalhe: contratante, produto, slug, fuso, estado, versão de schema, administrador inicial e situação do convite, vigência e anotações (editáveis), linha do tempo de transições; atalhos para provisionamento e vínculos (F01) | `DescriptionList`, `Badge`, `Tabs` (Resumo, Linha do tempo, Vínculos), `ListGroup` (transições), `Input`, `Textarea`, `Button`, `Alert` | carregando, não encontrado, conflito de versão, pendência de vigência vencida (`Alert` informativo), slug sem edição |
| `/instancias/:id/provisionamento` | Protocolo, estado, etapas com tentativas e duração, erro sanitizado; ações "Repetir" (só em falha e com `retryable`) e "Emitir link do convite inicial" (só em PRONTA) | `StepsBlock` ou `Stepper` (etapas), `Progress`, `Badge`, `DataTable` (tentativas), `Alert`, `Dialog` (motivo da repetição), `OneTimeLinkDialog` (F01) | em andamento (atualiza a cada 2 s, R-17), aguardando repetição (próxima tentativa), concluída, falha repetível, falha que exige procedimento (sem botão "Repetir", com orientação), reautenticação pedida, link exibido uma vez |

Regras:

- **Reautenticação** e **link exibido uma vez** seguem F01 (`ReauthDialog`, `OneTimeLinkDialog`).
- **Sucesso** da solicitação mostra o protocolo e leva ao acompanhamento; o texto deixa claro que a
  instância ficará `PRONTA`, não ativa ("a ativação chega em uma etapa posterior").
- **Erros** mostram a mensagem segura e o `correlationId` em texto pequeno, nunca SQL, nome de
  usuário MySQL ou caminho.
- **Ação perigosa** (inativar contratante ou produto) usa `Button variant="danger"` dentro do
  `Dialog`, com motivo obrigatório e texto que diz o efeito.
- **Datas**: vigência e filtros como datas civis; instantes exibidos em `America/Sao_Paulo` com o
  fuso indicado.
- **Lacunas do design system 0.2.0** (registrar em `docs/design-system-updates.md`): não há campo
  com busca/autocomplete para escolher contratante (usar `Select` com a lista de contratantes
  ativos, paginada no servidor até 200, e busca prévia na tela de contratantes); não há campo de
  data com calendário (usar `Input type=date` nativo); não há linha do tempo (usar `ListGroup`).
