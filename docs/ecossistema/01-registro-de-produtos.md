# 01 — Registro de produtos

Fonte única de nome, código técnico, prefixo de banco, repositório, portas locais e marca de cada
produto do ecossistema. **Substitui** a tabela de portas de
`sparklinghub.com.br/docs/escopos/00-diretrizes-compartilhadas.md` §3.4, que estava desatualizada
(ver [Correções](#correções-em-relação-às-diretrizes-do-hub)).

## ECO-001 — Produtos

| Nome comercial | Código técnico (`product.code`) | Prefixo de banco | Repositório | Marca (pasta em `UX/assets/logomarcas-produtos/final-v1/`) | Situação |
| --- | --- | --- | --- | --- | --- |
| Spark Core | — (plataforma) | `spark_core`, `spark_identity` | `core/core.sparkilnghub.com.br` | `spark-core/` | Em implementação (F00–F03 entregues; F08 em verificação) |
| *(referência sintética)* | `sparkref` | `sparkref_` | dentro do Core | — | Somente desenvolvimento/homologação |
| Tuteli | `sparkpet` | `sparkpet_` | `tuteli/tuteli.sparklinghub.com.br` | `tuteli/` | Em implementação (specs 001–021) |
| Paginor | `sparkcms` *(a confirmar no C00)* | `sparkcms_` | `cms/cms.sparklinghub.com.br` | `paginor/` | Escopo inicial |
| Cortivo | `cortivo` *(proposto, D-COR-01)* | `cortivo_` | `cortivo/cortivo.sparklinghub.com.br` | `cortivo/` | Escopo e modelagem preliminar |
| Forneli | a definir | a definir | a criar | `forneli/` | Somente marca |
| Reparum | a definir | a definir | a criar | `reparum/` | Somente marca |
| Pulsari | a definir | a definir | a criar | `pulsari/` | Somente marca |
| Sutila | a definir | a definir | a criar | `sutila/` | Somente marca |

Regras:

1. `ECO-001.1` O código técnico é **imutável** (`SC-007`), ascii `^[a-z][a-z0-9]{2,15}$`, e não
   precisa acompanhar o nome comercial. Renomear o produto muda só `product.name` por migração do
   catálogo (precedente: SparkPet → Tuteli manteve `sparkpet`).
2. `ECO-001.2` Produto novo DEVE preferir código igual ao nome comercial em minúsculas (ex.:
   `cortivo`), salvo se já houver registro anterior no ambiente-alvo — nesse caso preserva-se o
   existente.
3. `ECO-001.3` `databasePrefix` do artefato = `<code>_`. O banco de acesso é
   `<code>_<uuid-sem-hífen>_acc`, criado pelo Core.
4. `ECO-001.4` Grafia em texto exatamente como na coluna "Nome comercial". Logomarcas sempre a
   partir dos SVGs aprovados, nunca redigitadas.

## ECO-002 — Portas de desenvolvimento local

Valores **efetivamente usados** nos repositórios em 15/11/2026, mais reservas para os próximos.
Cada produto DEVE declarar estes valores como padrão no próprio `.env.example` e no
`vite.config.ts` (com `strictPort: true`).

| Sistema | API (`PORT`/`HTTP_PORT`) | Interface Vite (`WEB_PORT`) | Outros |
| --- | --- | --- | --- |
| SparkCore | **5273** | 5173 | MySQL 8.4 do ecossistema em **3307** (único servidor; bancos de instância são provisionados nele) |
| Tuteli | 3001 | **5175** | — |
| Paginor | 3002 | **5176** | — |
| Cortivo | **3003** | **5177** | — |
| Forneli | 3004 | 5178 | — |
| *(design system — catálogo/E2E)* | — | 5179 | Reservada pelo `playwright.config.ts` do DS |
| Reparum | 3005 | 5180 | — |
| Pulsari | 3006 | 5181 | — |
| Sutila | 3007 | 5182 | — |

Regras:

1. `ECO-002.1` Nenhum produto usa `3000`, `5173`, `5273` ou `3307`.
2. `ECO-002.2` `SPARKCORE_INTERNAL_URL` em desenvolvimento é `http://127.0.0.1:5273`.
3. `ECO-002.3` A reserva de um produto novo acontece **neste arquivo**, no mesmo PR do Core que
   cadastra o produto no catálogo, antes da primeira issue de implementação do produto.
4. `ECO-002.4` Sites estáticos sem porta TCP local ficam fora da tabela.

## Correções em relação às diretrizes do hub

| Item | Diretrizes do hub (§3.4) | Realidade em 15/11/2026 | Decisão canônica |
| --- | --- | --- | --- |
| API do SparkCore | 3000 | `HTTP_PORT=5273` no `.env.example` do Core | **5273** |
| Vite do Tuteli | 5174 | `WEB_PORT=5175` no `.env.example` e `vite.config.ts` do Tuteli | **5175** |
| Vite do SparkCMS/Paginor | 5175 | Colide com o Tuteli | **5176** |
| "Próximo produto" | 3003/5176 | — | Cortivo **3003/5177** |

A tabela do hub DEVERIA ser substituída por um link para este arquivo na próxima revisão das
diretrizes (pendência registrada em [06](./06-conformidade-produtos.md)).

## ECO-003 — Endosso e descritor

| Produto | Descritor de trabalho | Endosso em páginas públicas |
| --- | --- | --- |
| Spark Core | Núcleo de administração da plataforma Sparkling Hub | Nenhum (uso interno) |
| Tuteli | Gestão para pet shops e banho e tosa | “Uma solução da Sparkling Hub” |
| Paginor | Gestão e publicação de conteúdo para sites | “Uma solução da Sparkling Hub” |
| Cortivo | Gestão para barbearias | “Uma solução da Sparkling Hub” |
| Forneli | Gestão para confeitaria e encomendas | “Uma solução da Sparkling Hub” |
| Reparum | Gestão para oficinas mecânicas | “Uma solução da Sparkling Hub” |
| Pulsari | Gestão para estúdios de atividades físicas | “Uma solução da Sparkling Hub” |
| Sutila | Gestão para salões de beleza | “Uma solução da Sparkling Hub” |

O endosso fica fora da área de proteção da marca. Dentro do aplicativo autenticado, o endosso
aparece apenas na tela de login e no rodapé do menu lateral (ver [04](./04-padrao-interface.md)).
