# SparkCore e SparkPet — escopos para desenvolvimento orientado por especificações

**Versão:** 1.0 · **Data:** 25/10/2026 · **Situação:** proposta detalhada para especificação e planejamento.

Este conjunto transforma o pedido de produto em requisitos verificáveis para iniciar o trabalho com o SDD Toolkit. Não constitui implementação, homologação comercial, orçamento ou compromisso de prazo. As propostas adicionais estão identificadas; não se presume que tenham sido previamente aprovadas.

## Documentos e ordem de leitura

| Ordem | Documento | Conteúdo |
|---|---|---|
| 1 | [Diretrizes compartilhadas](./00-diretrizes-compartilhadas.md) | Vocabulário, arquitetura, autenticação, isolamento, integração, segurança, requisitos não funcionais e decisões. |
| 2 | [SparkCore — MVP](./01-sparkcore-mvp.md) | Administração da plataforma, clientes contratantes, usuários, provisionamento, suspensão, acessos, utilização e operação. |
| 3 | [SparkPet — MVP](./02-sparkpet-mvp.md) | Tutores e animais, agenda, atendimento, serviços e vendas, estoque, pacotes, recebimentos e relatórios. |
| 4 | [Plano de preparação para o SDD Toolkit](./03-plano-sdd.md) | Fatias de desenvolvimento, dependências, cenários críticos, critérios de prontidão e instrução de entrada. |

As referências locais anteriores são [PRODUCT.md](../../PRODUCT.md), [briefing dos protótipos](../../UX/prompt-claude-code-prototipos.md) e [catálogo do site](../../UX/webdesign/site/shared/data/saas.ts). Esses arquivos descrevem o site institucional e não têm sua tecnologia ou suas restrições editoriais transplantadas para os sistemas de gestão. Eles permanecem inalterados.

Também foi consultada a conversa **“Elabore escopos SaaS para pequenos”**, de 23/10/2026, que originou a família Spark. Para SparkPet, ela estabeleceu o recorte de estética animal, cadastro de tutor e pets, cuidados informados, agenda, checklist, etapas, pacotes, retirada e caixa. A nova solicitação coloca vendas de produtos e insumos dentro do MVP. Comissões, mencionadas na análise anterior, ficam propostas para uma etapa posterior para conter o tamanho da primeira entrega.

## Resultado pretendido

**SparkCore:** um administrador da Sparkling Hub cadastra uma empresa contratante, cria uma instância de SparkPet com banco operacional próprio, habilita o primeiro administrador do estabelecimento, acompanha a implantação, suspende ou reativa o acesso e consulta utilização, acessos e trilha administrativa.

**SparkPet:** o estabelecimento cadastra um tutor e seus animais, configura serviços e disponibilidade, agenda sem conflito, recebe o animal com cuidados visíveis, executa e acompanha o atendimento, registra produtos ou serviços na comanda, recebe valores, controla estoque e pacotes e acompanha a operação.

## Síntese do recorte

| Dimensão | Proposta do MVP |
|---|---|
| Arquitetura | Dois produtos em monólitos modulares: SparkCore e SparkPet. Identidade é um módulo do SparkCore, sem um terceiro serviço independente. |
| Interface | React + TypeScript + Tailwind CSS em ambos. |
| Servidor | Node.js; TypeScript também no servidor como recomendação de padronização. |
| Persistência | MySQL: cadastro da plataforma, identidade central e um banco operacional por instância. |
| Unidade comercial | Uma instância de produto corresponde a um estabelecimento; várias instâncias podem pertencer ao mesmo contratante. |
| SparkCore — papel | Administrador da plataforma. |
| SparkPet — papéis | Administrador do estabelecimento e Colaborador, restritos à respectiva instância. |
| Operação inicial | Português do Brasil, BRL, uso online em computador, tablet e celular. |
| Cobrança SaaS | Controle administrativo de vigência e suspensão; contratação, emissão de mensalidade e bloqueio por inadimplência automáticos ficam fora. |
| SparkPet — público | Pet shops com banho e tosa e vendas simples de produtos; sem clínica veterinária. |

## Como interpretar a especificação

- **[U] Confirmado pelo pedido atual:** requisito informado pelo usuário.
- **[H] Herdado:** requisito recuperado da análise anterior ou dos artefatos existentes.
- **[P] Proposto:** detalhamento, regra ou ampliação recomendada nesta elaboração.
- **MVP:** necessário para a primeira versão utilizável descrita nestes documentos. Um item proposto dentro do MVP continua sendo uma recomendação de escopo.
- **Pós-MVP:** necessidade identificada e deliberadamente adiada.
- **Bloqueador:** decisão que precisa ser resolvida antes da implementação ou da entrada em produção indicada; não impede todo trabalho independente.

Os identificadores `COM-*`, `SC-*`, `SP-*`, `RN-*`, `CA-*` e `NFR-*` são estáveis para rastreabilidade. Os critérios descritos complementam o texto do requisito; não substituem testes de falha e autorização.

## Limites de prontidão

Há conteúdo suficiente para iniciar descoberta técnica, cenários, modelagem e plano de implementação. Antes de programar o núcleo de identidade e provisionamento, confirmar as decisões de arquitetura `D-01` a `D-04`. Antes de produção, resolver hospedagem e privilégios MySQL, canal de entrega de convites, retenção e recuperação.

Não foram encontradas skills do **SDD Toolkit** no catálogo ativo nem nas pastas locais de skills consultadas. Portanto, o pacote usa Markdown e conceitos independentes de ferramenta. Não inventa comandos, nomes de skills ou caminhos internos do Toolkit. A instalação efetivamente usada deverá fornecer a convenção final de execução.

## Demandas potenciais identificadas

| Demanda | Tratamento proposto | Motivo |
|---|---|---|
| Provisionamento com falha ou repetido | MVP SparkCore | Criar banco não garante uma instância pronta; é necessário recuperar etapas e evitar duplicidade. |
| Sessão aberta durante suspensão | MVP compartilhado | O bloqueio precisa alcançar o acesso já autenticado. |
| Convites, recuperação e saída de funcionário | MVP compartilhado | Contas e permissões têm ciclo de vida próprio. |
| Capacidade por tempo, profissional e recurso | MVP SparkPet, em modelo conservador | Uma agenda apenas por horário permite sobreposição e planejamento irreal. |
| Cuidados, pertences e pessoa autorizada a retirar | MVP SparkPet | O atendimento precisa preservar contexto e rastreabilidade até a entrega. |
| Duplo uso de pacote e última unidade em estoque | MVP SparkPet | Concorrência pode gerar saldo negativo e venda duplicada. |
| Pagamento parcial, fiado e fechamento | MVP SparkPet, com limites explícitos | Execução do serviço, venda e recebimento não ocorrem necessariamente juntos. |
| Recorrência | Lista de retornos no MVP; automação posterior | Apoia o retorno sem criar dependência inicial de mensageria. |
| WhatsApp automático, comissões e leva e traz | Pós-MVP | Exigem contratos, regras e integrações adicionais. |
| Continuidade e exportação | MVP operacional | Backup sem restauração verificada não demonstra recuperabilidade. |

Essas demandas são hipóteses de produto e engenharia; não representam pesquisa nova com estabelecimentos nem evidência de disposição para pagar.
