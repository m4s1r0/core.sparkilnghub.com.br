# Quickstart de validação — F02

Pré-requisitos: ambiente de F01 funcionando (`npm run dev:up` saudável, administrador da
plataforma com TOTP criado por `npm run bootstrap:admin`). Novas variáveis no `.env`
(documentadas em `.env.example`): `INSTANCE_SECRET_KEY` (32 bytes base64),
`INSTANCE_SECRET_KEY_VERSION`, opcionalmente `INSTANCE_DB_HOST`/`INSTANCE_DB_PORT` e
`PROVISIONING_MAX_ATTEMPTS`. Contratos: [openapi-f02.yaml](./contracts/openapi-f02.yaml),
[access-projection-v2.md](./contracts/access-projection-v2.md), [ui-f02.md](./contracts/ui-f02.md),
[commands-f02.md](./contracts/commands-f02.md). Modelo: [data-model.md](./data-model.md).

## 0. Atualização a partir de F01

```bash
npm run db:migrate                    # spark_core 0004, spark_identity 0004
npm run instances:migrate-access      # projeção v2 nas instâncias ref-a e ref-b
npm run db:seed
```

Esperado: `ref-a` e `ref-b` aparecem em `/instancias` como `ATIVA`, com o contratante sintético;
login de produto e validação de sessão de F01 continuam passando
(`npm run test:integration -- instance-sessions isolation`, CS-009).

## 1. Contratantes (US1)

Em `/contratantes/novo`: cadastrar uma pessoa jurídica com CNPJ válido e uma pessoa física com
CPF válido. Esperado:

- CNPJ com dígito verificador errado → erro no campo; CNPJ alfanumérico válido → aceito.
- Repetir o mesmo documento → `409 CONFLICT_DOCUMENT_TAKEN` com link para o existente.
- Começar outro cadastro com nome parecido ("Pet Feliz Ltda" × "PET FELIZ") → alerta de possível
  homônimo, com opção de continuar.
- Editar o nome em duas abas e salvar a mais antiga → `409 CONFLICT_VERSION`, dados digitados
  preservados.
- Inativar o contratante sintético (tem instâncias `ATIVA`) → recusado com a lista de `ref-a` e
  `ref-b` (CS-008).

## 2. Catálogo (US2)

`/produtos`: `sparkpet` aparece **não provisionável** (`SEM_PROVISIONADOR`); `sparkref` aparece
provisionável em desenvolvimento. Inativar `sparkref` → solicitar instância é recusado com
`CONFLICT_PRODUCT_NOT_PROVISIONABLE`; reativar. A tela não tem nenhum campo de SQL, script ou URL.
Teste de produção: `npm run test:integration -- catalog/catalog-production` (catálogo sem `sparkref`).

## 3. Provisionar até PRONTA (US3)

`/instancias/nova`: contratante do passo 1, produto `sparkref`, nome "Loja Centro", slug
"Loja Centro!" (o resumo mostra `loja-centro`), fuso padrão, e-mail `dona@example.test`.
Confirmar (pede TOTP se passaram 5 min). Esperado:

- Resposta imediata com protocolo `PRV-…`; o acompanhamento mostra as etapas até `PRONTA` em
  segundos (CS-002).
- `GET /internal/v1/instances/loja-centro/connection` com a credencial do `sparkref` → conexão;
  com a credencial de outro produto → `404`.
- Com essa conexão: ler o banco de `ref-a` → negado; `CREATE TABLE` → negado (CS-006).
- Login de produto em `loja-centro` → recusado (instância não ativa, `CA-SC-007`).
- Concorrência e repetição: `npm run test:integration -- provisioning/idempotency` (100 rodadas,
  mesma chave, chaves diferentes para o mesmo slug, reenvio após timeout; CS-003).

## 4. Falha, retomada e repetição (US4)

```bash
npm run test:integration -- provisioning/resume       # interrupção após cada etapa 3..8 (CS-004)
npm run test:integration -- provisioning/worker-kill  # SIGKILL do trabalhador na etapa 5 (NFR-014)
npm run test:integration -- provisioning/ownership    # banco/usuário sem prova de propriedade (CS-005)
```

Manual: parar o MySQL (`docker compose stop mysql`) durante uma solicitação → a tarefa fica
"aguardando repetição"; religar → conclui. Esgotar as tentativas (MySQL parado por mais tempo, ou
`PROVISIONING_MAX_ATTEMPTS=1`) → `FALHA_PROVISIONAMENTO` com etapa, protocolo e mensagem segura;
"Repetir" com motivo → retoma da última etapa válida, histórico preservado.

## 5. Convite inicial (US5)

Na instância `PRONTA` do passo 3: situação "aguardando emissão". "Emitir link" (TOTP recente) →
link exibido uma vez. Emitir de novo → o primeiro link passa a responder como inválido. Abrir o
link em janela anônima, criar a conta → vínculo de administrador registrado; a instância continua
`PRONTA` e o login de produto continua recusado. Avançar o relógio 48 h no teste
(`provisioning/initial-invitation`) → "expirado"; reemitir não toca banco nem credencial.

## 6. Consulta e acompanhamento (US6)

`/instancias`: filtrar por contratante, produto, estado e período. Detalhe: linha do tempo
(`CADASTRADA → PROVISIONANDO → PRONTA`, ator sistema), nome editável, slug sem edição (PUT com
`slug` → `422`), vigência com fim no passado → pendência exibida, estado inalterado.

## 7. Verificação completa

```bash
npm run verify
```

Inclui os testes novos (unidade: documentos, slug, classificação de erros; integração: etapas,
retomada, propriedade, concorrência, privilégios, catálogo em produção, auditoria só inclusão,
nenhum segredo em log; contrato: OpenAPI 1.2.0 e projeção v2; componente e E2E das telas novas em
360 e 1280 px) e `check:upgrade` a partir de `origin/main`.
