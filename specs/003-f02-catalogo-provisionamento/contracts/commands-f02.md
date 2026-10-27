# Comandos — F02 (delta sobre `contracts/commands.md`)

Nenhum comando aceita segredo por argumento. Recusas por ambiente seguem a guarda de F00.

| Comando | Mudança | Ambientes | Código de saída |
|---|---|---|---|
| `npm run db:seed` | Passa a criar o contratante sintético, o produto `sparkref` e as instâncias A e B **pelo provisionador** (modo síncrono, UUID fixo), ativando-as com transição de sistema; credencial do `sparkref` com escopos `sessions,members,connection` | `development`, `homologation` | 0 / 2 recusado |
| `npm run dev:up` / `dev:reset` | Executam `instances:migrate-access` depois de `db:migrate`; `dev:reset` também recria os bancos `sparkref_*` sintéticos | `development` | inalterado |
| `npm run instances:migrate-access` (novo) | Aplica a versão vigente da projeção de acesso em todas as instâncias com recursos criados, com a credencial do provisionador; lista as inacessíveis | todos | 0 todas atualizadas; 4 alguma inacessível (as demais são atualizadas) |
| `npm run app-credential -- create <produto> <rótulo> --scopes sessions,members,connection` | Aceita o novo escopo `connection` | todos | 0 / 1 |
| Processo trabalhador (`dev:worker` no workspace do servidor; mesmo artefato em produção) | Passa a exigir `MYSQL_PROVISIONER_PASSWORD` e `INSTANCE_SECRET_KEY`; executa tarefas de provisionamento além da sincronização de F01 | todos | — |

Variáveis novas (documentadas em `.env.example`; valores nunca exibidos):

| Variável | Uso | Processos |
|---|---|---|
| `INSTANCE_SECRET_KEY` | 32 bytes base64; cifra a senha operacional das instâncias (R-09) | web, trabalhador |
| `INSTANCE_SECRET_KEY_VERSION` | versão da chave (padrão 1) | web, trabalhador |
| `INSTANCE_DB_HOST`, `INSTANCE_DB_PORT` | endereço do MySQL entregue aos produtos (R-10); padrão igual ao do Core | web |
| `PROVISIONING_MAX_ATTEMPTS` | tentativas por etapa (padrão 5, R-08) | trabalhador |
