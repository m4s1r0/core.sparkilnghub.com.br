---
id: D-03
title: Uma instância Tuteli corresponde a um estabelecimento
status: confirmada
date: 2026-10-26
owner: responsável técnico Sparkling Hub
requirements: [SC-014, SC-015]
---

## Contexto

Cada instância tem banco operacional próprio (`COM-005`). Contratantes podem ter várias unidades
(`SC-015`), e agenda e estoque precisam de fronteira clara.

## Decisão

Uma instância de Tuteli = um estabelecimento, com agenda e estoque únicos. Filiais usam
instâncias separadas, inclusive do mesmo contratante; não há consolidação operacional entre
instâncias no MVP.

## Alternativas rejeitadas

- **Várias unidades por instância**: exigiria particionar agenda, estoque, caixa e permissões
  dentro do mesmo banco, enfraquecendo o isolamento por instância.

## Consequências

- Relatórios consolidados entre filiais ficam fora do MVP.
- O cadastro de instância (`SC-014`) e o provisionamento (F02) tratam cada unidade isoladamente.
