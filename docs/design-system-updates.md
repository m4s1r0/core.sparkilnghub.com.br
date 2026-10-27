# Atualizações do design system

Registro obrigatório de cada versão de `@sparkling-hub/design-system` adotada (constituição,
princípio VIII e Governança). `npm run check:ds` falha se o `.tgz` em `vendor/design-system/` não
tiver entrada com seu sha256 aqui.

## 0.2.0 — 2026-10-26

- Versão anterior: nenhuma (primeira adoção).
- Arquivo: `sparkling-hub-design-system-0.2.0.tgz`, sha256
  `a40a9497849a9627c75ef227624aafc5833e9ef06d0ea5572cee3bb8b20c88f1`.
- Motivo: base da interface do SparkCore em F00 (página de situação do sistema). A 0.2.0 traz
  `DataTable`, `Skeleton`, `StatsBlock`, `Heading`, `Text`, `Badge`, `Alert` e `Button`, usados na
  página base.
- Testes executados: testes de componente (`test:component`) e jornada E2E da página base.

## Lacunas observadas na 0.2.0 (propor no design system)

- **Navbar sem itens**: o botão "Menu" (`sh-navbar-toggle`) continua visível e focável mesmo
  sem `items` e em largura de desktop — a regra `@container (min-width:44rem)` perde para
  `.sh-button { display: inline-flex }`. A página base de F00 usa um cabeçalho composto com
  utilidades Tailwind até a correção. Proposta: omitir o botão quando `items` estiver vazio e
  corrigir a precedência da container query.
- **StatsBlock com valores textuais**: em 360 px as três colunas ficam com ~93 px e valores
  longos transbordam (rolagem horizontal da página). F00 usa só valores numéricos. Proposta:
  quebra de linha ou empilhamento abaixo de uma largura mínima.
- **Ordem de camadas CSS**: o pacote declara `theme, components, utilities` sem `base`; um
  consumidor que use o Tailwind com reset cria `base` por último, acima dos componentes. F00
  declara `@layer theme, base, components, utilities;` antes do pacote
  (`web/src/styles/layers.css`). Proposta: o pacote declarar a ordem completa.
- **Tamanho do bundle**: importar qualquer componente traz o editor Tiptap (~750 kB de JS
  minificado na página base). Proposta: entrada separada para o `RichTextEditor`.

## Lacunas observadas na 0.2.0 em F01 (propor no design system)

F01 continua na 0.2.0 (sem troca de versão). As telas de identidade usam só a API pública; as
lacunas abaixo foram contornadas no produto e devem virar propostas no design system:

- **Campo de código de verificação**: não há componente para códigos de 6 dígitos (TOTP). As
  telas usam `Input` com `inputMode="numeric"`, `autoComplete="one-time-code"` e `maxLength`.
  Proposta: `OtpInput` com colagem, teclado numérico e anúncio de erro.
- **Gerador de QR code**: não há componente. A interface acrescentou a dependência
  `qrcode` 1.5 (MIT) em `web/` e gera o QR do URI `otpauth://` como SVG (sem canvas), exibido em
  `<img>` com texto alternativo e com o segredo também em texto. Proposta: componente de QR com
  alternativa textual embutida.
- **`Dialog` sempre exige `trigger`**: diálogos abertos pela aplicação (reautenticação pedida
  pela API, link exibido uma vez, confirmação ao sair sem guardar códigos) recebem um
  `<span hidden />` como trigger e são controlados por `open`. Proposta: `trigger` opcional no
  modo controlado.
- **`Navbar` e `Breadcrumb` só com `href`**: navegam recarregando a SPA. O painel usa cabeçalho
  composto com `NavLink` do roteador; o `Breadcrumb` é usado como está. Proposta: slot de link
  (ou `onNavigate`) para integração com roteadores.
