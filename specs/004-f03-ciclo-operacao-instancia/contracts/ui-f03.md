# Contrato de interface — F03

Telas e ajustes do painel do Core em F03, design system pela API pública (constituição VIII),
dentro do layout autenticado de F01/F02, pt-BR, 360 px a desktop sem rolagem horizontal. Nenhuma
rota nova no menu lateral — tudo é ação ou aba dentro de `/instancias/:id`, exceto a página
pública de indisponibilidade.

| Rota | Tela | Componentes | Estados obrigatórios |
|---|---|---|---|
| `/instancias/:id` (ampliada) | Ações de ciclo no cabeçalho conforme o estado: "Ativar" (`PRONTA`), "Suspender"/"Entrar em manutenção" (`ATIVA`), "Reativar" (`SUSPENSA`), "Sair da manutenção" (`MANUTENCAO`), "Encerrar" (`SUSPENSA`) | `DropdownButton` (ações por estado), `Dialog` (motivo + confirmação, reaproveita `ReauthDialog` de F01), `Badge` (estado) | ação indisponível no estado atual (botão ausente, não desabilitado-sem-explicação), reautenticação pedida, pré-condição recusada com o motivo (ex.: "contratante inativo"), sucesso com nova linha na linha do tempo |
| `/instancias/:id` — aba "Saúde" (nova) | Versão do produto/schema aplicado, conectividade, última verificação com instante e resultado, último backup conhecido com instante/origem/resultado | `DescriptionList`, `Badge` (saudável/não, sucesso/falha), `Button` "Verificar agora", `Alert` (sem backup bem-sucedido registrado) | carregando, nunca verificado, verificação reprovada com motivo sanitizado, sem backup registrado (não é erro, é estado informativo) |
| `/instancias/:id` — aba "Migração" (nova, só quando `MANUTENCAO`) | Versão atual × versão disponível do artefato, botão para aplicar, histórico de execuções (`admin_task` tipo migração) com etapas e tentativas | `DescriptionList`, `Button`, `StepsBlock` ou `Stepper`, `DataTable` (histórico), `Alert` | já na versão mais recente (botão ausente), backup prévio ausente (recusa explicada antes de tentar), em execução (atualiza a cada 2 s, como o acompanhamento de F02), falha com etapa e mensagem sanitizada |
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
- **Página pública** não usa cookie de sessão nem exige TLS adicional além do já aplicado ao
  domínio do Core; não lista nem confirma a existência de outros slugs (evita enumeração).
- **Lacunas do design system** (registrar em `docs/design-system-updates.md` se persistirem): a
  mesma falta de componente de linha do tempo já registrada em F02 cobre a aba "Migração"; nenhuma
  lacuna nova identificada até aqui.
