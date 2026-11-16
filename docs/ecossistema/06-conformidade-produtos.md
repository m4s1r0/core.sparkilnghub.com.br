# 06 — Conformidade dos produtos

Situação de cada produto frente aos padrões canônicos, levantada por inspeção do código em
15/11/2026 (Core `f0a3920` + alterações locais da branch `006-tuteli-artefato-provisionador`;
Tuteli `51b152e`, branch `009-ficha-tutor-abas`). Atualizar esta página ao concluir cada ação.
Coluna SparkCore atualizada em 15/11/2026 pela execução de `CONF-01` (branch
`008-hardening-seguranca-core`, `specs/008-endurecimento-seguranca-core`).
Coluna Tuteli atualizada em 15/11/2026 pela execução de `CONF-03`, `CONF-04` e `CONF-05` (branch
`022-navegacao-breadcrumb` do Tuteli, ainda não commitada).

Legenda: ✅ conforme · ⚠️ parcial · ❌ não conforme · — não se aplica · ⏳ planejado.

## Matriz

| Padrão                               | SparkCore                                                                          | Tuteli                                                                                             | Cortivo                                |
| ------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ECO-001` código/prefixo/repositório | ✅                                                                                 | ✅ `sparkpet`                                                                                      | ⏳ `cortivo` (D-COR-01)                |
| `ECO-002` portas                     | ✅ 5273/5173 (doc do hub desatualizada)                                            | ✅ 3001/5175 (doc do hub desatualizada)                                                            | ⏳ 3003/5177                           |
| `ECO-011` stack                      | ✅ Fastify (plataforma)                                                            | ✅ Hono + Kysely                                                                                   | ⏳ Hono + Kysely                       |
| `ECO-015` constituição derivada      | ✅ origem                                                                          | ✅ emenda 1.1.0: III remete a `UI-001..050`; VII = linha de base (`05`), tabela de correspondência com o Core | ⏳ C00                                 |
| `INT-001` credencial por instância   | ✅ SEC-01: Core recusa credencial por produto; CLI `--instance`/`bind`             | ❌ usa credencial por produto (migrar com `bind` antes do deploy do Core)                          | ⏳ C01 já com credencial por instância |
| `INT-002` cliente com timeout        | —                                                                                  | ❌ `fetch` sem timeout em `requireAuth`/login                                                      | ⏳                                     |
| `INT-020` revalidação de conexão     | —                                                                                  | ❌ pool em memória indefinidamente                                                                 | ⏳                                     |
| `INT-030` IP real + limite local     | ✅ `TRUSTED_PROXIES` (SEC-13); `clientIp` IPv4/IPv6 e teto por credencial (SEC-02) | ❌ confia em `X-Forwarded-For`                                                                     | ⏳                                     |
| `INT-040` cookie                     | ✅ sessão opaca                                                                    | ❌ HMAC só assinado, `Lax`, sem `__Host-`                                                          | ⏳                                     |
| `INT-050` validação pela projeção    | ✅ contrato; touch v1.4 devolve `{role, membershipStatus}` (SEC-04)                | ❌ `touch` síncrono por requisição; papel do cookie                                                | ⏳ C01                                 |
| `INT-060` logout na projeção         | ✅ contrato                                                                        | ❌ só apaga cookie                                                                                 | ⏳                                     |
| `INT-070` membros pelo Core          | ✅                                                                                 | ✅                                                                                                 | ⏳                                     |
| `INT-080` utilização                 | ⚠️ F08 em verificação                                                              | ⏳                                                                                                 | ⏳ C09                                 |
| `UI-001` DS 0.5.0                    | ❌ 0.2.1                                                                           | ⚠️ 0.5.0 instalado e registrado (sha256 `58381c2e…`), mas empacotado de alterações não commitadas do DS — reempacotar após `CONF-08` | ⏳ 0.5.0 desde C00                     |
| `UI-001.4` sem sobrescrita do DS     | ✅                                                                                 | ✅ `app.css` sem `!important` nem cor literal; abas via `PainelAbas` (proposta `DS-PROP-06`)       | ⏳                                     |
| `UI-010` shell com menu lateral      | ✅ sidebar colapsável (F08)                                                        | ✅ referência                                                                                      | ⏳                                     |
| `UI-020` breadcrumbs em toda página  | ⚠️ só em `AccountPage` e `MembersPage`                                             | ⚠️ `PageHeader` em todas as páginas, `handle.crumb` em todas as rotas, E2E por rota; níveis de registro (ficha/edição) sem URL própria (spec 022 T009–T012) | ⏳                                     |
| `UI-040` máscaras                    | ❌ Contratante: CPF/CNPJ, telefone e CEP sem máscara                               | ✅ `mask` em CPF, telefone, CEP e 12 campos de valor; exibição por `applyMask`; datas/horas nativas mantidas (decisão em `design-system-updates.md`) | ⏳                                     |
| `UI-050` marca do produto            | ✅                                                                                 | ✅ `favicon.ico` e `apple-touch-icon` com sha256 do manifesto conferido em E2E                     | ⏳                                     |
| `SEC-BASE-*`                         | ✅ 01, 02, 04, 09, 12–16, 21, 22 (parte Core; ver nota)                            | ❌ 02–12, 15, 17–20                                                                                | ⏳ todos em C01                        |

## Ações

| ID        | Produto       | Ação                                                                                                                                                                                                                                                                                                                                                                                           | Depende de                                                                   | Prioridade                                        |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `CONF-01` | Core          | ✅ **Implementada** (15/11/2026, `specs/008-endurecimento-seguranca-core`, aguardando merge e implantação): SEC-01, 02, 04 (touch v1.4), 09, 12 (privilégios só-inserção), 13, 14, 15, 16, 21, 22; contrato `/internal/v1` v1.4 compatível (`contracts/CHANGELOG.md`). Implantação: `docs/operacao/credenciais-aplicacao.md` (vincular credenciais **antes**, `instances:sync-grants` depois). | —                                                                            | **P0 — bloqueia homologação de qualquer produto** |
| `CONF-02` | Tuteli        | Feature de endurecimento (parte Tuteli): migrar `requireAuth` para `INT-050`, cookie `INT-040`, logout `INT-060`, timeout, revalidação, CSRF, cabeçalhos, limites, `onError`, PII, credencial por instância.                                                                                                                                                                                   | CONF-01                                                                      | P0                                                |
| `CONF-03` | Tuteli        | ✅ **Executada** (15/11/2026, Tuteli branch `022-navegacao-breadcrumb`, não commitada): DS 0.4.0 → 0.5.0 registrado em `docs/design-system-updates.md` (com auditoria UI-040 e lacunas); `MaskedInput` → `Input mask`; `mask="currency"` nos valores; `app.css` sem sobrescritas. Pendente: reempacotar o `.tgz` quando o DS commitar a 0.5.0.                                                  | —                                                                            | P1                                                |
| `CONF-04` | Tuteli        | ✅ **Executada** (15/11/2026, mesma branch): `PageHeader` local com `Breadcrumb` do DS e navegação SPA em todas as páginas autenticadas; `handle.crumb` nas rotas; `favicon.ico` e `apple-touch-icon`. Pendente: URL própria para fichas/edições (spec 022 T009–T012).                                                                                                                          | CONF-03                                                                      | P1                                                |
| `CONF-05` | Tuteli        | ✅ **Executada** (15/11/2026, mesma branch): constituição do Tuteli 1.0.1 → 1.1.0 — princípio VII = linha de base de segurança (tema IX do Core) e III com `UI-001/010/020/030/040/050`.                                                                                                                                                                                                        | —                                                                            | P1                                                |
| `CONF-06` | Core          | Atualizar DS 0.2.1 → 0.5.0; máscaras no cadastro de contratante; breadcrumbs nas demais páginas.                                                                                                                                                                                                                                                                                               | —                                                                            | P2                                                |
| `CONF-07` | Hub           | Substituir a tabela §3.4 de `sparklinghub.com.br/docs/escopos/00-diretrizes-compartilhadas.md` por link a [01](./01-registro-de-produtos.md).                                                                                                                                                                                                                                                  | —                                                                            | P2                                                |
| `CONF-08` | Design system | Propostas `DS-PROP-01..05` de [04](./04-padrao-interface.md#ui-070--propostas-ao-design-system) e `DS-PROP-06..08` registradas pelo Tuteli em `docs/design-system-updates.md` (painel de abas, largura do link do breadcrumb, zero na máscara de moeda). Publicar 0.5.0 como `.tgz` (`npm run build && npm pack`) — hoje só há `.tgz` até 0.4.0 no repositório do DS.                                                                                                                                                                                  | —                                                                            | P1 (`.tgz` 0.5.0) / P2 (propostas)                |
| `CONF-09` | Cortivo       | Iniciar já conforme (C00/C01), sem herdar as divergências do Tuteli.                                                                                                                                                                                                                                                                                                                           | CONF-01 para homologar; desenvolvimento pode começar antes contra Core local | P0                                                |

## Riscos observados

- **SEC-BASE nota (Core):** o aviso de bloqueio de conta (SEC-14) é evento `login_bloqueado` +
  alerta de log, sem e-mail (o Core não tem canal); usuários MySQL de instâncias existentes
  criados com host `'%'` precisam de `RENAME USER` pela operação (o provisionador não lê
  `mysql.user`) — passo descrito em `docs/operacao/credenciais-aplicacao.md`.
- **Tuteli × Core v1.4:** a implantação do Tuteli em produção usa credencial por produto; ela
  MUST ser vinculada (`app-credential bind`) antes de implantar o Core v1.4, senão o Tuteli perde
  login, touch, membros e conexão. Livros de lançamento do Tuteli (`caixa_lancamento`,
  `estoque_movimento`, `pacote_credito_lancamento`) ainda não são só-inserção: decisão do
  produto em `CONF-02` (hoje só `auditoria_evento`).

- **Constituição do Core aponta o DS em `UX/design-system`**; a fonte vigente é
  `C:\repos\designsystem.sparklinghub.com.br`. Corrigir por emenda PATCH ao executar `CONF-06`.
- O pacote 0.5.0 do DS está com alterações **não commitadas** no repositório do DS em 15/11/2026.
  Produtos só fixam 0.5.0 depois do commit e do `.tgz` com sha256 registrado (`CONF-08`).
  **Exceção autorizada pelo responsável em 15/11/2026:** o Tuteli fixou um `.tgz` 0.5.0 empacotado
  dessas alterações (sha256 `58381c2ede514b6c2f240f09ea272b8d161b62558cba858f2f734895eb21cf36`);
  ao commitar o DS, reempacotar e atualizar `vendor/` e o registro do Tuteli.
- Ao trocar o `.tgz` do DS num produto, apagar `web/node_modules/.vite`: o Vite do Tuteli calcula o
  hash das dependências pelo `package-lock.json` da raiz, que não lista o DS, e continua servindo a
  versão anterior.
- A projeção de acesso dá ao produto `SELECT` em todo o `_acc`; com `INT-050` o produto passa a
  depender dela em toda requisição — medir latência (meta p95 da diretriz NFR-004 inclui a
  autorização).
