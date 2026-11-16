# Changelog dos contratos

Mudanças compatíveis mantêm a versão maior e são registradas aqui; incompatíveis exigem `/v2`
(conventions.md §1).

## v1.4 — 2026-11-15 (endurecimento de segurança, compatível)

Auditoria de 15/11/2026; linha de base `docs/ecossistema/05-baseline-seguranca.md`;
`specs/008-endurecimento-seguranca-core/contracts/internal-v1.4.md`. Ordem de implantação: vincular
as credenciais (abaixo) → implantar o Core → implantar os produtos v1.4.

- **Credencial por instância (SEC-01, mudança de comportamento):** credenciais com escopo
  `connection`, `sessions` ou `members` MUST estar vinculadas a uma instância; credencial por
  produto nesses escopos → `401 AUTH_APP_CREDENTIAL_INVALID` (evento `credencial_aplicacao/negado`).
  Slug de outra instância → resposta idêntica à de slug inexistente na mesma rota (evento
  `instancia_divergente`). Migração sem parada: `npm run app-credential -- bind <id> --instance
<slug|uuid>` antes de implantar o Core (segredo inalterado). `utilizacao` não muda.
- `POST /internal/v1/instances/{slug}/sessions/touch` (SEC-04, compatível): `200 { role,
membershipStatus }` em vez de `204`. Produtos v1.3 que conferem só `2xx` seguem funcionando.
- `POST /internal/v1/instances/{slug}/sessions` (SEC-02): `clientIp` MUST ser IPv4/IPv6 (`422`
  senão); teto de 300 falhas/15 min por credencial (`429`); atraso progressivo por (e-mail,
  credencial+IP) a partir da 5ª falha; bloqueio total do e-mail só com 100 falhas/1 h (SEC-14).
- `GET /internal/v1/instances/{slug}/connection` (SEC-15, compatível): ganha `tls`
  (`required` | `disabled`); com `required` o produto MUST abrir o pool com TLS.
- Manifesto do artefato (compatível, `formatVersion` 1): `appendOnlyTables` opcional (SEC-12).
- `/api/v1` (SEC-14): mesmas regras de atraso progressivo e volume no login do painel; evento
  `login_bloqueado` ao titular. Todas as respostas trazem os cabeçalhos de segurança, HSTS fora
  do desenvolvimento e `Cache-Control: no-store` em `/api` e `/internal` (SEC-22).

## v1.3.3 — 2026-11-13

- `GET /api/v1/instances/{id}/migration/plan` (novo, compatível): migrações do artefato vigente
  acima da versão de schema da instância, para o painel mostrar o que será aplicado antes de
  agendar a tarefa.
- `MigrationTask` (compatível): ganha `migrations` (versão e nome de cada migração aplicada pela
  tarefa) e `fromVersion` passa a ser preenchida nas tarefas novas. A versão de origem é gravada
  em `admin_task.from_version` (migração `spark_core` 0009); tarefas anteriores seguem com
  `fromVersion` nula e `migrations` vazia.
- Situação por migração e pendentes pelo histórico real (compatível, mesma versão): cada item
  de `migrations` e de `pending` traz `status` (`pendente`, `em_execucao`, `aplicada`, `falhou`,
  `interrompida`), lido de `_spark_schema_history` do banco do produto com a credencial
  operacional. O plano passa a calcular a versão efetiva por esse histórico (`currentVersion`),
  expõe a registrada no Core (`recordedVersion`), a origem (`source`), o motivo quando o histórico
  não é legível (`historyUnavailable`) e o bloqueio (`blocked`). `POST .../migration` recusa com
  `409 SCHEMA_HISTORY_BLOCKED` quando o histórico impede aplicar, e grava como `fromVersion` a
  versão efetiva do banco do produto.

## v1.3.2 — 2026-11-07

- `GET /internal/v1/instances/{slug}/members` e `GET /api/v1/instances/{id}/members`
  (compatível): cada vínculo ganha `accountId`, nulo em convite pendente. Mesmos escopos, sem
  migração. O produto já recebe `account.id` no login e o usa como autor na própria auditoria; sem
  o mesmo identificador na listagem de vínculos, nenhum cadastro do produto podia referenciar um
  usuário de forma validada nem ser correlacionado com a trilha. `accountId` é identificador
  opaco, e não altera a regra de e-mail mascarado: o administrador local continua vendo
  `emailMasked` apenas de convites pendentes.

## v1.3.1 — 2026-11-06

- `GET /internal/v1/instances/{slug}/connection` (compatível): a resposta ganha `displayName` e
  `timezone` da instância, agnósticos de produto; mesmo escopo `connection`, sem migração.

## v1.3 — 2026-10-27

- `openapi.yaml` 1.3.0 (compatível): ciclo e operação da instância (`/api/v1/instances/{id}/
activate`, `/suspend`, `/reactivate`, `/maintenance/enter`, `/maintenance/exit`, `/terminate`,
  `/health` GET+POST, `/migration` GET+POST) e página pública sem sessão `/i/{slug}` de
  indisponibilidade.
- `POST .../initial-invitation/issue` (F02) tem a pré-condição ampliada (compatível): além de
  `PRONTA`, agora também permitida em `ATIVA` sem administrador local ativo (`FR-032`).
- Projeção de acesso: nenhuma mudança (v2 de F02 já previa `suspensa` e `manutencao`).

## v1.2 — 2026-10-27

- `openapi.yaml` 1.2.0 (compatível): contratantes (`/api/v1/contractors*`), catálogo
  (`/api/v1/products*`), solicitação, prévia e acompanhamento de instâncias
  (`/api/v1/instances`, `/preview`, `/timezones`, `/{id}`, `/{id}/provisioning`, `/retry`,
  `/initial-invitation/issue`). `GET /api/v1/instances` passa a ser paginado e filtrável, mantendo
  os campos de F01.
- Contrato interno novo: `GET /internal/v1/instances/{slug}/connection` (escopo `connection` da
  credencial de aplicação), que entrega a conexão da instância ao produto dono.
- Projeção de acesso v2 (compatível): `access_instance.state` aceita `pronta`.
- `GET /api/v1/system/status` ganha o campo opcional `provisioning` (tarefas pendentes,
  aguardando repetição e com falha), sem detalhe de instância.

## v1.1 — 2026-10-26

- `openapi.yaml` 1.1.0 (compatível): identidade do painel (`/api/v1/auth/*`, `/api/v1/session`,
  MFA TOTP, convites, recuperação), administradores da plataforma, contas e bloqueio, vínculos
  por instância e pendências de sincronização; contratos internos para produtos
  (`/internal/v1/instances/{slug}/sessions`, `/sessions/touch`, `/members`, `/invitations`) com
  credencial de aplicação.
- `GET /api/v1/system/status` passa a exigir sessão de administrador com MFA (anunciado em F00).
- Contrato de dados da projeção de acesso v1 ([access-projection.md](./access-projection.md)):
  tabelas `access_session`, `access_session_logout`, `access_member` e `access_instance` no banco
  de acesso `<instância>_acc`, com a regra normativa de validação (D-04).

## v1 — 2026-10-26

- Convenções v1: versionamento, JSON, correlação, envelope de erro, códigos HTTP, idempotência.
- Catálogo de capacidades; situação operacional do Core completa (`/health/live`,
  `/api/v1/system/status`).
- Contrato do artefato de migração de produto (formato 1), especificado.
