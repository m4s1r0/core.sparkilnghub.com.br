# Comandos novos em F01

Acrescentados ao contrato de comandos de F00 (`contracts/commands.md`).

| Comando | Efeito | Ambientes | Saída |
|---|---|---|---|
| `npm run bootstrap:admin -- <email>` | Gera o convite do primeiro administrador da plataforma (48 h) e imprime o link uma vez; recusa se já houver administrador ativo ou convite de plataforma pendente válido | todos (produção pelo responsável pela implantação) | 0 com link; 3 recusado (já existe administrador) |
| `npm run app-credential -- create <produto> <rótulo> --scopes sessions,members` | Cria credencial de aplicação e imprime `<id>.<segredo>` uma vez | todos | 0 |
| `npm run app-credential -- revoke <id>` | Revoga credencial (efeito imediato) | todos | 0 |
| `npm run app-credential -- list` | Lista credenciais sem segredos | todos | 0 |
| `npm run access:reconcile -- <slug>` | Recalcula a projeção de acesso da instância a partir de `spark_identity` e registra divergências corrigidas (FR-033) | todos | 0 sem divergência; 0 com correções (contagem impressa); 2 instância inexistente; 4 banco de acesso inacessível |

O `db:seed` de desenvolvimento passa a criar: duas instâncias sintéticas do `sparkref` (A e B) com
bancos operacional e de acesso, uma credencial de aplicação do `sparkref` (segredo gravado apenas no
`.env` local como `SPARKREF_APP_CREDENTIAL`, nunca no repositório) e contas sintéticas
(`ana@example.test` em A, `bruno@example.test` em B, `carla@example.test` em A e B) com senha
definida por `SEED_USER_PASSWORD` do `.env`.
