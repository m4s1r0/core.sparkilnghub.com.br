# Specification Quality Checklist: Equipe do Cortivo no artefato (versão 2) e ambiente de ensaio do C01

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validação em 1 iteração (2026-11-16).
- Feature de plataforma, como a 009: os "usuários" são o operador do Core, o administrador da
  plataforma e a equipe do Cortivo. Nomes de instância (`cortivo-a`, `cortivo-b`), da aba
  "Migração", de `docs/operacao/` e de `ESQUEMA_SUPORTADO` aparecem por serem identificadores
  combinados com o produto (tarefas T013/T016 e `quickstart.md` do Cortivo), não escolhas de
  implementação. Nomes de tabela, colunas, tipos SQL e caminhos de arquivo ficam para o plano.
- Nenhum marcador de esclarecimento. Decisões tomadas por padrão razoável e registradas em
  Assumptions/Edge Cases:
  - a versão 2 sobre dados inconsistentes **falha** com pendência visível em vez de corrigir
    dados automaticamente (princípio IV: nada é removido nem reescrito sem decisão);
  - "barbeiro exige profissional **ativo**" fica no serviço do Cortivo, não no banco (a situação
    do profissional muda depois da associação);
  - o cadastro de profissional é o mínimo do C01; campos da C02 entram em versões posteriores.
- Dependência explícita: a spec 009 precisa ser integrada antes (versão 1 imutável em `main`).
- FR-017 permite atualizar as verificações da 009 que fixam o Cortivo na versão 1 (por exemplo,
  `CS-COR-004`, "histórico na versão 1"); qualquer outra falha de teste existente é regressão.
