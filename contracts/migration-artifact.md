# Contrato do artefato de migração de produto — v1 (Especificado)

Formato que todo produto (referência sintética e Tuteli, `produtos/<produto>/artifact/`) entrega
ao SparkCore para provisionar e migrar bancos de instância. O Core só aplica artefatos neste
formato e só versões cadastradas (constituição, princípio VII; `SC-009`).

## Estrutura

```text
<artifact-root>/
├── manifest.json
└── migrations/
    ├── 0001_<slug>.sql
    └── 0002_<slug>.sql
```

## `manifest.json`

```json
{
  "formatVersion": 1,
  "productCode": "sparkref",
  "databasePrefix": "sparkref_",
  "migrations": [
    {
      "version": 1,
      "name": "0001_baseline",
      "file": "migrations/0001_baseline.sql",
      "sha256": "<64 hex>"
    },
    {
      "version": 2,
      "name": "0002_ref_item",
      "file": "migrations/0002_ref_item.sql",
      "sha256": "<64 hex>"
    }
  ]
}
```

| Campo                  | Regras                                                                      |
| ---------------------- | --------------------------------------------------------------------------- |
| `formatVersion`        | `1`                                                                         |
| `productCode`          | `^[a-z][a-z0-9]{2,15}$`, imutável, igual ao código no catálogo (F02)        |
| `databasePrefix`       | `productCode` + `_`; nome do banco = prefixo + UUID da instância sem hífens |
| `migrations[].version` | inteiros 1..N contíguos, crescentes                                         |
| `migrations[].sha256`  | hash do arquivo normalizado (LF, UTF-8 sem BOM)                             |

## Regras dos arquivos SQL

- Somente DDL/DML sobre o próprio banco; sem `USE`, nome de banco qualificado, `CREATE DATABASE`,
  `CREATE USER`, `GRANT`, `DROP DATABASE`, `SET GLOBAL`, `LOAD DATA`, `INTO OUTFILE`. O
  validador recusa o artefato se encontrar essas construções.
- A versão 1 MUST criar `_spark_instance` com o formato do [data-model](../data-model.md); o
  aplicador insere a linha da instância imediatamente após aplicar a v1.
- `_spark_schema_history` é criada e mantida pelo aplicador, não pelo artefato.
- Uma versão publicada é imutável; correção é uma nova versão.

## Como testar localmente antes de publicar

1. **Validação estática** (manifesto, checksums, construções proibidas), sem banco nem `.env`:

   ```bash
   npm run artifact:validate -- produtos/<produto>/artifact
   ```

2. **Aplicação completa num banco descartável**, para provar que as migrações executam de ponta
   a ponta num MySQL real antes de registrar o produto em `PROVISIONERS`
   (`server/src/modules/catalog/provisioners.ts`). Com `SPARK_ENV=development` e o MySQL do
   `dev:up` no ar, use a credencial `test` (só cria bancos `t_<algo>`, nunca aponte para um banco
   de instância real) para criar um banco descartável, chamar `migrate()` com o manifesto
   carregado e depois apagar o banco. Confira: nenhuma versão falha, o número de versões
   aplicadas é o esperado e `information_schema.TABLES` do banco descartável tem as tabelas
   esperadas.

3. **Registro do provisionador** em código (nunca pela interface, `SC-008`): adicione a entrada
   em `PROVISIONERS` com o `productCode` do catálogo (imutável; `SC-007`) como chave — não o
   nome comercial do produto —, o `artifactDir` apontando para o artefato e os ambientes em que
   o produto pode ser provisionado.

4. **Ambientes (homologação/produção) são travados pelo banco, não só pelo `.env` isolado**: o
   marcador `spark_core.environment_marker` é gravado na primeira migração do Core a partir de
   `SPARK_ENV` e não muda depois (`assertEnvironment`, `contracts/commands.md`). `npm run dev:up`
   e `dev:reset` só aceitam `development`. Para testar localmente o comportamento em
   `homologation` ou `production` (por exemplo, confirmar que o produto de referência fica
   invisível em produção, ou que os ambientes do provisionador novo estão corretos):
   - suba um MySQL **separado** do `dev:up` (outro projeto/volume/porta do compose, com
     `MYSQL_PORT` diferente no `.env`);
   - defina `SPARK_ENV=homologation` (ou `production`) nesse `.env` **antes** da primeira
     migração — o marcador fica fixo a partir daí e não é reversível;
   - rode `npm run db:migrate` diretamente (permitido em todos os ambientes) e, se aplicável,
     `npm run db:seed` (só `development`/`homologation`; recusa em `production` com
     `env_guard_refused`);
   - inicie servidor e trabalhador manualmente (`npm run dev:app -w @sparkcore/server`,
     `npm run dev:worker -w @sparkcore/server`), já que `dev:up` recusa fora de `development`;
   - confira pelo painel ou pela API (`GET /api/v1/products`) que `provisionable` e
     `notProvisionableReason` batem com o esperado para o ambiente.

   Esse comportamento já tem teste de integração automatizado
   (`server/tests/integration/catalog/catalog-production.test.ts`); o roteiro manual acima é só
   para inspeção exploratória, não substitui a suíte.

5. **Imutabilidade depois de publicado** (`FR-019`): uma vez em `main`, `npm run check:migrations`
   (parte de `npm run verify`) recusa qualquer alteração nos arquivos já publicados em
   `produtos/<produto>/artifact/`, `server/reference-product/` e `server/migrations/`. Corrigir
   um artefato publicado é sempre uma **nova versão**, nunca uma edição.

## Garantias do aplicador

- Recusa artefato com checksum divergente, versão fora de sequência, construção proibida ou
  histórico do banco incompatível com o manifesto (motivo explícito e código estável).
- Aplicar v1 e depois v2 produz a mesma estrutura que aplicar v1+v2 num banco vazio (verificado
  por comparação de `information_schema`).
- Uma versão por vez; falha registra `status = falha` e interrompe.
- No provisionamento (F02), o aplicador grava em `_spark_instance` o `owner_task_uuid` da tarefa
  e fixa o resumo do manifesto na tarefa: artefato trocado no meio do provisionamento falha com
  `PROVISIONING_ARTIFACT_CHANGED`, sem misturar versões.
- Uma versão interrompida no meio (linha `falha` no histórico) não é repetida automaticamente:
  o MySQL não desfaz DDL; a instância fica em falha e segue procedimento operacional
  (`docs/operacao/provisionamento.md`). Prefira versões curtas.

## Prontidão (F02)

Uma instância do produto está **pronta** quando: o marcador `_spark_instance` tem o UUID da
instância; o histórico `_spark_schema_history` está na última versão do manifesto, sem linha
`falha`; e a credencial operacional consegue ler o marcador (e não consegue criar tabela nem
banco). Verificações próprias do produto entram como evolução versionada deste contrato.
