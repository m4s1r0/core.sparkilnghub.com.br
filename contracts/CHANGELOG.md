# Changelog dos contratos

Mudanças compatíveis mantêm a versão maior e são registradas aqui; incompatíveis exigem `/v2`
(conventions.md §1).

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
