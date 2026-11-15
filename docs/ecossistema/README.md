# Padrões canônicos do ecossistema Spark

**Versão:** 1.0.0 · **Data:** 15/11/2026 · **Situação:** vigente para todo SaaS novo; adoção
progressiva no Tuteli conforme [06 — Conformidade](./06-conformidade-produtos.md).

Este diretório é a **fonte canônica** das regras que todo SaaS da Sparkling Hub segue ao se
integrar ao SparkCore. Ele consolida o que já foi decidido e provado no SparkCore e no Tuteli
(primeiro produto real), corrige divergências encontradas na inspeção de 15/11/2026 e transforma a
auditoria de segurança do Tuteli em linha de base obrigatória.

Um produto novo (Cortivo, Paginor, Forneli, Reparum, Pulsari, Sutila) **não** relê o histórico do
Tuteli para descobrir como fazer: lê este diretório, os contratos em [`contracts/`](../../contracts/)
e o seu próprio escopo.

## Documentos

| Ordem | Documento | Conteúdo |
| --- | --- | --- |
| 1 | [01 — Registro de produtos](./01-registro-de-produtos.md) | Nome, código técnico, prefixo de banco, repositório, portas e marca de cada produto. Corrige a tabela de portas. |
| 2 | [02 — Arquitetura padrão de um SaaS](./02-arquitetura-padrao-saas.md) | Estrutura de repositório, stack, módulos, banco por instância, constituição derivada, fluxo Spec Kit e portões. |
| 3 | [03 — Contrato SaaS ↔ SparkCore](./03-contrato-saas-core.md) | Padrão de comunicação: credencial, conexão, login, validação pela projeção, touch, logout, membros, convites, utilização, erros e indisponibilidade. |
| 4 | [04 — Padrão de interface](./04-padrao-interface.md) | Design system, shell com menu lateral, breadcrumbs, layout, paleta, máscaras obrigatórias e identidade visual por produto. |
| 5 | [05 — Linha de base de segurança](./05-baseline-seguranca.md) | Os 22 achados da auditoria de 15/11/2026 convertidos em requisitos `SEC-BASE-*` para todos os produtos, com teste de aceite. |
| 6 | [06 — Conformidade dos produtos](./06-conformidade-produtos.md) | Situação do Core, Tuteli e Cortivo frente a cada padrão, com ações e responsáveis. |
| 7 | [07 — Checklist de novo SaaS](./07-checklist-novo-saas.md) | Passo a passo do C00 de qualquer produto e modelo de prompt SDD de entrada. |

## Precedência

1. Constituição do SparkCore (`.specify/memory/constitution.md`) e ADRs em [`docs/adr/`](../adr/).
2. Contratos publicados em [`contracts/`](../../contracts/) (OpenAPI, projeção de acesso, artefato
   de migração, convenções).
3. **Este diretório** (padrões canônicos de ecossistema).
4. Escopo do produto (ex.: `cortivo/.../docs/escopo/`).
5. Implementação do Tuteli como referência prática.

Em conflito entre um escopo de produto e este diretório, prevalece este diretório até que uma
decisão registrada (ADR no Core ou deliberação no produto) resolva a divergência. A implementação
do Tuteli **não** é norma: onde ela diverge daqui (ver [06](./06-conformidade-produtos.md)), o
Tuteli é que precisa convergir.

## Linguagem normativa

`DEVE` / `NÃO DEVE` são obrigatórios e verificados no Constitution Check de cada plano.
`DEVERIA` é recomendação forte; o desvio é registrado na seção de complexidade do `plan.md`.
`PODE` é opcional. Os identificadores (`ECO-*`, `INT-*`, `UI-*`, `SEC-BASE-*`) são estáveis para
rastreabilidade em specs, testes e evidências.

## Fontes consolidadas

- Diretrizes do hub: `sparklinghub.com.br/docs/escopos/00-diretrizes-compartilhadas.md`.
- Marcas aprovadas: `sparklinghub.com.br/UX/marcas-produtos.md` e
  `UX/assets/logomarcas-produtos/final-v1/`.
- Design system: `C:\repos\designsystem.sparklinghub.com.br` (versão 0.5.0, 15/11/2026).
- Auditoria de segurança: `tuteli/.../docs/seguranca/prompt-sdd-hardening-seguranca.md`.
- Implementação de referência: Tuteli `51b152e` (branch `009-ficha-tutor-abas`) e Core
  `f0a3920` (branch `006-tuteli-artefato-provisionador`).

## Manutenção

Mudança nestes padrões segue o mesmo rito da constituição: versão semântica neste README,
registro no [histórico](#histórico), impacto declarado em cada produto em
[06](./06-conformidade-produtos.md). Mudança que altere contrato `/internal/v1` exige também
entrada em [`contracts/CHANGELOG.md`](../../contracts/CHANGELOG.md).

## Histórico

- **1.0.0 — 15/11/2026.** Primeira consolidação: registro de produtos com correção de portas,
  arquitetura padrão, contrato SaaS↔Core com validação pela projeção (D-04) como norma, padrão de
  interface (menu lateral, breadcrumbs, máscaras do DS 0.5.0, marca por produto), linha de base
  de segurança `SEC-BASE-01..22` e matriz de conformidade.
