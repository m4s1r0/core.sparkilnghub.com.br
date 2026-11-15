# Contrato de interface — F03

Telas e ajustes do painel do Core em F03, design system pela API pública (constituição VIII),
dentro do layout autenticado de F01/F02, pt-BR, 360 px a desktop sem rolagem horizontal. Nenhuma
rota nova no menu lateral — tudo é ação ou aba dentro de `/instancias/:id`, exceto a página
pública de indisponibilidade.

| Rota | Tela | Componentes | Estados obrigatórios |
|---|---|---|---|
| `/instancias/:id` (ampliada) | Ações de ciclo no cabeçalho conforme o estado: "Ativar" (`PRONTA`), "Suspender"/"Entrar em manutenção" (`ATIVA`), "Reativar" (`SUSPENSA`), "Sair da manutenção" (`MANUTENCAO`), "Encerrar" (`SUSPENSA`) | `DropdownButton` (ações por estado), `Dialog` (motivo + confirmação, reaproveita `ReauthDialog` de F01), `Badge` (estado) | ação indisponível no estado atual (botão ausente, não desabilitado-sem-explicação), reautenticação pedida, pré-condição recusada com o motivo (ex.: "contratante inativo"), sucesso com nova linha na linha do tempo |
| `/instancias/:id` — aba "Saúde" (nova) | Versão do produto/schema aplicado, conectividade, última verificação com instante e resultado, último backup conhecido com instante/origem/resultado | `DescriptionList`, `Badge` (saudável/não, sucesso/falha), `Button` "Verificar agora", `Alert` (sem backup bem-sucedido registrado) | carregando, nunca verificado, verificação reprovada com motivo sanitizado, sem backup registrado (não é erro, é estado informativo) |
| `/instancias/:id` — aba "Migração" (nova, só quando `MANUTENCAO`; revista em 2026-11-13) | **Tarefa** (quando houver): "Migração em andamento"/"Última migração" · protocolo, `vOrigem → vAlvo`, status em pt-BR, etapa atual e tentativa, "Aplicando vN — nome (k de n)", erro sanitizado, término; tabela "Andamento das migrações"/"Migrações desta tarefa" (Versão, Migração, Situação). **Atualização disponível** (sem tarefa ativa): "N migrações pendentes: vAtual → vAlvo", tabela "Migrações a aplicar" com a situação de cada uma, avisos de divergência Core × banco do produto e de histórico indisponível; botão "Aplicar atualização" | `Alert`, `Badge` (status da tarefa e situação por migração), `Text`, `DataTable` (`compact`), `Button` (`loading` enquanto ativa) | carregando; já na versão vigente (texto informativo, botão desabilitado); pendentes listadas; backup prévio ausente (`409 NO_PRIOR_BACKUP` explicado no `Alert`); em execução (consulta a cada 2 s até terminar, depois atualiza cabeçalho, "Saúde" e pendentes); falha com etapa e mensagem sanitizada; falha parcial (pendentes a partir da versão efetiva, versão com falha marcada); histórico bloqueado (`Alert` de erro, botão desabilitado); histórico ilegível (pendentes pela versão do Core, situação "Indisponível") |
| `/instancias/:id` — diálogo "Encerrar" | Motivo, referência de exportação/backup aplicável (campo opcional), política de retenção (texto obrigatório) | `Dialog`, `Textarea` ×2, `Alert` (irreversível no MVP), `Button variant="danger"` | só habilitado a partir de `SUSPENSA`; confirmação exige reautenticação |
| `/i/:slug` (pública, nova) | Página mínima de indisponibilidade: título neutro, texto curto, orientação de contato | layout mínimo do design system (sem navegação autenticada), `Alert` | instância `SUSPENSA` ou `MANUTENCAO`; qualquer outro estado não usa esta rota como caminho normal |

Regras:

- **Ação de ciclo** sempre em `Dialog` com motivo obrigatório (exceto reativar e sair da
  manutenção, que não pedem motivo novo — a saída de manutenção dispara a checagem de saúde em
  vez de pedir texto) e reautenticação (`ReauthDialog` de F01).
- **Linha do tempo** (aba já existente de F02) passa a mostrar também as transições desta fatia,
  cada uma com motivo quando houver.
- **Erros** seguem o mesmo padrão de F02: mensagem segura e `correlationId`, nunca SQL, usuário
  MySQL ou caminho.
- **Aba "Migração" (adendo 2026-11-13, FR-033 a FR-035, R-09)**:
  - Fontes: `GET .../migration` (última tarefa, com `migrations[]` e situação por versão) e
    `GET .../migration/plan` (versão efetiva, registrada no Core, alvo, `pending[]`, `blocked`).
    Ambas em `web/src/api/instances.ts` (`useInstanceMigration`, `useInstanceMigrationPlan`).
  - Polling: `useInstanceMigration` usa `refetchInterval` de 2 s enquanto o status estiver em
    `MIGRATION_ACTIVE` (`pendente`, `em_execucao`, `aguardando_repeticao`) e para depois — mesmo
    padrão do acompanhamento de provisionamento de F02. Sem isso o botão fica em `loading` para
    sempre (defeito corrigido em 2026-11-13).
  - Ao sair de um estado ativo, invalida `instanceKey` (exato), `healthKey` e `migrationPlanKey`.
  - Rótulos: status da tarefa — Na fila, Em execução, Aguardando nova tentativa, Concluída,
    Falhou; situação da migração — Pendente, Em execução, Aplicada, Falhou, Interrompida
    (`status = null` → "Indisponível").
  - "Aplicar atualização" fica desabilitado quando não há pendentes ou quando `blocked` não é nulo;
    fica em `loading` enquanto a tarefa está ativa. Não há aplicação seletiva de versões.
- **Página pública** não usa cookie de sessão nem exige TLS adicional além do já aplicado ao
  domínio do Core; não lista nem confirma a existência de outros slugs (evita enumeração).
- **Lacunas do design system** (registrar em `docs/design-system-updates.md` se persistirem): a
  mesma falta de componente de linha do tempo já registrada em F02 cobre a aba "Migração"; nenhuma
  lacuna nova identificada até aqui.
