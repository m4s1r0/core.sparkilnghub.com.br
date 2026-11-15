# 06 — Conformidade dos produtos

Situação de cada produto frente aos padrões canônicos, levantada por inspeção do código em
15/11/2026 (Core `f0a3920` + alterações locais da branch `006-tuteli-artefato-provisionador`;
Tuteli `51b152e`, branch `009-ficha-tutor-abas`). Atualizar esta página ao concluir cada ação.

Legenda: ✅ conforme · ⚠️ parcial · ❌ não conforme · — não se aplica · ⏳ planejado.

## Matriz

| Padrão | SparkCore | Tuteli | Cortivo |
| --- | --- | --- | --- |
| `ECO-001` código/prefixo/repositório | ✅ | ✅ `sparkpet` | ⏳ `cortivo` (D-COR-01) |
| `ECO-002` portas | ✅ 5273/5173 (doc do hub desatualizada) | ✅ 3001/5175 (doc do hub desatualizada) | ⏳ 3003/5177 |
| `ECO-011` stack | ✅ Fastify (plataforma) | ✅ Hono + Kysely | ⏳ Hono + Kysely |
| `ECO-015` constituição derivada | ✅ origem | ⚠️ falta princípio IX (segurança) e shell `UI-010/020` | ⏳ C00 |
| `INT-001` credencial por instância | ❌ SEC-01 | ❌ usa credencial por produto | ⏳ C01 já com credencial por instância |
| `INT-002` cliente com timeout | — | ❌ `fetch` sem timeout em `requireAuth`/login | ⏳ |
| `INT-020` revalidação de conexão | — | ❌ pool em memória indefinidamente | ⏳ |
| `INT-030` IP real + limite local | ⚠️ sem `trustProxy` (SEC-13) | ❌ confia em `X-Forwarded-For` | ⏳ |
| `INT-040` cookie | ✅ sessão opaca | ❌ HMAC só assinado, `Lax`, sem `__Host-` | ⏳ |
| `INT-050` validação pela projeção | ✅ contrato | ❌ `touch` síncrono por requisição; papel do cookie | ⏳ C01 |
| `INT-060` logout na projeção | ✅ contrato | ❌ só apaga cookie | ⏳ |
| `INT-070` membros pelo Core | ✅ | ✅ | ⏳ |
| `INT-080` utilização | ⚠️ F08 em verificação | ⏳ | ⏳ C09 |
| `UI-001` DS 0.5.0 | ❌ 0.2.1 | ❌ 0.4.0 (`.tgz` 0.2.1/0.3.0/0.4.0 em `vendor/`) | ⏳ 0.5.0 desde C00 |
| `UI-001.4` sem sobrescrita do DS | ✅ | ❌ `app.css` com `!important` em `.sh-tab-panel` e cores literais | ⏳ |
| `UI-010` shell com menu lateral | ✅ sidebar colapsável (F08) | ✅ referência | ⏳ |
| `UI-020` breadcrumbs em toda página | ⚠️ só em `AccountPage` e `MembersPage` | ❌ nenhuma página | ⏳ |
| `UI-040` máscaras | ❌ Contratante: CPF/CNPJ, telefone e CEP sem máscara | ⚠️ `MaskedInput` só em `TutorFormulario`; conferir telas de configuração, equipe e caixa (valores) | ⏳ |
| `UI-050` marca do produto | ✅ | ✅ (falta `favicon.ico`/`apple-touch-icon`) | ⏳ |
| `SEC-BASE-*` | ❌ 01, 02, 04, 09?, 12–16, 21, 22 | ❌ 02–12, 15, 17–20 | ⏳ todos em C01 |

## Ações

| ID | Produto | Ação | Depende de | Prioridade |
| --- | --- | --- | --- | --- |
| `CONF-01` | Core | Feature de endurecimento (parte Core do prompt de 15/11): SEC-01, 02, 04 (touch v1.4), 12 (privilégios só-inserção), 13, 14, 15, 16, 21, 22; contrato `/internal/v1` v1.4 compatível. | — | **P0 — bloqueia homologação de qualquer produto** |
| `CONF-02` | Tuteli | Feature de endurecimento (parte Tuteli): migrar `requireAuth` para `INT-050`, cookie `INT-040`, logout `INT-060`, timeout, revalidação, CSRF, cabeçalhos, limites, `onError`, PII, credencial por instância. | CONF-01 | P0 |
| `CONF-03` | Tuteli | Atualizar DS 0.4.0 → 0.5.0 (registrar em `design-system-updates.md`), trocar `MaskedInput` por `Input mask` onde convier e auditar todos os campos especiais (`UI-040`); remover sobrescritas de `app.css` propondo ajuste no DS. | — | P1 |
| `CONF-04` | Tuteli | Breadcrumbs em todas as páginas autenticadas (`UI-020`) com `PageHeader` local; `favicon.ico` e `apple-touch-icon`. | CONF-03 | P1 |
| `CONF-05` | Tuteli | Emenda da constituição: princípio IX (linha de base de segurança) e referência a `UI-010/020/040`. | — | P1 |
| `CONF-06` | Core | Atualizar DS 0.2.1 → 0.5.0; máscaras no cadastro de contratante; breadcrumbs nas demais páginas. | — | P2 |
| `CONF-07` | Hub | Substituir a tabela §3.4 de `sparklinghub.com.br/docs/escopos/00-diretrizes-compartilhadas.md` por link a [01](./01-registro-de-produtos.md). | — | P2 |
| `CONF-08` | Design system | Propostas `DS-PROP-01..05` de [04](./04-padrao-interface.md#ui-070--propostas-ao-design-system). Publicar 0.5.0 como `.tgz` (`npm run build && npm pack`) — hoje só há `.tgz` até 0.4.0 no repositório do DS. | — | P1 (`.tgz` 0.5.0) / P2 (propostas) |
| `CONF-09` | Cortivo | Iniciar já conforme (C00/C01), sem herdar as divergências do Tuteli. | CONF-01 para homologar; desenvolvimento pode começar antes contra Core local | P0 |

## Riscos observados

- **Constituição do Core aponta o DS em `UX/design-system`**; a fonte vigente é
  `C:\repos\designsystem.sparklinghub.com.br`. Corrigir por emenda PATCH ao executar `CONF-06`.
- O pacote 0.5.0 do DS está com alterações **não commitadas** no repositório do DS em 15/11/2026.
  Produtos só fixam 0.5.0 depois do commit e do `.tgz` com sha256 registrado (`CONF-08`).
- A projeção de acesso dá ao produto `SELECT` em todo o `_acc`; com `INT-050` o produto passa a
  depender dela em toda requisição — medir latência (meta p95 da diretriz NFR-004 inclui a
  autorização).
