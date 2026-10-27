# Evidências — F01

Ambiente de referência: Windows 10 Pro 19045, Node.js 24.18.0, npm 11.16, Docker 29.9.2,
MySQL 8.4 (`mysql:8.4`), Edge local para E2E. Data: 2026-10-27. Branch
`002-f01-identidade-contextos` sobre `main` (`e27ba08`); integrada pela PR #8 (`7941c2a`).

## Verificação completa (`npm run verify`)

**16/16 etapas verdes em 172 s**:

| Etapa | Resultado |
|---|---|
| typecheck, lint, format:check | sem erros |
| test:scripts | 37 testes |
| check:adr / gate | 5 ADRs válidas; `gate -- F01` liberada (D-01, D-02, D-04, D-05 confirmadas) |
| check:ds | 29 arquivos da interface; pacote 0.2.0 registrado (sem troca de versão) |
| check:secrets | gitleaks v8.24.2: nenhum segredo (ver "Ajustes" abaixo) |
| check:migrations | migrações publicadas em `origin/main` intactas; `access_projection` incluída; sem `DROP DATABASE` em `server/src` |
| ref:validate | `sparkref` v1/v2 conferido |
| test:unit | 83 testes (vetores RFC 6238, Argon2id e política de senha, AES-GCM, configuração, somente inserção em `security_event`) |
| test:component | 31 testes (login, segundo fator, convite, cadastro de TOTP, administradores, vínculos, contas, recuperação, pendências) |
| test:integration | 117 testes contra MySQL real (23 arquivos) |
| check:upgrade | `spark_core` 2 → 3 e `spark_identity` 1 → 3 a partir de `origin/main` |
| test:contract | 23 testes (respostas reais × `contracts/openapi.yaml` 1.1.0, CSRF, cookie, idempotência) |
| test:e2e | 20 testes (360 e 1280 px; teclado; axe sem violações sérias) |

## CI no GitHub Actions (Linux)

`verify` verde em Ubuntu 24.04 nas quatro jobs (`static`, `secrets`, `test`, `e2e`):

| Execução | Commit | Resultado |
|---|---|---|
| PR #8 (`pull_request`, run 40495573072) | `8ce708c` | sucesso |
| `main` após o merge (`push`, run 40495887864) | `7941c2a` | sucesso |

Com isso a fatia foi marcada `concluida` em `docs/slices.yaml` (T070).

## Quickstart (`quickstart.md`)

| Seção | Como foi validado | Resultado |
|---|---|---|
| §1 Primeiro administrador | `dev:reset`; `bootstrap:admin -- admin@example.test` → link (saída 0); segundo bootstrap → recusa (saída 3). Jornada no navegador em `auth.spec.ts`: convite → senha → TOTP → 10 códigos → painel → sair → login em dois passos | ok |
| §1 limites | 11ª tentativa → `429` com `Retry-After`; inatividade de 30 min e 8 h absolutas → `401`; logout invalida o cookie (`bootstrap-and-login.test.ts`) | ok |
| §2 Equipe | convite com reautenticação, inativar/reativar, último ativo → `409` (`platform-admins.test.ts`, E2E); `test:integration -- last-admin`: 100 rodadas concorrentes, sempre um ativo | ok |
| §3 Sessões de produto e isolamento | `test:integration -- instance-sessions isolation` (14 testes): sessão só em `ref-a_acc`; token de A inválido em B; `inst_*` sem privilégio para criar sessão, desfazer revogação ou logout; credencial de outro produto → `401`; `core-down`: Core sem banco → login `503`, sessões existentes válidas | ok |
| §4 Vínculos | `memberships.test.ts` e `local-members-api.test.ts` (16 testes); E2E `members.spec.ts`: convite, aceite com conta nova, mudança de papel, revogação de vínculo e de convite | ok |
| §5 Recuperação e bloqueio | `recovery-and-block.test.ts` (9 testes); `access-sync-pending`: B inacessível → `{A: aplicada, B: pendente}`, pendência listada e concluída pelo trabalhador; E2E `recovery-block.spec.ts` | ok |
| §6 Verificação completa | `npm run verify` acima | ok |
| `dev:up` | sobe MySQL, reaplica o init (cria `spark_access_writer` em volume de F00), migra, semeia e fica saudável; `/health/live` 200, `/api/v1/system/status` sem sessão 401, interface 200 | ok |
| `access:reconcile -- ref-a` | sem divergência (saída 0); divergências provadas em `reconcile.test.ts` | ok |

## Desempenho (T050, CS-006, R-14)

`perf-access.test.ts`, mesma máquina, MySQL local:

| Medida | p95 | Meta |
|---|---|---|
| Validação de sessão pelo produto (200 consultas) | 0,72 ms | ≤ 10 ms |
| Login de produto pelo Core (50 logins, Argon2id incluído) | 30,96 ms | ≤ 1 s |

## Segurança e auditoria

- **Nenhum segredo vaza** (`no-secrets.test.ts`, CS-008): bootstrap, aceite, TOTP, login em dois
  passos, login de produto, credencial de aplicação e troca de senha; nenhuma senha, segredo
  TOTP, código de recuperação, `INSTANCE_TOKEN`, cookie, token de convite ou de recuperação nos
  logs do pino, em `security_event` ou em respostas que não sejam de exibição única.
- **Isolamento** (constituição I): negativos de rota, corpo, cabeçalho, token cruzado, credencial
  de outro produto, tarefa de sincronização e conexão reaproveitada (200 aquisições alternadas
  conferindo `DATABASE()`).
- **Privilégios reais**: `inst_*` só lê o banco de acesso e só insere logout; `UPDATE … SET
  ended_at = NULL`, `DELETE` de logout, alteração de vínculo ou de estado → erro de privilégio.
- **Concorrência**: último administrador da plataforma e da instância, 100 rodadas cada;
  convites e cadastros de TOTP simultâneos.

## Defeitos encontrados e corrigidos durante a implementação

- **Deadlock em transações com `FOR UPDATE` sobre faixa vazia** seguido de `INSERT` (dois
  convites ou dois cadastros de TOTP ao mesmo tempo): revelado pelo E2E rodando os dois tamanhos
  de tela em paralelo. Corrigido com repetição em deadlock (`server/src/platform/db/retry.ts`)
  nas transações que travam faixas; testes de regressão em `bootstrap-and-login.test.ts`.
- **Limitação de tentativas** com `INSERT IGNORE` + `FOR UPDATE` na mesma transação também
  entrava em deadlock sob falhas concorrentes: a linha passou a ser criada fora da transação.
- **`apply-artifact` de F00** devolvia "senha nova" ao reaplicar porque o provisionador não lê
  `mysql.user`; a existência do usuário passou a vir do próprio `CREATE USER` (erro 1396).
- **`dev:up`** esperava `SAUDAVEL` em `/api/v1/system/status`, que agora exige sessão; passou a
  conferir `/health/live` e a mesma sonda em processo.
- **Logout do produto podia ser desfeito**: `UPDATE (ended_at, end_reason)` permitiria gravar
  `ended_at = NULL`. Trocado por inserção em `access_session_logout` (achado N4 da análise).

## Ajustes de configuração

- CI: `MYSQL_ACCESS_WRITER_PASSWORD` e `SEED_USER_PASSWORD` no `env`; `IDENTITY_SECRET_KEY` gerada
  a cada execução (`openssl rand -base64 32`) — uma chave fixa no workflow era apontada pelo
  gitleaks; `db:seed` antes do E2E (instâncias A e B).
- Trabalhador ganhou `SELECT, INSERT` em `spark_identity` (sincronização e reconciliação da
  projeção, eventos de segurança).

## Limitações e pendências

- **Reautenticação de 5 min no E2E**: os E2E não esperam 5 minutos; o diálogo é coberto pelos
  testes de componente e a regra pela integração.
- **"Último administrador" no E2E**: o banco de desenvolvimento compartilhado tem vários
  administradores; a regra é provada na integração e no teste de componente.
- **Retenção de IP e agente (180 dias)**: só a gravação está em F01; a limpeza chega em F08-Core.
- **Logs de requisição** saem sem método e URL (`req: {}`), comportamento herdado de F00 (o
  filtro de dados sensíveis descarta o objeto). Seguro, mas pobre para diagnóstico: revisar em
  fatia futura com um serializador explícito.
- **Restauração de backup (T-16)**: F01 entrega a reconciliação (`access:reconcile`); o fluxo de
  restauração que a usa chega na fatia de restauração.
- Lacunas do design system 0.2.0 registradas em `docs/design-system-updates.md`.
