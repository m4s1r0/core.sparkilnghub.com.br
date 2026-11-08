# Criar e configurar um novo produto

Guia operacional para colocar um novo produto (SaaS real, ex.: Tuteli/`sparkpet`, ou futuro
SparkCMS) rodando em cada ambiente. Pressupõe os contratos já existentes:
[`contracts/migration-artifact.md`](../../contracts/migration-artifact.md) (formato do artefato),
[`contracts/commands.md`](../../contracts/commands.md) (comandos) e
[`docs/escopos/00-diretrizes-compartilhadas.md`](../escopos/00-diretrizes-compartilhadas.md) §3.4
(portas fixas por sistema).

Dois lados sempre separados: o **lado do SparkCore** (cadastro no catálogo, provisionador,
privilégios de MySQL — mudanças neste repositório) e o **lado do produto** (o repositório próprio
do produto, ex. `tuteli.sparklinghub.com.br`, que só consome a API do Core).

## 1. Ambiente de desenvolvimento

### 1.1 Lado do SparkCore (uma vez por produto, feito neste repositório)

1. **Entrada no catálogo** (`spark_core.product`): não existe rota para criar produto pela
   interface (`SC-008`) — é uma migração do Core. Acrescente uma migração nova em
   `server/migrations/spark_core/migrations/00NN_<slug>.sql`:

   ```sql
   INSERT INTO product (code, name, description, status, reference_only, version, created_at, updated_at)
   VALUES ('<code>', '<Nome comercial>', '<descrição até 280 chars>',
           'ativo', FALSE, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6));
   ```

   `code` é imutável (`SC-007`), ascii, `^[a-z][a-z0-9]{2,15}$` — é o código técnico (ex.:
   `sparkpet`), não o nome comercial (ex.: "Tuteli"). Isso já está feito para `sparkpet` na
   migração `0004_catalogo_provisionamento.sql`; um produto novo repete o padrão.

2. **Artefato de migração do produto** (o que é aplicado em cada banco de instância): crie
   `produtos/<produto>/artifact/manifest.json` + `migrations/000N_<slug>.sql` seguindo
   [`contracts/migration-artifact.md`](../../contracts/migration-artifact.md). `databasePrefix`
   deve ser `<code>_`.

   ```bash
   npm run artifact:validate -- produtos/<produto>/artifact   # estático, sem banco
   ```

   Teste de ponta a ponta num banco descartável **antes** de registrar o provisionador: passo 2
   de "Como testar localmente antes de publicar" no contrato acima (credencial `test`, bancos
   `t_<algo>`, nunca um banco de instância real).

3. **Registrar o provisionador em código** (nunca pela interface) em
   [`server/src/modules/catalog/provisioners.ts`](../../server/src/modules/catalog/provisioners.ts):

   ```ts
   export const PROVISIONERS: ProvisionerRegistry = {
     // ...existentes
     "<code>": {
       id: "<code>-v1",
       artifactDir: <code>ProductDir,
       environments: ["development", "homologation", "production"],
     },
   };
   ```

   Acrescente o caminho em
   [`server/src/platform/paths.ts`](../../server/src/platform/paths.ts):

   ```ts
   export const <code>ProductDir = join(serverRoot, "../produtos/<produto>/artifact");
   ```

4. **Privilégio do provisionador no prefixo do produto**, em
   [`docker/mysql/init/01-databases-and-users.sh`](../../docker/mysql/init/01-databases-and-users.sh):

   ```sql
   GRANT ALL PRIVILEGES ON `<code>\_%`.* TO 'spark_provisioner'@'%' WITH GRANT OPTION;
   ```

   O script é idempotente e reaplicado pelo próprio `dev:up` em volume já existente — **não**
   precisa recriar o volume (`docker compose down -v`) só por isso.

5. **Reservar as portas fixas** do produto (API e, se houver interface Vite, `WEB_PORT`) na
   tabela de `docs/escopos/00-diretrizes-compartilhadas.md` §3.4, antes de implementar.

6. Aplicar tudo:

   ```bash
   npm run dev:up
   ```

   (reaplica o init do MySQL, roda `db:migrate` — grava a linha nova em `product` — e
   `instances:migrate-access`.)

### 1.2 Lado do produto (repositório próprio, ex. Tuteli)

1. Copie o `.env.example` do produto para `.env` e preencha, usando a porta reservada no passo
   1.1.5 (Tuteli usa `3001`/`5175`):

   ```
   PORT=<porta da API reservada>
   SPARKCORE_INTERNAL_URL=http://127.0.0.1:5273
   SPARKCORE_APP_CREDENTIAL=            # passo 3
   SPARKCORE_INSTANCE_SLUG=             # passo 2
   SESSION_SECRET=<32+ caracteres aleatórios>
   SESSION_TTL_SECONDS=28800
   NODE_ENV=development
   WEB_PORT=<porta do Vite reservada>
   ```

2. Crie a instância no painel do Core (`http://127.0.0.1:5173`, SparkCore já de pé via
   `dev:up`): **Contratantes** → criar contratante se necessário → **Instâncias** → **Nova
   instância** → escolher o produto e aguardar o estado `PRONTA` (o trabalhador do Core
   provisiona; acompanhe o protocolo). Anote o **slug** da instância para
   `SPARKCORE_INSTANCE_SLUG`.

3. Crie a credencial de aplicação do produto, **neste repositório** (Core):

   ```bash
   npm run app-credential -- create <produto> "<produto> dev" --scopes sessions,members,connection
   ```

   Copie o `<id>.<segredo>` impresso (uma única vez) para `SPARKCORE_APP_CREDENTIAL` no `.env`
   do produto. Use só o escopo que o produto realmente chama (`connection` entrega a senha
   operacional do banco da instância — só para o processo que abre essa conexão).

4. Instale e suba o produto (exemplo com o layout `api/` + `web/` do Tuteli):

   ```bash
   cd api && npm install && npm run dev
   ```

   ```bash
   cd ../web && npm install && npm run dev
   ```

## 2. Ambiente de homologação

Diferenças centrais em relação ao desenvolvimento:

- `npm run dev:up`, `dev:down` e `dev:reset` **recusam** fora de `development` — em homologação
  os passos abaixo são manuais.
- O marcador `spark_core.environment_marker` é gravado na **primeira** migração do Core a partir
  de `SPARK_ENV` e nunca muda depois (`assertEnvironment`). Definir `SPARK_ENV=homologation`
  **antes** do primeiro `db:migrate` nesse banco é obrigatório e irreversível por esse caminho.
- `npm run db:seed` ainda é permitido em homologação (dados sintéticos para teste), mas não em
  produção.

Passos:

1. Suba (ou aponte para) um MySQL 8.4 **dedicado** a homologação — outro host/porta/volume do
   `development`, nunca o mesmo. Bootstrap de bancos e dos seis usuários por papel com o mesmo
   script usado em desenvolvimento, apontando para o host remoto:

   ```bash
   MYSQL_ROOT_PASSWORD=... MYSQL_MIGRATOR_PASSWORD=... MYSQL_WEB_PASSWORD=... \
   MYSQL_WORKER_PASSWORD=... MYSQL_PROVISIONER_PASSWORD=... MYSQL_ACCESS_WRITER_PASSWORD=... \
   MYSQL_TEST_PASSWORD=... MYSQL_INIT_HOST=<host> MYSQL_INIT_PORT=<porta> \
   bash docker/mysql/init/01-databases-and-users.sh
   ```

2. `.env` desse ambiente com `SPARK_ENV=homologation`, `MYSQL_HOST`/`MYSQL_PORT` apontando para
   esse MySQL, e as demais variáveis do `.env.example` (chaves `IDENTITY_SECRET_KEY`,
   `INSTANCE_SECRET_KEY` próprias deste ambiente — nunca reaproveitar as de desenvolvimento ou
   produção).

3. Compile e aplique, **nesta ordem**, antes de qualquer outro comando:

   ```bash
   npm run build:contracts
   npm run db:migrate              # grava o marcador homologation na primeira vez
   npm run instances:migrate-access
   npm run db:seed                 # opcional; dados sintéticos
   ```

4. Compile e inicie servidor e trabalhador (sem watch mode):

   ```bash
   npm run build -w @sparkcore/server
   npm run build -w @sparkcore/web      # gera web/dist, servido pelo próprio servidor
   npm run start:app -w @sparkcore/server
   npm run start:worker -w @sparkcore/server   # processo separado
   ```

   O servidor serve a interface construída (`web/dist`) na mesma origem (`@fastify/static`,
   `wildcard: false`): **reinicie `start:app` depois de todo `build -w @sparkcore/web`**, senão
   assets com hash novo não são servidos (página em branco).

5. Primeiro acesso: `npm run bootstrap:admin -- <email>` (link de convite impresso uma única
   vez).

6. Para o produto: crie a instância pelo painel, a credencial de aplicação
   (`npm run app-credential -- create <produto> ...`) e configure o `.env` do repositório do
   produto apontando `SPARKCORE_INTERNAL_URL` para a URL real deste ambiente de homologação. O
   próprio processo do produto (API + build do seu `web`, se houver) segue o equivalente dos
   passos 3–4 acima, com os scripts `build`/`start` do seu `package.json`.

Comportamento específico de homologação/produção (ex.: produto de referência `sparkref` invisível
fora de desenvolvimento/homologação) pode ser conferido localmente sem infraestrutura separada:
ver passo 4 de "Como testar localmente antes de publicar" em
[`contracts/migration-artifact.md`](../../contracts/migration-artifact.md#como-testar-localmente-antes-de-publicar).

## 3. Ambiente de produção

Mesma sequência da homologação, com estas diferenças:

- `SPARK_ENV=production` definido **antes** da primeira migração nesse banco (irreversível pelo
  marcador).
- `npm run db:seed` **recusa** em produção (`env_guard_refused`, saída 2) — sem dados sintéticos,
  sem contratante/produto de referência.
- O produto de referência (`sparkref`) nunca aparece no catálogo em produção (filtro do próprio
  `product`/`instance_ref` sintético).
- Segredos (`IDENTITY_SECRET_KEY`, `INSTANCE_SECRET_KEY`, senhas de MySQL, credenciais de
  aplicação) ficam em um cofre do ambiente de produção, nunca no repositório, log ou ticket —
  mesma regra de homologação, com consequência mais severa aqui.
- `PUBLIC_ORIGIN` deve ser a origem pública real (`https://...`), usada na verificação de CSRF.
- Infraestrutura de hospedagem (orquestração, TLS, rede, backup do MySQL de produção) **ainda não
  está documentada neste repositório** — não há `Dockerfile` nem pipeline de deploy de produção
  hoje (`.github/workflows/verify.yml` cobre só CI). Ao decidir isso, registre um ADR em
  `docs/adr/` e amplie esta seção; até lá, os passos abaixo cobrem só o que os comandos do próprio
  Core garantem.

Sequência mínima, igual à homologação a partir do passo 3:

```bash
npm run build:contracts
npm run db:migrate                      # grava o marcador production na primeira vez
npm run instances:migrate-access
npm run build -w @sparkcore/server
npm run build -w @sparkcore/web
npm run start:app -w @sparkcore/server
npm run start:worker -w @sparkcore/server
npm run bootstrap:admin -- <email>      # primeiro administrador
```

Depois, o cadastro do contratante, a criação da instância pelo painel e a credencial de
aplicação do produto (`npm run app-credential -- create ...`) seguem exatamente os mesmos passos
de homologação/desenvolvimento — a diferença é só o ambiente e o cofre de segredos.

## 4. Conectar diretamente ao MySQL

### 4.1 Desenvolvimento

O `compose.yaml` expõe o MySQL do Core em `127.0.0.1:${MYSQL_PORT:-3307}` (container na porta
padrão `3306`). Duas formas:

- **Cliente local**, com qualquer ferramenta (`mysql` CLI, DBeaver, TablePlus, MySQL Workbench):
  host `127.0.0.1`, porta `3307` (ou o valor de `MYSQL_PORT` no seu `.env`), usuário e senha de
  um dos papéis do `.env` (nunca o root para uso rotineiro):

  | Papel | Usuário | Variável da senha | Acesso |
  |---|---|---|---|
  | Migrador | `spark_core_migrator` | `MYSQL_MIGRATOR_PASSWORD` | DDL+DML em `spark_core` e `spark_identity` |
  | Servidor web | `spark_core_web` | `MYSQL_WEB_PASSWORD` | DML em `spark_core` e `spark_identity` |
  | Trabalhador | `spark_core_worker` | `MYSQL_WORKER_PASSWORD` | DML em `spark_core`; leitura/inserção em `spark_identity` |
  | Escritor de acesso | `spark_access_writer` | `MYSQL_ACCESS_WRITER_PASSWORD` | sem privilégio global; DML concedido por instância em `<instância>_acc` |
  | Provisionador | `spark_provisioner` | `MYSQL_PROVISIONER_PASSWORD` | `CREATE USER` global; tudo em `sparkpet_%`/`sparkref_%` |
  | Testes | `spark_test` | `MYSQL_TEST_PASSWORD` | tudo em `t_%` (só development/CI) |

  ```bash
  mysql -h 127.0.0.1 -P 3307 -u spark_core_migrator -p
  ```

- **Sem expor porta**, direto no contêiner:

  ```bash
  docker compose exec mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD"
  ```

Bancos de uma **instância** de produto (`sparkpet_<uuid-sem-hifen>`) têm usuário próprio
`inst_<...>` com senha gerada pelo provisionador e cifrada em
`instance_resource.secret_enc` (`INSTANCE_SECRET_KEY`) — não há senha em texto plano para
copiar manualmente. Para inspecionar dados de uma instância específica, use o root local (dev)
ou peça ao produto a conexão entregue pelo contrato F02 (`connection`); nunca extraia a senha
operacional fora do procedimento de
[`docs/operacao/provisionamento.md`](./provisionamento.md#chave-instance_secret_key).

### 4.2 Homologação e produção

O MySQL não é exposto pelo `compose.yaml` nesses ambientes — está onde `MYSQL_HOST`/`MYSQL_PORT`
apontarem (serviço gerenciado ou VM própria do ambiente; infraestrutura ainda não documentada
neste repositório, ver §3). Regras que já valem independente da infraestrutura escolhida:

- Nunca exponha a porta do MySQL publicamente; conecte por VPN/SSH tunnel/rede privada.
- Use o papel com o menor privilégio suficiente (tabela acima) — root/admin só para operação
  excepcional, nunca para consulta rotineira.
- As senhas desses papéis em homologação/produção são **distintas** das de desenvolvimento e
  ficam no cofre do ambiente, nunca no `.env` versionado ou em texto no repositório.
