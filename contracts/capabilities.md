# Catálogo de capacidades do SparkCore

Capacidades mínimas das diretrizes §6.1. Cada uma ganha contrato completo na fatia responsável,
antes da implementação do consumidor (princípio III). Todas são provadas primeiro com o produto
de referência sintético (seção "SparkCore primeiro").

| Capacidade                                          | Consumidor                    | Versão | Fatia    | Estado                                                                              | Depende de     |
| --------------------------------------------------- | ----------------------------- | ------ | -------- | ----------------------------------------------------------------------------------- | -------------- |
| Situação operacional do Core                        | Interface Core, monitoramento | v1     | F00      | **Completa** — [openapi.yaml](./openapi.yaml)                                       | —              |
| Autenticar e encerrar sessão Pet                    | SparkPet                      | v1     | F01      | **Especificada** — [openapi.yaml](./openapi.yaml) (`/internal/v1/.../sessions`)     | `D-02`, `D-04` |
| Autorizar sessão e resolver instância               | SparkPet                      | v1     | F01      | **Especificada** — contrato de dados [access-projection.md](./access-projection.md) | `D-04`         |
| Listar/criar/revogar vínculos locais                | Administração SparkPet        | v1     | F01      | **Especificada** — [openapi.yaml](./openapi.yaml) (`/internal/v1/.../members`)      | `D-02`         |
| Criar convite inicial                               | Provisionamento Core          | v1     | F02      | Reservada                                                                           | `D-03`, `D-07` |
| Situação operacional de instância (health + versão) | SparkCore                     | v1     | F03      | Reservada                                                                           | —              |
| Receber lote de utilização                          | Outbox SparkPet               | v1     | F08-Core | Reservada                                                                           | —              |

Estados: **Reservada** (nome, consumidor e fatia definidos; esquema não publicado),
**Especificada** (esquema publicado, ainda sem implementação), **Completa** (implementada e
validada contra o contrato na verificação automática), **Depreciada**.

O artefato de migração de produto ([migration-artifact.md](./migration-artifact.md)) também é um
contrato entre Core e produtos; em F00 está **Especificado** e exercido pelo produto de
referência.

Desde F01 (D-04), "autorizar sessão e resolver instância" é um **contrato de dados**: o produto
valida cada requisição na projeção de acesso do banco de acesso da instância, sem chamar o Core
([access-projection.md](./access-projection.md)). Os estados passam a **Completa** quando a
implementação de F01 for validada contra os contratos na verificação automática.
