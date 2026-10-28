# Changelog dos contratos

Mudanças compatíveis mantêm a versão maior e são registradas aqui; incompatíveis exigem `/v2`
(conventions.md §1).

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
