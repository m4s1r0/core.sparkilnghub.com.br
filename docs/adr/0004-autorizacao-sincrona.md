---
id: D-04
title: Autorização de cada requisição do SparkPet consultada no Core
status: proposta
requirements: [COM-018, SC-027, SC-028, T-03, T-15]
---

## Contexto

Suspensão, revogação de vínculo e troca de senha precisam alcançar sessões já abertas
(`COM-018`, `SC-027`, `SC-028`, `T-03`). A identidade é central no Core (D-02). Decidido em
2026-10-26: D-04 permanece **em aberto** (spec F00, Clarifications); bloqueia a implementação de
F01 e F02, não a especificação.

## Decisão

Ainda não tomada. Alternativas em avaliação:

1. **Referência dos escopos — autorização síncrona sem cache**: cada requisição protegida do
   SparkPet consulta o endpoint interno de autorização do Core com a sessão opaca. Revogação e
   suspensão valem na requisição seguinte.
2. **Validação local com mecanismo de revogação**: o SparkPet valida um token assinado localmente
   e consulta uma lista de revogação ou versão de autorização distribuída pelo Core.

## Alternativas rejeitadas

Nenhuma rejeitada até a decisão; ambas acima seguem em avaliação.

## Consequências

- **Alternativa 1**: revogação imediata e modelo simples, mas o Core vira dependência síncrona do
  Pet; indisponibilidade da identidade gera `503` no Pet (`T-15`); latência adicional a medir
  contra `NFR-004`.
- **Alternativa 2**: menor dependência em tempo de execução, mas janela de revogação, distribuição
  de chaves e versão de autorização precisam de prova própria para `T-03`.
- Enquanto proposta, `npm run gate -- F01` e `-- F02` saem com código 3.
