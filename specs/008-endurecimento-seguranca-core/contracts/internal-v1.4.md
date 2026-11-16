# Contrato interno `/internal/v1` — v1.4 (compatível)

Registrado em [`contracts/CHANGELOG.md`](../../../contracts/CHANGELOG.md) e
[`contracts/openapi.yaml`](../../../contracts/openapi.yaml).

## Autenticação

- Credenciais com escopo `connection`, `sessions` ou `members` **devem** estar vinculadas a uma
  instância. Credencial por produto nesses escopos → `401 AUTH_APP_CREDENTIAL_INVALID`.
- Slug diferente da instância vinculada → resposta idêntica à de slug inexistente na mesma rota:

| Rota | Resposta |
| --- | --- |
| `GET /instances/{slug}/connection` | `404 NOT_FOUND` |
| `POST /instances/{slug}/sessions` | `401 AUTH_INVALID_CREDENTIALS` (conta como falha de login) |
| `POST /instances/{slug}/sessions/touch` | `401 AUTH_SESSION_INVALID` |
| `/instances/{slug}/members…`, `/invitations…` | `401 AUTH_SESSION_INVALID` |

## `POST /instances/{slug}/sessions`

- `clientIp`: IPv4 ou IPv6 (sem zona); outro valor → `422`.
- Teto global de falhas por credencial → `429 AUTH_THROTTLED` com `Retry-After`.

## `POST /instances/{slug}/sessions/touch`

- Sucesso: **`200`** (antes `204`) com
  `{ "role": "administrador" | "colaborador", "membershipStatus": "ativo" }`, lidos da projeção.
- Produtos v1.3 que conferem só `2xx` continuam funcionando; produtos v1.4 MUST usar `role` para
  autorização em vez do papel guardado no login, e aceitar `204` de Core antigo (papel do login).

## `GET /instances/{slug}/connection`

- Ganha `tls`: `"required"` quando o MySQL exige TLS da credencial operacional (o produto MUST
  usar `ssl` no pool), `"disabled"` em desenvolvimento sem TLS.

## CLI

```text
npm run app-credential -- create <produto> <rótulo> --scopes <lista> --instance <slug|uuid>
npm run app-credential -- bind <id> --instance <slug|uuid>
npm run app-credential -- list          # mostra a instância; marca "POR PRODUTO — recusada"
npm run instances:sync-grants           # privilégios só-inserção e TLS nas instâncias existentes
```
