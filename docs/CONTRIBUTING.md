# Como contribuir com o SparkCore

Regras de trabalho do repositório. A fonte de governança é a constituição em
`.specify/memory/constitution.md`; em caso de conflito, ela prevalece.

## Branches e integração

- Toda mudança parte de `main` em uma branch por funcionalidade, nomeada `NNN-slug`
  (ex.: `001-f00-base-decisoes`), igual ao diretório da especificação em `specs/`.
- A integração em `main` é feita por pull request com **revisão aprovada** e com a verificação
  automática verde (ver "Proteção de `main`").
- Commits e PRs citam os identificadores estáveis afetados (`FR-*`, `COM-*`, `SC-*`, `NFR-*`,
  `D-*`, `T-*`).

## Fluxo Spec Kit por fatia

`/speckit-specify` → `/speckit-clarify` (quando houver ambiguidade) → `/speckit-plan` →
`/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`.

Uma fatia só entra em implementação quando `npm run gate -- <fatia>` passa, isto é, quando as
decisões exigidas em `docs/slices.yaml` estão confirmadas em `docs/adr/`.

## Verificação local

`npm run verify` executa as mesmas etapas da CI. Uma mudança não é integrada com etapa vermelha.
Cobertura percentual não é critério de aceite; a evidência é por requisito e cenário.

## Design system

- A interface consome `@sparkling-hub/design-system` apenas pela API pública, na versão fixada
  em `vendor/design-system/`.
- Atualizar a versão é uma mudança revisada: copiar o novo `.tgz` sem alteração, atualizar
  `web/package.json` e `vendor/design-system/README.md`, registrar versão anterior e nova,
  motivo e testes executados em `docs/design-system-updates.md`, ler o changelog do pacote e
  reexecutar os testes de interface. `npm run check:ds` falha se o `.tgz` mudar sem essa entrada.
- Componente ou bloco que falte é proposto no design system, não copiado para cá.

## Credenciais de aplicação (contratos internos)

- Cada produto chama `/internal/v1` com uma credencial própria (`npm run app-credential --
create <produto> <rótulo> --scopes sessions,members,connection`), com o menor escopo necessário.
  O escopo `connection` (F02) entrega a senha operacional da instância: só o processo do produto
  que abre as conexões deve tê-lo. O segredo
  aparece uma única vez; guarde-o no cofre do ambiente, nunca no repositório, em log ou em ticket.
- A credencial define o produto: instâncias de outro produto são tratadas como inexistentes.
- Rotação sem parada: crie a nova, implante no produto, confirme o uso (`app-credential -- list`
  mostra o último uso) e então revogue a antiga (`app-credential -- revoke <id>`).
- Suspeita de vazamento: revogue imediatamente; a revogação vale na requisição seguinte.
- Em desenvolvimento, a credencial do `sparkref` criada pelo `db:seed` só vale para as instâncias
  sintéticas e fica apenas no `.env` local (`SPARKREF_APP_CREDENTIAL`).

## Proteção de `main` (configuração manual no GitHub)

Em **Settings → Branches → Branch protection rules** para `main`:

1. Exigir pull request antes do merge, com pelo menos uma aprovação.
2. Exigir que os status checks passem: `static`, `secrets`, `test` e `e2e` (workflow
   `verify`).
3. Exigir branch atualizada antes do merge.
4. Não permitir push direto nem force push.
