---
id: D-01
title: Dois monólitos modulares, identidade dentro do SparkCore
status: confirmada
date: 2026-10-26
owner: responsável técnico Sparkling Hub
requirements: [COM-004]
---

## Contexto

O pedido exige arquitetura monolítica no MVP, sem microserviços (`COM-004`), para dois produtos:
SparkCore (plataforma) e SparkPet (primeiro SaaS). O escopo não esclarecia se o ecossistema seria
um único executável ou um por produto (diretrizes §2.2, D-01).

## Decisão

Cada produto é um monólito modular próprio, com base de código, artefato de implantação e
fronteiras de módulos explícitas. A identidade (contas, vínculos, convites, sessões) é um módulo
do SparkCore, sem terceiro serviço independente. O trabalhador de tarefas do Core usa o mesmo
código e artefato, como processo separado.

## Alternativas rejeitadas

- **Um único executável para todo o ecossistema**: acopla ciclos de entrega e falhas da
  plataforma e do produto, e mistura permissões de dados de plataforma e de estabelecimento.
- **Serviço de identidade separado**: introduz um terceiro sistema e comunicação distribuída sem
  necessidade no MVP (constituição VII).

## Consequências

- O SparkPet depende do Core para identidade e autorização por API interna (ver D-04).
- Contratos entre os produtos precisam de versão e de prova independente (constituição III).
- A implantação do site institucional permanece independente.
