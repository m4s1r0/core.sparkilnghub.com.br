# Dados sintéticos

Regras para os dados de desenvolvimento e homologação (`NFR-016`; constituição VI).

- **Somente dados fictícios.** Nenhuma cópia, amostra ou extrato de produção vai para
  desenvolvimento ou homologação, nem por importação manual.
- **Marcação.** Todo banco de instância criado pelas sementes tem `_spark_instance.synthetic =
true`; textos começam com `[SINTÉTICO]`; e-mails usam apenas o domínio reservado `example.test`
  (RFC 2606); documentos e telefones, quando existirem, usam valores sabidamente inválidos.
- **Idempotência.** Cada semente usa identificadores fixos declarados no arquivo (ex.:
  `SEED_REFERENCE_INSTANCE` em `f00.ts`); rodar `npm run db:seed` de novo não duplica nada.
- **Guarda de ambiente.** `db:seed` só roda em `development` e `homologation` e recusa (saída 2,
  log `env_guard_refused`) se `SPARK_ENV` ou `spark_core.environment_marker` indicar produção.
  `dev:reset` só roda em `development`.

## Conteúdo por fatia

| Fatia | Arquivo  | Conteúdo                                                                                                              |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| F00   | `f00.ts` | Marcador de ambiente (via `db:migrate`) e uma instância do produto de referência `sparkref` com um item `[SINTÉTICO]` |

Cada fatia acrescenta seu arquivo (`f01.ts`, `f02.ts`, …) e uma linha nesta tabela, chamado por
`server/src/cli/db-seed.ts`.
