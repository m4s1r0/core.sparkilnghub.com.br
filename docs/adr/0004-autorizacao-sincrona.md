---
id: D-04
title: Autorização de produto por validação local na projeção de acesso da instância
status: confirmada
date: 2026-10-26
owner: Marcelo da Silva Rosas (responsável técnico)
requirements: [COM-014, COM-015, COM-018, SC-027, SC-028, T-03, T-04, T-15]
impacts:
  [
    docs/escopos/00-diretrizes-compartilhadas.md §3.2,
    docs/escopos/00-diretrizes-compartilhadas.md §4.3,
    specs/002-f01-identidade-contextos/spec.md,
    .specify/memory/constitution.md v1.2.0,
  ]
---

## Contexto

Suspensão, revogação de vínculo, bloqueio e troca de senha precisam alcançar sessões já abertas
(`COM-018`, `SC-027`, `SC-028`, `T-03`). A identidade é central no Core (D-02, confirmada). A
referência dos escopos (diretrizes §3.2 e §4.3) previa que cada requisição protegida do produto
consultasse o Core de forma síncrona, sem cache, o que torna o Core dependência em tempo real de
todo produto. Decidido durante a especificação da F01 (`specs/002-f01-identidade-contextos`).

Uma proposta inicial do responsável técnico incluía administradores da plataforma com token de
acesso irrestrito a todas as instâncias e sem consulta de revogação; foi descartada por conflitar
com a constituição (princípios I e II) e com `COM-010`.

## Decisão

**Validação local com revogação na instância.**

- Contas, senhas, MFA, convites e a fonte dos vínculos ficam somente em `spark_identity` (D-02).
- No login de produto, o Core confere senha e vínculo e grava a sessão no banco da própria
  instância, devolvendo ao produto um identificador opaco (`INSTANCE_TOKEN`); só o resumo do
  identificador é armazenado.
- O Core mantém no banco de cada instância a **projeção de acesso**: sessões, réplica mínima dos
  vínculos daquela instância (conta, nome de exibição, papel, estado), revogações e revisão de
  autorização. É contrato de dados versionado (constituição III).
- A cada requisição protegida, o produto valida sessão, vínculo e revisão na projeção do próprio
  banco, sem chamar o Core. O produto só lê a projeção e encerra sessões (logout).
- Revogações são gravadas na projeção de cada instância afetada antes de a operação ser informada
  como concluída; instância inacessível gera tarefa persistente com repetição e pendência visível.
- O administrador da plataforma não tem sessão, vínculo ou credencial de acesso a instâncias.

## Alternativas rejeitadas

- **Autorização síncrona no Core, sem cache** (referência dos escopos): revogação imediata, mas o
  Core vira dependência de cada requisição do produto (indisponibilidade = produto parado) e soma
  latência a toda operação.
- **Síncrona com cache curto**: reduz carga, mas cria janela de revogação igual ao TTL e contraria
  a regra de não usar cache positivo de autorização.
- **Credencial assinada validada pelo produto** (token autocontido): exige gestão e rotação de
  chaves e lista de revogação distribuída; contraria sessões opacas mantidas no servidor
  (`COM-014`).
- **Contas e senhas por instância**: revogaria D-02 e a conta única com vínculos em várias
  instâncias (`COM-008`, `COM-009`).
- **Administrador com acesso irrestrito e irrevogável às instâncias**: viola princípios I e II e
  `COM-010`; token vazado ou de ex-funcionário não poderia ser revogado.

## Consequências

- Sessões existentes continuam válidas com o Core indisponível; login, convites, recuperação e
  MFA dependem do Core e respondem com erro temporário (`T-15`).
- Revogação é imediata para instâncias acessíveis e fica pendente, visível e com repetição para
  instâncias inacessíveis; a sessão de produto expira em no máximo 12 h de qualquer forma.
- O Core passa a escrever no banco das instâncias (projeção de acesso), com credencial e
  privilégios a definir no plano da F01; a constituição foi emendada para v1.2.0 (princípios I, II
  e III).
- Restauração de backup de instância exige reaplicar a projeção atual antes de liberar acesso
  (diretrizes §9, `T-16`).
- Os escopos não são reescritos; esta ADR registra a divergência das diretrizes §3.2 e §4.3.
