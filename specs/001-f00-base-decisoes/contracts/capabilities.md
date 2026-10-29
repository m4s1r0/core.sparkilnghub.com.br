# Catálogo de capacidades do SparkCore

Capacidades mínimas das diretrizes §6.1. Cada uma ganha contrato completo na fatia responsável,
antes da implementação do consumidor (princípio III). Todas são provadas primeiro com o produto
de referência sintético (seção "SparkCore primeiro").

| Capacidade | Consumidor | Versão | Fatia | Estado em F00 | Depende de |
|---|---|---|---|---|---|
| Situação operacional do Core | Interface Core, monitoramento | v1 | F00 | **Completa** — [openapi.yaml](./openapi.yaml) | — |
| Autenticar e encerrar sessão Pet | Tuteli | v1 | F01 | Reservada | `D-02`, `D-04` |
| Autorizar sessão e resolver instância | Tuteli | v1 | F01 | Reservada | `D-04` (proposta) |
| Listar/criar/revogar vínculos locais | Administração Tuteli | v1 | F01 | Reservada | `D-02` |
| Criar convite inicial | Provisionamento Core | v1 | F02 | Reservada | `D-03`, `D-07` |
| Situação operacional de instância (health + versão) | SparkCore | v1 | F03 | Reservada | — |
| Receber lote de utilização | Outbox Tuteli | v1 | F08-Core | Reservada | — |

Estados: **Reservada** (nome, consumidor e fatia definidos; esquema não publicado),
**Especificada** (esquema publicado, ainda sem implementação), **Completa** (implementada e
validada contra o contrato na verificação automática), **Depreciada**.

O artefato de migração de produto ([migration-artifact.md](./migration-artifact.md)) também é um
contrato entre Core e produtos; em F00 está **Especificado** e exercido pelo produto de
referência.
