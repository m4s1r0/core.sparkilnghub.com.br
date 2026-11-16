# 02 — Arquitetura padrão de um SaaS

Todo SaaS do ecossistema é um **monólito modular próprio** (ADR 0001), com interface React e API
Node.js no mesmo repositório, que delega identidade, ciclo de vida, credenciais e provisionamento
ao SparkCore. Esta página fixa a forma; a regra de integração está em
[03](./03-contrato-saas-core.md).

## ECO-010 — Estrutura do repositório

```text
<produto>.sparklinghub.com.br/
├── api/                      # servidor Node.js + TypeScript
│   ├── src/
│   │   ├── main.ts           # bootstrap: env → verificação do Core → conexão → servidor
│   │   ├── env.ts            # validação de variáveis (falha cedo, sem segredos em log)
│   │   ├── core/             # ÚNICO lugar que fala com o SparkCore (cliente /internal/v1)
│   │   ├── db/               # pool, conexão resolvida, idempotência, auditoria, outbox
│   │   ├── middleware/       # correlação, origem/CSRF, sessão, autenticação, papel, perfil, limites
│   │   ├── modules/<área>/   # domínio: regras puras + repositório + serviço
│   │   ├── routes/           # HTTP fino: valida entrada, chama serviço, envelope de erro
│   │   └── startup/          # checagens de boot
│   └── tests/{unit,integration,contract}/
├── web/                      # SPA React + Vite
│   ├── public/brand/         # SVGs/ICO aprovados do produto (cópia fiel do pacote final-v1)
│   └── src/{app,api,pages,components,styles}/
├── vendor/design-system/     # .tgz fixado do @sparkling-hub/design-system
├── docs/{escopo,modelagem,operacao,seguranca,deliberacoes}/
├── specs/NNN-<fatia>/        # spec.md, plan.md, tasks.md, research.md, data-model.md, contracts/, evidence.md
└── .specify/memory/constitution.md   # derivada da constituição do Core
```

O **artefato de migração** do produto (`manifest.json` + `migrations/*.sql`) vive no Core em
`produtos/<produto>/artifact/` (precedente do Tuteli; ver
[`contracts/migration-artifact.md`](../../contracts/migration-artifact.md)). O repositório do
produto mantém um guarda de deriva do fixture de testes contra esse diretório (padrão
`TUTELI_CORE_ARTIFACT_DIR`).

## ECO-011 — Stack de referência

| Camada | Escolha canônica | Origem |
| --- | --- | --- |
| Runtime | Node.js 22 LTS ou superior (ESM) | Tuteli/DS |
| API HTTP | **Hono** + `@hono/node-server` (versões sem os avisos de `SEC-BASE-09`) | Tuteli |
| Acesso a dados | **Kysely** + `mysql2`; SQL versionado no artefato | Tuteli |
| Banco | MySQL 8.4 (`COM-003`) | Core |
| Interface | React 19, React Router 7, TanStack Query 5, Vite 7, Tailwind CSS 4 | Tuteli/DS |
| Componentes | `@sparkling-hub/design-system` **0.5.0** (última) por `.tgz` fixado | DS |
| Ícones | `lucide-react` (mesma família usada pelo DS) | DS |
| Testes | Vitest (unit/integration/contract), Playwright + axe (E2E), MySQL real | Core/Tuteli |

Desvio da stack é permitido apenas com ADR no produto e registro na seção de complexidade do plano.
Repetir a stack do Tuteli é o caminho padrão porque reaproveita guias, scripts e evidências.

## ECO-012 — Processo e topologia

- `ECO-012.1` Um processo lógico da API por instância no piloto, configurado com
  `SPARKCORE_INSTANCE_SLUG` (precedente do Tuteli). Multi-instância por processo (roteamento por
  host) é decisão de planejamento futura e exige ADR com prova de isolamento de pools.
- `ECO-012.2` Em homologação/produção, a API serve o `web/dist` na mesma origem (como o Core),
  para que cookie, CSP e verificação de origem operem em uma origem só.
- `ECO-012.3` Trabalhadores de segundo plano do produto (outbox, mensagens) usam o mesmo código e
  artefato da API e verificam o estado da instância antes de qualquer efeito novo.

## ECO-013 — Dados

- Banco operacional exclusivo por instância (`COM-005`), sem `USE` entre requisições, pool
  vinculado à identidade e à versão da credencial (ver `INT-020`).
- Invariantes compartilhadas de [diretrizes §7](../escopos/00-diretrizes-compartilhadas.md):
  dinheiro em centavos inteiros (`*_cents BIGINT`), instantes UTC `DATETIME(6)`, datas civis no
  fuso da instância, intervalos `[início, fim)`, livro de lançamentos para saldos, idempotência de
  24 h por ator+instância+operação, versão otimista em cadastros, inativação em vez de exclusão.
- Tabelas obrigatórias em todo artefato de produto: `_spark_instance` (marcador de identidade,
  migração 0001), `idempotencia`, `auditoria` (**só inserção**, `SEC-BASE-12`), `outbox_evento`
  (quando houver telemetria).
- Dados pessoais: coletar o mínimo; documento de identificação (CPF/CNPJ) só quando a regra de
  negócio exigir, cifrado com índice HMAC e mascarado para quem não é administrador
  (`SEC-BASE-11`).

## ECO-014 — Autorização em duas camadas

| Camada | Fonte | Exemplo |
| --- | --- | --- |
| Papel de vínculo | Projeção de acesso (`access_member.role`): `administrador` ou `colaborador` | Somente administrador configura a unidade |
| Perfil operacional local | Banco operacional do produto, associado ao `membership_id` vigente | Cortivo: `recepcao`, `barbeiro`; Tuteli: nenhum |

O perfil local **restringe** o colaborador; nunca amplia além do papel. Vínculo revogado elimina o
acesso mesmo com perfil cadastrado. A verificação acontece no servidor, em middleware
(`requireRole`, `requirePerfil`) e no serviço quando depende do objeto (ex.: "somente os próprios
atendimentos").

## ECO-015 — Constituição do produto

Cada produto DEVE ter `.specify/memory/constitution.md` **derivada** da constituição do Core
(Governança: "adotar esta constituição, ou uma derivada compatível") contendo, no mínimo, os
princípios: I Isolamento; II Identidade e autorização no servidor (D-04); III Contratos
versionados com o Core; IV Idempotência e concorrência; V Verificação com MySQL real; VI
Auditoria e privacidade; VII Monólito modular; VIII Interface pelo design system **e por
[04](./04-padrao-interface.md)**; IX Linha de base de segurança ([05](./05-baseline-seguranca.md)).
O Tuteli já tem constituição própria; os temas IX e o shell de [04] entram por emenda (ver 06).

## ECO-016 — Fluxo Spec Kit e portões

Fluxo por fatia: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-analyze` → `/speckit-implement` → `/speckit-converge`.

Portões **comuns a todo produto**, acrescidos aos da constituição:

| Portão | Quando | Evidência |
| --- | --- | --- |
| G1 Ready | antes de `implement` | Estados de tela (matriz do DS), breadcrumbs da tela, campos com máscara, papéis/perfis, erros, idempotência e concorrência especificados. |
| G2 Isolamento | toda fatia com rota nova | Teste negativo com duas instâncias sintéticas (rota, corpo, cabeçalho, cookie, IDs). |
| G3 Segurança | toda fatia | Itens `SEC-BASE-*` aplicáveis verdes; `npm audit --omit=dev` sem moderado+. |
| G4 Interface | toda fatia com tela | Shell canônico, breadcrumb, 320–360 px sem rolagem horizontal, teclado, axe sem violação séria. |
| G5 Contrato Core | toda fatia que consome `/internal/v1` | Versão do contrato fixada, teste de contrato, compatibilidade com Tuteli preservada. |
| G6 DS | troca de versão do DS | Entrada em `docs/design-system-updates.md` com sha256, motivo e testes reexecutados. |
