# Projeção de acesso — v2 (delta sobre a v1)

Contrato de dados publicado em [contracts/access-projection.md](../../../contracts/access-projection.md)
(F01, v1). A v2 é **compatível**: um produto que só conhece a v1 continua correto.

## Mudança

| Tabela | v1 | v2 |
|---|---|---|
| `access_instance.state` | `ENUM('ativa','suspensa','manutencao')` | `ENUM('pronta','ativa','suspensa','manutencao')` |

- `pronta`: instância provisionada e ainda não ativada (F02). Nenhuma sessão de produto existe e o
  Core recusa login de produto enquanto a instância não está `ATIVA`.
- Gravada pelo provisionador na etapa `configurar`; F03 a troca por `ativa` na ativação.

## Regra normativa de validação

Inalterada: a sessão só é válida com `access_instance.state = 'ativa'` (e as demais condições da
v1). Por isso a instância `pronta` nega qualquer sessão, mesmo para um produto que ignore o novo
valor.

## Aplicação

- Artefato `server/migrations/access_projection`, versão 2 (`0002_estado_pronta.sql`), histórico
  `_spark_access_history`.
- Instâncias novas recebem v1 + v2 no provisionamento.
- Instâncias existentes (sintéticas de F01) recebem a v2 pelo comando novo
  `npm run instances:migrate-access`, que aplica a projeção vigente em todas as instâncias com
  recursos criados, usando a credencial do provisionador (banco inacessível é listado e não
  bloqueia as demais). `dev:up`, `dev:reset` e a CI o executam depois de `db:migrate`.
- O produto de referência valida contra v1 e v2 nos testes de contrato.
