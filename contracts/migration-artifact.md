# Contrato do artefato de migração de produto — v1 (Especificado)

Formato que todo produto (referência sintética agora; Tuteli depois) entrega ao SparkCore para
provisionar e migrar bancos de instância. O Core só aplica artefatos neste formato e só versões
cadastradas (constituição, princípio VII; `SC-009`).

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
