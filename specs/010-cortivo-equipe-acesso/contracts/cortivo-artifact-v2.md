# Contrato do artefato Cortivo — v2

**Spec**: [spec.md](../spec.md) · **Plano**: [plan.md](../plan.md)

Este contrato complementa [`migration-artifact.md`](../../../contracts/migration-artifact.md).
Aplica-se ao artefato cujo código imutável de produto é `cortivo` e prefixo de banco `cortivo_`.
A v1 publicada permanece imutável; a v2 é uma nova migração, sequencial, com checksum próprio.

## Manifesto e publicação

- `formatVersion` permanece `1`; o produto permanece `cortivo`; o prefixo permanece `cortivo_`.
- A lista de migrações passa a conter as versões sequenciais `1` e `2`.
- `migrations/0001_base.sql` e seu checksum publicado não podem mudar.
- `appendOnlyTables` permanece exatamente `["auditoria"]`.
- A v2 não cria outras tabelas de negócio além de `profissional` e não usa construções proibidas
  pelo validador genérico do artefato.

## Schema acrescentado

### `profissional`

| Campo | Tipo | Nulabilidade / regra |
|---|---|---|
| `profissional_id` | `BINARY(16)` | PK, UUID. |
| `nome` | `VARCHAR(120)` | NOT NULL. |
| `apelido` | `VARCHAR(40)` | NULL. |
| `telefone` | `VARCHAR(16)` | NULL; formato internacional. |
| `situacao` | `ENUM('ativo','inativo')` | NOT NULL, DEFAULT `ativo`. |
| `version` | `INT UNSIGNED` | NOT NULL, edição otimista, inicial 1. |
| `criado_em` | `DATETIME(6)` | NOT NULL, UTC. |
| `atualizado_em` | `DATETIME(6)` | NOT NULL, UTC. |

### Restrições em `perfil_colaborador`

- `profissional_id` continua usando `BINARY(16) NULL`, agora com FK para
  `profissional.profissional_id`.
- Restrição `CHECK`: `barbeiro` em `perfis` exige `profissional_id`; sem `barbeiro`, o campo deve
  ser `NULL`.
- Índice único em `profissional_id` impede associação de um profissional a dois perfis; valores
  `NULL` podem repetir.
- A FK impede referências a profissionais inexistentes.
- Profissional inativo associado não é impedido pelo banco; a regra de atividade pertence ao
  produto Cortivo.

## Garantias de aplicação e compatibilidade

- Instância nova recebe v1 e v2 em ordem pelo provisionador existente.
- Instância na v1 recebe somente a v2 pela tarefa de migração existente.
- Aplicar v1 e v2 em uma instância existente produz schema equivalente à aplicação das duas
  versões num banco vazio.
- Falha de DDL não aciona remoção nem repetição automática; a tarefa e a pendência ficam visíveis
  segundo o contrato genérico de migração.
- `/internal/v1`, a projeção de acesso e seus contratos não mudam.
