# Contrato de interface — página base (F00)

Rota `/` da interface do SparkCore. Única tela de F00; em F01 passa para trás do login.
Componentes do `@sparkling-hub/design-system` **0.2.0**, apenas pela API pública (princípio VIII).

## Composição

| Região | Componentes do design system | Conteúdo |
|---|---|---|
| Raiz | contêiner `.sh-theme`; `styles.css` importado em `web/src/main.tsx` | — |
| Cabeçalho | `Navbar` | marca aprovada (SVG de `UX/assets/logomarca/final-v1`, copiado sem alteração), nome "SparkCore" |
| Título | `Heading`, `Text` | "Situação do sistema", versão e ambiente |
| Resumo | `StatsBlock` | estado geral e contagem de componentes por estado |
| Componentes | `DataTable` com coluna de `Badge` | servidor, trabalhador, `spark_core`, `spark_identity`: estado, versão de schema atual/esperada, motivo, horário da verificação |
| Ações | `Button` (secundário) | "Atualizar situação" |
| Rodapé | `Text` | identificador de correlação da última consulta |

Rótulos de estado: `SAUDAVEL` → "Saudável", `DEGRADADA` → "Degradada", `INDISPONIVEL` →
"Indisponível", `DESCONHECIDA` → "Desconhecida". O estado é sempre textual; cor do `Badge` é
reforço, nunca o único sinal.

## Matriz de estados

| Estado | Comportamento | Evidência (E2E/componente) |
|---|---|---|
| Inicial/carregando | `Skeleton` nas regiões de resumo e tabela; região com `aria-busy="true"`; texto "Consultando situação…"; nenhum número exibido | resposta atrasada simulada |
| Sucesso (200) | dados da resposta; horário da consulta; foco permanece onde estava | resposta 200 |
| Indisponível (503) | `Alert` de aviso "Um ou mais componentes estão indisponíveis" + tabela com o corpo recebido | resposta 503 |
| Erro de rede/500 | `Alert` de erro com mensagem segura, correlação e `Button` "Tentar novamente"; nenhum dado anterior apresentado como atual | rede recusada / 500 |
| Atualizando | `Button` em `loading`, dados anteriores visíveis e marcados "atualizando" | clique em atualizar com resposta atrasada |
| Vazio, inválido, conflito, sem permissão, desabilitado | Não se aplicam em F00 (sem formulário nem autorização); sem permissão entra em F01 | — |

## Requisitos de acessibilidade e layout

- 360 px a 1280 px sem rolagem horizontal da página; a `DataTable` usa o modo responsivo do
  design system.
- Ordem de tabulação: cabeçalho → "Atualizar situação" → tabela; foco visível do design system.
- Mudança de estado anunciada por região `role="status"` (sucesso) ou `role="alert"` (erro).
- Nenhuma classe Tailwind dinâmica; nenhuma cor fora dos tokens `--color-sh-*`; nenhum CSS de
  controle copiado para `web/src`.
