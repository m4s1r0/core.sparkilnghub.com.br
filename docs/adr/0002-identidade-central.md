---
id: D-02
title: Banco spark_identity central, sem cópia de senha por instância
status: confirmada
date: 2026-10-26
owner: responsável técnico Sparkling Hub
requirements: [COM-006, COM-007, COM-008]
---

## Contexto

O pedido exige um banco de autenticação de usuários para o SparkPet (`COM-006`). Um mesmo usuário
pode atuar em várias instâncias com papéis diferentes (`COM-008`), e revogação e suspensão
precisam alcançar sessões abertas (`COM-018`).

## Decisão

Um banco `spark_identity`, pertencente ao módulo de identidade do SparkCore, guarda contas,
credenciais, vínculos `membership(user_id, instance_id, role, status)`, convites, sessões e
auditoria de segurança dos dois produtos. O SparkPet não acessa essas tabelas diretamente nem
mantém segunda cópia de senha. Não há chave estrangeira entre bancos; UUIDs de ator e instância
são verificados na aplicação.

## Alternativas rejeitadas

- **Tabela de usuários por banco de instância**: duplicaria credenciais, impediria conta única
  com vínculos em várias instâncias e espalharia a revogação.
- **Provedor de identidade externo no MVP**: SSO e provedores sociais estão fora do MVP.

## Consequências

- Indisponibilidade da identidade bloqueia operações protegidas do SparkPet com `503`.
- Recuperação conjunta de Core e identidade exige procedimento próprio (diretrizes §9).
- F01 modela as entidades de identidade neste banco.
