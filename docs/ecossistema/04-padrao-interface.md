# 04 — Padrão de interface dos SaaS

Todo SaaS do ecossistema tem a **mesma casca** do Tuteli — menu lateral, layout, paleta e
diagramação — com breadcrumbs no topo de cada página, campos com máscara do design system e a
marca aprovada do próprio produto. O usuário que conhece um produto Spark reconhece os demais;
só a assinatura e o vocabulário mudam.

Complementa o princípio VIII da constituição (interface pelo design system) e o
[contrato visual SDD do DS](../../../../../designsystem.sparklinghub.com.br/docs/SDD.md).

## UI-001 — Design system

- `UI-001.1` Versão vigente: **`@sparkling-hub/design-system` 0.5.0** (15/11/2026). Todo produto
  novo começa nela; produtos existentes migram conforme [06](./06-conformidade-produtos.md).
- `UI-001.2` Consumo por `.tgz` em `vendor/design-system/` e `file:` no `web/package.json`. Cada
  troca de versão gera entrada em `docs/design-system-updates.md` do produto (versão anterior,
  nova, sha256, motivo, testes reexecutados) — portão G6.
- `UI-001.3` Entrada da aplicação, nesta ordem: `layers.css` (`@layer theme, base, components,
  utilities;`) → `@sparkling-hub/design-system/styles.css` → `app.css` do produto. Raiz sob
  `<div className="sh-theme min-h-dvh">`.
- `UI-001.4` Somente API pública. Proibido copiar estilos de controles, redefinir tokens ou
  aplicar `!important` sobre classes `sh-*`. **[Tuteli diverge: `app.css` sobrescreve
  `.sh-tab-panel` com `!important` e cores literais.]** Necessidade visual não atendida vira
  proposta ao DS.
- `UI-001.5` Lacunas do DS encontradas na implementação são registradas em
  `docs/design-system-updates.md` do produto, seção "Lacunas observadas".

## UI-010 — Shell da aplicação (layout canônico)

Referência executável: `tuteli/web/src/app/layouts.tsx` e `MenuPrincipal.tsx`. Enquanto o DS não
oferecer `AppShell`/`SideNav` (proposta `DS-PROP-01`), cada produto replica **exatamente** esta
estrutura, trocando apenas a marca e os itens.

```text
┌─────────────── ≥ 1024 px (lg) ───────────────────────────────────────────┐
│ ┌── aside (petróleo, w-56 / w-16) ──┐ ┌── conteúdo (ground) ────────────┐ │
│ │ [assinatura inversa | símbolo]  h16│ │  Breadcrumb                      │ │
│ │──────────────────────────────────── │ │  Heading h1 + ações da página    │ │
│ │ • Hoje                              │ │  ─────────────────────────────── │ │
│ │ • Agenda                            │ │  conteúdo (max-w-5xl, px-4/6,    │ │
│ │ • ...  (filtrado por papel/perfil)  │ │  py-8, gap-6)                    │ │
│ │──────────────────────────────────── │ │                                  │ │
│ │ Sair  ·  Recolher ‹ ›               │ │                                  │ │
│ └─────────────────────────────────────┘ └──────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
┌──── < 1024 px ───────────────────┐
│ [☰]  [assinatura principal]  h16 │  ← header claro; ☰ abre Drawer à esquerda
│ Breadcrumb (compacto)            │
│ conteúdo                         │
└──────────────────────────────────┘
```

| Elemento | Especificação |
| --- | --- |
| Container | `flex h-dvh flex-col overflow-hidden lg:flex-row` |
| Lateral (lg+) | `<aside>` com `bg-[var(--color-sh-dark-surface)]`, borda `--color-sh-dark-line`, largura `w-56` expandida e `w-16` recolhida, transição de largura 220 ms `cubic-bezier(.16,1,.3,1)` |
| Topo da lateral | altura `h-16`; assinatura **inversa** expandida, **símbolo inverso** recolhida |
| Itens | `NavLink` com ícone `lucide-react` 18 px + rótulo; `min-h-11` (44 px); inativo `text-white/70 hover:bg-white/10`; ativo `bg-white/15 text-white font-semibold`; recolhido mostra só ícone com `title` |
| Rodapé da lateral | botão **Sair** e botão **Recolher/Expandir**; endosso “Uma solução da Sparkling Hub” em `text-xs text-white/50` somente quando expandida |
| Celular/tablet | `<header>` claro `h-16` com botão de 44 px "Abrir menu" e assinatura **principal**; `Drawer side="left"` do DS com os mesmos itens em tom claro e "Sair" no rodapé; fecha ao navegar e ao passar para `lg` |
| Conteúdo | `min-h-0 flex-1 overflow-y-auto bg-[var(--color-sh-ground)]` → `<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">` |
| Telas públicas | `PublicLayout`: header claro com assinatura principal, `main` `max-w-md` |
| Persistência | estado recolhido/expandido PODE ser lembrado em `localStorage` (preferência visual, nunca autorização) |

- `UI-010.1` A lista de itens é uma constante `NAV` com `{to, label, Icon, roles, perfis?, end?}`;
  a filtragem por papel/perfil é **apenas apresentação** — o servidor nega de qualquer forma.
- `UI-010.2` Ordem dos itens: operação do dia → cadastros → comercial → gestão → configuração e
  auditoria (administrador). Primeiro item é sempre a visão do dia ("Hoje") quando o produto tiver.
- `UI-010.3` `title` do documento: `<Página> · <Produto>`; `<html lang="pt-BR">`,
  `color-scheme: light`.
- `UI-010.4` Impressão: `aside` e `.nao-imprimir` ocultos (padrão do Tuteli).

## UI-020 — Breadcrumbs

**Toda página autenticada** exibe breadcrumb no topo do conteúdo, acima do `h1`.

- `UI-020.1` Componente `Breadcrumb` do DS, `label="Caminho da página"`. O último item é a página
  atual (`aria-current="page"`, sem link).
- `UI-020.2` Primeiro item: o nome do produto apontando para a visão inicial (`/hoje`). Depois,
  a seção do menu lateral e, quando houver, o registro e a sub-área. Exemplos:
  - `Cortivo › Agenda`
  - `Cortivo › Clientes › João Silva`
  - `Cortivo › Clientes › João Silva › Editar`
  - `Cortivo › Configurações › Serviços`
- `UI-020.3` Rótulos dinâmicos (nome do cliente) vêm do dado já carregado; enquanto carrega,
  mostrar o rótulo genérico ("Cliente"), nunca um UUID.
- `UI-020.4` Navegação sem recarregar a SPA: até o DS aceitar slot de link (proposta
  `DS-PROP-02`, já registrada pelo Core em F01), cada produto usa um componente local
  `<PageHeader breadcrumb={…} title actions>` que **renderiza o `Breadcrumb` do DS** e intercepta
  o clique dos links com `useNavigate` (delegação de evento no `<nav>`, preservando
  ctrl/cmd-clique). Não reimplementar o visual.
- `UI-020.5` Em < 640 px, breadcrumbs com mais de 3 níveis mostram `… › penúltimo › atual`.
- `UI-020.6` Breadcrumbs são declarados na rota (`handle: { crumb }` do React Router) para que a
  spec de cada tela os liste e o teste E2E os verifique.

## UI-030 — Paleta e tipografia

- `UI-030.1` Paleta **única** da família (igual em todos os `paleta.json` aprovados):
  Petróleo `#12343B`, Verde-azulado `#086C73`, Lima `#D9F36D`, Névoa `#F7F9F4`, Grafite `#253238`.
  Na interface, use **somente** os tokens `--color-sh-*` (`ink`, `muted`, `subtle`, `surface`,
  `ground`, `line`, `action`, `action-hover`, `petroleum`, `dark-surface`, `dark-line`, `lime`,
  `lime-soft`, `error`, `error-bg`, `warning-bg`). Nenhum produto define cor própria.
- `UI-030.2` Ação primária: verde-azulado com texto branco. Lima é acento (quadrado da marca,
  destaques sobre petróleo); nunca texto sobre branco/névoa nem fundo de seção.
- `UI-030.3` Tipografia: Manrope (embutida no CSS do DS). Títulos com `Heading`, textos com `Text`.
- `UI-030.4` Tema claro apenas (o DS não tem tema escuro). A lateral escura é composição com
  tokens `dark-*`, não um tema.

## UI-040 — Campos com formatação especial (máscara obrigatória)

Todo campo cujo valor tem formato brasileiro conhecido DEVE usar o **atributo `mask`** do DS 0.5.0
em `Input`, `FloatingInput` ou `InputGroupInput` (ou `MaskedInput`, equivalente). Proibido
`<Input>` livre com `pattern`/`maxLength`, máscara própria ou biblioteca de máscara de terceiros.

| Dado | Preset | Valor bruto enviado à API | Validação no servidor |
| --- | --- | --- | --- |
| CPF | `cpf` | 11 dígitos | dígitos verificadores |
| CNPJ (inclusive alfanumérico) | `cnpj` | 14 caracteres maiúsculos | dígitos verificadores |
| CPF ou CNPJ | `cpfCnpj` | 11 ou 14 | conforme tamanho |
| Telefone fixo ou celular, WhatsApp | `phone` | dígitos com DDD (10–11) | estrutural; normalização E.164 `+55…` no servidor |
| CEP | `cep` | 8 dígitos | estrutural; busca de endereço no `onComplete` (produto) |
| Valor em reais | `currency` | centavos inteiros (`amountCents`) | inteiro ≥ 0, teto do domínio |
| Porcentagem (comissão, desconto) | `percent` (`decimals`, `max`) | número; servidor converte p/ pontos-base | 0–100 |
| Data civil digitada | `date` (ou `SplitDateInput`) | `AAAA-MM-DD` | data civil válida no fuso da instância |
| Hora | `time` | `HH:MM` | faixa válida |
| Cartão / validade | `creditCard` / `cardExpiry` | — | **Não usar** sem especificação de pagamento (fora de todos os MVPs) |

- `UI-040.1` Sempre `label` visível; o placeholder do preset não substitui o rótulo.
- `UI-040.2` Usar `onValueChange` para obter o `raw`; nunca enviar o valor formatado à API.
- `UI-040.3` Máscara é conveniência; o servidor revalida tudo (`AGENTS.md` do DS, item 6).
- `UI-040.4` Exibição (somente leitura) usa as mesmas regras de formatação via `applyMask`, para
  que tabela, ficha e CSV mostrem o mesmo formato. CPF de não administrador chega mascarado do
  servidor (`SEC-BASE-11`); a interface não "desmascara".
- `UI-040.5` Cada spec de tela lista seus campos com máscara (portão G1); revisão de código
  rejeita campo de telefone/documento/CEP/valor sem `mask`.

## UI-050 — Identidade visual por produto

- `UI-050.1` Copiar do pacote aprovado `UX/assets/logomarcas-produtos/final-v1/<produto>/`
  para `web/public/brand/`, **sem editar**, os arquivos: `<produto>-principal.svg`,
  `<produto>-inversa.svg`, `simbolo-principal.svg`, `simbolo-inversa.svg`, `favicon.svg`,
  `favicon.ico`, `apple-touch-icon.png`. Conferir com `manifesto-sha256.txt` (teste automatizado
  compara o sha256 dos arquivos copiados).
- `UI-050.2` Componente `Brand({ collapsed, tone })` igual ao do Tuteli: assinatura completa
  expandida, símbolo recolhido; `tone="inversa"` sobre a lateral petróleo, `principal` sobre
  fundo claro. `alt` = nome do produto.
- `UI-050.3` `index.html`: favicon SVG + ICO (16/32/48) + `apple-touch-icon` 180 px, `<title>`
  `<Produto> — Sparkling Hub` na tela de login.
- `UI-050.4` Tamanhos mínimos do manual: assinatura ≥ 240 px de largura **ou** a altura de 28 px
  na lateral/header (exceção de interface já usada pelo Tuteli, com conferência visual); símbolo
  ≥ 32 px na lateral recolhida. Não recortar a área de proteção do SVG.
- `UI-050.5` Tela de login: assinatura principal centralizada acima do formulário e endosso
  “Uma solução da Sparkling Hub” abaixo, separado da marca.

## UI-060 — Matriz de estados e acessibilidade

Herdada do DS (`docs/SDD.md`) e da constituição: cada tela especifica inicial, vazio, carregando,
inválido, enviando, sucesso (após API), erro de rede/API, conflito (`409`), sem permissão (`403`),
indisponível (`503`) e leitura. Alvo WCAG AA sem alegar certificação; 320–360 px sem rolagem
horizontal; teclado nas tarefas críticas; alternativa em lista para agenda/grades; nada depende só
de cor, hover ou arrastar.

## UI-070 — Propostas ao design system

| ID | Proposta | Motivo |
| --- | --- | --- |
| `DS-PROP-01` | `AppShell` + `SideNav` (lateral colapsável, drawer móvel, itens com ícone, rodapé) | Hoje cada produto copia ~150 linhas do Tuteli; risco de divergência visual. |
| `DS-PROP-02` | `Breadcrumb`/`Nav` com slot de link ou `onNavigate` | Navegar sem recarregar a SPA (lacuna registrada pelo Core em F01). |
| `DS-PROP-03` | `PageHeader` (breadcrumb + título + ações + descrição) | Padronizar o topo de página exigido por `UI-020`. |
| `DS-PROP-04` | `Drawer` aceitar tom escuro ou `className` | Permitir drawer móvel com a mesma cor da lateral. |
| `DS-PROP-05` | Entrada separada para `RichTextEditor` | Tiptap infla o bundle de produtos que não usam editor (aviso > 500 KB no Tuteli). |

Quando `DS-PROP-01..03` forem publicadas, este documento passa a exigir os componentes do DS e os
produtos removem as cópias locais por emenda registrada.
