# Ensaio de desenvolvimento do Cortivo C01

Este roteiro cria dados sintéticos para testes de integração e ponta a ponta. Ele é exclusivo para
`development`; não o execute contra homologação ou produção.

## Pré-requisitos

- MySQL de desenvolvimento inicializado com `npm run db:migrate`.
- `.env` local com `SPARK_ENV=development`, credenciais de banco configuradas,
  `INSTANCE_SECRET_KEY` e `SEED_USER_PASSWORD`.
- O usuário de banco configurado para o provisionador pode criar bancos e usuários de instância.

Antes de executar, confira que o `.env` aponta para o banco descartável de desenvolvimento correto.
O comando exige que `SPARK_ENV` e `spark_core.environment_marker` indiquem `development`.

## Preparação

```powershell
npm run dev:prepare-cortivo-c01
```

O comando cria/ativa `cortivo-a`, `cortivo-b` (Cortivo v2) e `tuteli-c01` (produto `sparkpet`),
além destas contas:

| Conta                    | E-mail                             | Vínculos                                                 |
| ------------------------ | ---------------------------------- | -------------------------------------------------------- |
| Administradora de ensaio | `cortivo-admin@example.test`       | Administrador em `cortivo-a`, `cortivo-b` e `tuteli-c01` |
| Colaborador de ensaio    | `cortivo-colaborador@example.test` | Colaborador em `cortivo-a`                               |

As senhas usam `SEED_USER_PASSWORD`. O Core guarda somente o hash. Na primeira criação, o comando
exibe uma vez cada credencial de aplicação do Cortivo; salve os valores no gerenciador local de
segredos ou no `.env` ignorado pelo Git, com os nomes `CORTIVO_A_APP_CREDENTIAL` e
`CORTIVO_B_APP_CREDENTIAL`. O Core armazena somente os hashes das credenciais.

## Reexecução e rotação

É seguro executar o comando novamente. Instâncias, contas, vínculos e credenciais ativas existentes
são reutilizados; o segredo de uma credencial existente não pode ser recuperado nem será emitido
novamente. Se um segredo for perdido, revogue a credencial e emita outra vinculada ao slug da
instância com `npm run app-credential -- create cortivo "<rótulo>" --scopes sessions,members,connection --instance <slug>`.

O comando recusa qualquer `SPARK_ENV` diferente de `development`, marcador ausente ou marcador
divergente. Não inclua credenciais ou senhas em issues, arquivos versionados ou logs.
