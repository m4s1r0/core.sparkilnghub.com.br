# Contrato de interface — F01

Telas do painel do Core em F01, com o design system 0.2.0 apenas pela API pública (constituição
VIII). Todas em `.sh-theme`, cabeçalho com a marca (como em F00), pt-BR, 360 px a desktop.

| Rota | Tela | Componentes | Estados obrigatórios |
|---|---|---|---|
| `/entrar` | Login (e-mail, senha) | `Input type=email`, `PasswordInput`, `Button`, `Alert` | inicial, enviando, inválido (campo), credenciais inválidas (mensagem genérica), limitado (429 com tempo), indisponível (503) |
| `/entrar/segundo-fator` | Código TOTP ou código de recuperação | `Input inputMode=numeric autocomplete=one-time-code`, `Button`, link "usar código de recuperação" | inicial, enviando, código inválido, limitado, sessão pré-MFA expirada |
| `/convite/:token` | Aceite de convite: nome, senha (conta nova) ou senha atual (conta existente) | `Input`, `PasswordInput` com ajuda da política, `Button`, `Alert` | carregando, convite inválido/expirado (mesma mensagem), inválido (política de senha), conta divergente, sucesso |
| `/conta/seguranca/totp` | Cadastro do TOTP: QR, segredo em texto, confirmação; depois códigos de recuperação exibidos uma vez com aviso e ação "Já guardei" | `Card`, imagem do QR (`qrcode`), `Text`, `Input`, `Button`, `Alert` | carregando, código inválido, sucesso (códigos), saída sem confirmar "Já guardei" pede confirmação |
| `/recuperar` | Pedido de recuperação (e-mail) | `Input`, `Button`, `Alert` | enviado (mensagem única), limitado |
| `/recuperar/:token` | Nova senha | `PasswordInput`, `Button`, `Alert` | link inválido, política, sucesso (aviso de sessões encerradas) |
| `/` | Situação do sistema (F00), agora protegida | — | 401 → `/entrar` |
| `/administradores` | Lista de administradores da plataforma; convidar; revogar convite pendente; inativar/reativar com motivo | `DataTable`, `Badge`, `Button`, `DropdownButton` (ações), `Dialog` (motivo), `Alert` | vazio impossível (há pelo menos o usuário), carregando, último administrador (ação desabilitada com motivo visível), reautenticação pedida, link exibido uma vez |
| `/contas` | Busca exata por e-mail; fila de pedidos de recuperação pendentes | `Input type=email`, `Button`, `DataTable`, `Alert` | inicial, nenhuma conta encontrada, carregando, fila vazia |
| `/contas/:id` | Conta: vínculos, bloquear (com prévia das instâncias), desbloquear, gerar link de recuperação | `DescriptionList`, `DataTable`, `Dialog`, `Alert` | prévia, pendências de revogação por instância, link exibido uma vez, reautenticação pedida |
| `/instancias` e `/instancias/:id/vinculos` | Referências de instância; vínculos e convites pendentes; convidar administrador/colaborador; mudar papel; revogar vínculo; revogar convite | `DataTable`, `Select` (papel), `Dialog`, `Badge`, `Alert` | conflito de versão (recarregar preservando o motivo digitado), último administrador (inclusive convite inicial), reautenticação pedida, revogação pendente |
| `/pendencias` | Revogações pendentes por instância (FR-027) | `DataTable`, `Badge` | vazio ("nenhuma pendência"), carregando, erro |

Regras:

- **Reautenticação** (FR-008): ação sensível sem TOTP confirmado nos últimos 5 min abre `Dialog`
  pedindo o código e repete a ação após sucesso; nunca guarda o código.
- **Links exibidos uma vez** (D-07): `Dialog` com o link, botão "Copiar" e aviso de que não poderá
  ser consultado de novo; fechar sem copiar pede confirmação.
- **Ação perigosa** (inativar, bloquear, revogar): `Button variant="danger"` dentro do `Dialog`,
  com motivo obrigatório e texto que diz o resultado ("Revogar acesso de Ana à Instância A").
- Nenhuma tela mostra senha, segredo, token ou hash depois de exibido; `autocomplete` correto
  (`current-password`, `new-password`, `one-time-code`).
- Lacuna do design system 0.2.0: não há campo de código de verificação nem gerador de QR; usar
  `Input` e `qrcode` (registrar em `docs/design-system-updates.md`).
