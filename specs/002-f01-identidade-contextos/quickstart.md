# Quickstart de validação — F01

Pré-requisitos: ambiente de F00 funcionando (`npm run dev:up` saudável). Novas variáveis no `.env`
(documentadas em `.env.example`): `IDENTITY_SECRET_KEY` (32 bytes base64), `PUBLIC_ORIGIN`,
`MYSQL_ACCESS_WRITER_PASSWORD`, `SEED_USER_PASSWORD`, `SPARKREF_APP_CREDENTIAL` (gerada pelo seed).
Contratos: [openapi-f01.yaml](./contracts/openapi-f01.yaml),
[access-projection.md](./contracts/access-projection.md), [ui-f01.md](./contracts/ui-f01.md).

## 1. Primeiro administrador (US1)

```bash
npm run dev:reset
npm run bootstrap:admin -- admin@example.test   # imprime o link do convite uma vez
npm run bootstrap:admin -- outro@example.test   # ainda pendente → recusa (saída 3)
```

Abrir o link → definir nome e senha (≥ 12, fora da lista comum) → cadastrar TOTP num app
autenticador → guardar os 10 códigos → entrar em `/entrar` com e-mail, senha e código. Esperado:
`/` mostra a situação do sistema; `/api/v1/session` retorna a conta com `mfa.confirmed = true`.

- 10 senhas erradas seguidas → 11ª tentativa recebe `429` com `Retry-After` (CS-007).
- Sem atividade por 30 min (ou ajustando o relógio do teste) → próxima requisição `401`.
- `Sair` → o mesmo cookie recebe `401`.

## 2. Equipe de administração (US2)

Convidar `segundo@example.test` (pede o TOTP de novo se passaram 5 min), aceitar em outra janela
anônima, inativar e reativar. Tentar inativar o último ativo → `409 CONFLICT_LAST_ADMIN`. Teste de
concorrência: `npm run test:integration -- last-admin` (100 rodadas, CS-004).

## 3. Sessões de produto e isolamento (US3)

Com as sementes: instâncias `ref-a` e `ref-b`, contas `ana` (A), `bruno` (B), `carla` (A e B).

```bash
npm run test:integration -- instance-sessions isolation
```

Cobre: login de `ana` em A grava sessão só em `sparkref_<A>_acc`; `ana` em B → `401` igual a senha
errada; token de A apresentado em B → inválido; usuário `inst_*` de A não consegue `INSERT` em
`access_session` nem `UPDATE` de `access_member` (erro de privilégio); credencial de outro produto
→ `401`; Core parado → sessões válidas continuam passando na regra de validação e login novo recebe
`503` (CS-009). Validação p95 ≤ 10 ms e login de produto p95 ≤ 1 s (CS-006) em
`npm run test:integration -- perf-access`.

## 4. Vínculos (US4)

No painel, `/instancias/<A>/vinculos`: convidar `bruno@example.test` como colaborador em A (conta
existente: aceite exige a senha atual dele, sem trocá-la); mudar papel; revogar. Esperado: sessões
de `bruno` em A encerradas na hora (`end_reason = vinculo_revogado`), B continua válida.
Revogar o último administrador de A → `409`. Pelo contrato interno (administrador local de A):
listar/convidar/revogar só em A; vínculo de B → `404`.

## 5. Recuperação e bloqueio (US5)

`/recuperar` com qualquer e-mail → mesma mensagem. No painel, conta `carla` → "Gerar link de
recuperação" (link exibido uma vez) → trocar senha → sessões de `carla` em A e B encerradas.
"Bloquear conta" → prévia mostra A e B → confirmar com motivo e TOTP → resposta
`{A: aplicada, B: aplicada}`. Parar o MySQL só para B não é possível no ambiente local de um
servidor; a pendência é provada por teste com banco de acesso inacessível
(`npm run test:integration -- access-sync-pending`).

## 6. Verificação completa

`npm run verify` (16 etapas de F00 + novas suítes) verde; E2E inclui login com TOTP calculado no
teste, telas em 360/1280 px e a matriz de estados de [ui-f01.md](./contracts/ui-f01.md).
