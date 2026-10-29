# Research — F02 Catálogo e provisionamento

**Data**: 2026-10-27 · **Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

Base técnica herdada (D-05): Node.js 24, TypeScript 5.9, Fastify 5 + TypeBox, `mysql2` + Kysely
(`sql` templates), migrador próprio, MySQL 8.4, React 19 + Tailwind v4 + TanStack Query sobre o
design system 0.2.0. De F00 vêm o aplicador de artefato (`apply-artifact.ts`), o validador e o
contrato do artefato (`contracts/migration-artifact.md`); de F01 vêm a projeção de acesso
(`<instância>_acc`), os convites de instância, a idempotência, o `KeyRing` (AES-256-GCM), a
reautenticação de 5 min e o padrão de tarefa com lease (`access_sync_job`). Constituição v1.2.1.

Nenhum item do contexto técnico ficou como NEEDS CLARIFICATION; as escolhas abaixo resolvem os
pontos abertos da especificação.

## R-01 — Modelo de instância: ampliar a referência de F01

- **Decision**: a migração `spark_core` 0004 renomeia `instance_ref` para `instance` e acrescenta
  contratante, estado, fuso, e-mail do administrador inicial, versão de schema aplicada, versão
  otimista, anotações, vigência e marcas de tempo. O módulo `instances/` passa a ser o dono da
  tabela; as seis referências de F01 (`instance-ref.ts`, `access-reconcile.ts`) são ajustadas.
- **Rationale**: a spec define uma única entidade "instância" que amplia a referência mínima
  (FR-044); duas tabelas com o mesmo UUID duplicariam estado e revisão de autorização.
- **Alternatives considered**: tabela nova `instance` com chave para `instance_ref` (dois lugares
  para slug e revisão); manter o nome `instance_ref` (nome enganoso depois de F02).

## R-02 — Máquina de estados e transições

- **Decision**: `instance.state` ENUM com os oito estados do escopo (§5), para que F03 não precise
  alterar o tipo. Em F02 o serviço de transição aceita só `CADASTRADA → PROVISIONANDO`,
  `PROVISIONANDO → PRONTA | FALHA_PROVISIONAMENTO` e `FALHA_PROVISIONAMENTO → PROVISIONANDO`.
  Toda transição usa `SELECT … FOR UPDATE` na instância, confere o estado esperado, grava
  `instance_transition` (só inclusão) e atualiza o estado na mesma transação. Não existe rota que
  altere `state` diretamente (`RN-SC-001`).
- **Rationale**: a pré-condição dentro da trava impede duas transições concorrentes a partir do
  mesmo estado.
- **Alternatives considered**: estados livres em VARCHAR (sem garantia no banco); tabela de
  transições permitidas no banco (rigidez sem ganho; a regra fica no código e em testes).

## R-03 — Tarefa persistente de provisionamento

- **Decision**: tabelas `admin_task` (genérica, `kind = 'provisionamento'`; migração e restauração
  chegam em F03) e `admin_task_step_run` (uma linha por tentativa de etapa, nunca sobrescrita).
  Protocolo legível `PRV-000123` a partir de um `AUTO_INCREMENT` da tarefa. Trava por lease de
  **60 s**, renovado por heartbeat a cada **20 s** enquanto a etapa roda; o trabalhador pega
  tarefas com `UPDATE … WHERE (lease_until IS NULL OR lease_until < agora)` dentro de transação
  com `FOR UPDATE SKIP LOCKED`. Uma tarefa estrutural ativa por instância por índice único sobre
  coluna gerada (`instance_id` quando `status` ∈ {pendente, em_execucao, aguardando_repeticao}).
  Se o lease expirar, outro trabalhador assume e a primeira tentativa em curso vira
  `interrompida` no histórico.
- **Rationale**: mesmo padrão já provado em `access_sync_job` (F01 R-10) e exigido por
  `SC-022`/`NFR-014`; `SKIP LOCKED` evita disputa entre trabalhadores sem broker (constituição
  VII).
- **Alternatives considered**: `GET_LOCK` do MySQL (preso à conexão, se perde com o processo e não
  deixa rastro); fila externa (proibida no MVP).

## R-04 — Idempotência da solicitação e da nova execução

- **Decision**: a chave `Idempotency-Key` da solicitação é gravada na própria `admin_task`
  (`requested_by`, `idempotency_key`, `request_hash`) com índice único `(requested_by,
  idempotency_key)`, na mesma transação que cria a instância e a tarefa em `spark_core`. Mesma
  chave e mesmo resumo devolvem a mesma instância e protocolo; resumo diferente → `409
  CONFLICT_IDEMPOTENCY_MISMATCH`. Nova execução e emissão do convite usam o `withIdempotency` de
  F01, pois não criam recursos estruturais.
- **Rationale**: `idempotency_record` fica em `spark_identity`; usá-la para a solicitação deixaria
  a chave e a instância em bancos diferentes, sem atomicidade. Com a chave na tarefa, o reenvio
  após timeout encontra exatamente o que foi criado (`T-01`, `T-15`). A tarefa nunca é apagada,
  então a garantia excede as 24 h exigidas.
- **Alternatives considered**: `withIdempotency` também para a solicitação (janela entre criar a
  instância e gravar a resposta); idempotência só pelo slug (não distingue reenvio legítimo de
  conflito).

## R-05 — Slug: normalização, reservas e concorrência

- **Decision**: normalização NFD sem diacríticos, minúsculas, espaços e `_` viram `-`, hífens
  repetidos colapsados e removidos das pontas; válido se casar com `^[a-z][a-z0-9-]{1,61}[a-z0-9]$`
  (3–63). Palavras reservadas em `server/assets/reserved-slugs.txt` (`admin`, `api`, `app`,
  `core`, `i`, `internal`, `login`, `static`, `www`, …). Unicidade por `UNIQUE (product_code,
  slug)` em `instance`; `ER_DUP_ENTRY` na criação → `409 CONFLICT_SLUG_TAKEN`. O endpoint de
  prévia devolve o slug normalizado e a disponibilidade, sem reservar.
- **Rationale**: a trava real é o índice único (`COM-025`); a prévia só ajuda a interface.
  Instâncias com falha continuam com o slug (FR-012).
- **Alternatives considered**: reservar slug numa tabela separada com expiração (mais estado sem
  ganho).

## R-06 — Etapas, intenção registrada e prova de propriedade

- **Decision**: antes de cada efeito no MySQL, a etapa grava em `instance_resource` a **intenção**
  (`status = 'pretendido'`, tarefa, nome derivado do UUID); depois do efeito, verifica e marca
  `criado`. Na retomada:
  - **Banco operacional**: se existe e há intenção desta instância, é adotado quando o marcador
    `_spark_instance` tem o UUID da instância **ou** o banco não tem nenhuma tabela (queda entre
    `CREATE DATABASE` e a v1, `CA-SC-006`). Sem intenção, com tabelas e sem marcador, ou com
    marcador de outra instância → `PROVISIONING_RESOURCE_CONFLICT`, sem alterar nada.
  - **Banco de acesso**: mesma regra, com `access_instance` no lugar do marcador (já existe em
    `apply-artifact.ts`).
  - **Usuário MySQL**: a senha é gerada e gravada **cifrada** junto com a intenção antes do
    `CREATE USER`. Se o `CREATE USER` responder 1396 (já existe) e houver intenção desta tarefa, a
    etapa executa `ALTER USER … IDENTIFIED BY` com a senha guardada (o privilégio `CREATE USER` do
    provisionador permite) e reaplica os `GRANT`s, que são idempotentes. Sem intenção → conflito.
  - **Convite inicial**: existe no máximo um convite inicial por instância criado pela tarefa;
    a etapa procura antes de inserir.
- **Rationale**: o MySQL faz commit implícito em DDL (diretrizes §5.2); só o registro prévio
  permite distinguir "fui eu que comecei" de "recurso desconhecido" (`SC-021`). Nomes derivam de
  UUID v7 recém-gerado, então conflito real indica anomalia operacional (restauração, ação
  manual).
- **Alternatives considered**: atributos de usuário do MySQL (`CREATE USER … ATTRIBUTE`) como
  marcador (visibilidade depende de privilégio sobre `mysql.user`, que o provisionador não tem);
  apagar e recriar recursos parciais (proibido: `RN-SC-004`).

As etapas de F02, numeradas como na spec (FR-021):

| # | Etapa | Efeito | Verificação na retomada |
|---|---|---|---|
| 1 | `validar` | confere que o provisionador do produto continua registrado e permitido no ambiente e que o manifesto implantado tem o mesmo `manifest_sha256` fixado na tarefa; a situação do contratante e do produto só é avaliada na solicitação, e inativá-los depois não interrompe a tarefa (spec, edge cases) | repetível |
| 2 | `reservar` | feita na criação da tarefa (instância `CADASTRADA` + tarefa); o trabalhador só transiciona para `PROVISIONANDO` | estado |
| 3 | `criar_bancos` | `CREATE DATABASE` operacional e de acesso | intenção + regra acima |
| 4 | `criar_credencial` | `CREATE USER`/`ALTER USER`, `GRANT` no operacional; `GRANT`s da projeção | intenção + segredo guardado |
| 5 | `aplicar_migracoes` | `migrate()` do artefato fixado; projeção de acesso na versão vigente | histórico `_spark_schema_history` / `_spark_access_history` |
| 6 | `configurar` | linha de `_spark_instance` (após v1) e `access_instance` com estado `pronta` | leitura das linhas |
| 7 | `preparar_convite` | convite inicial pendente sem link emitido | busca do convite inicial da instância |
| 8 | `verificar` | conecta com a credencial operacional, lê o marcador, confere versão, prontidão do produto (conforme `contracts/migration-artifact.md`) e privilégios negativos (não cria tabela, não lê outro banco) | repetível |
| 9 | `concluir` | transição `PROVISIONANDO → PRONTA` | estado |

A transação da solicitação (processo web) grava `validar` e `reservar` como execuções concluídas da
execução 1, junto com a instância e a tarefa. O trabalhador começa na primeira etapa não concluída
(`criar_bancos`) e, antes dela, repete apenas a conferência do artefato da etapa 1, registrada como
nova tentativa de `validar`.

O `apply-artifact.ts` de F00/F01 é decomposto nessas etapas (as funções internas viram passos
reutilizáveis); as sementes passam a usar o mesmo provisionador em modo síncrono.

## R-07 — Migrações dentro do provisionamento

- **Decision**: a etapa 5 usa `migrate()` como está. O artefato e o resumo do manifesto são
  fixados na tarefa ao criá-la (`artifact_code`, `artifact_version`, `manifest_sha256`); se o
  código implantado mudar de versão no meio, a etapa falha com `PROVISIONING_ARTIFACT_CHANGED` em
  vez de misturar versões. Uma versão interrompida no meio (linha `falha` no histórico) não é
  repetida automaticamente: `migrate()` recusa com `SCHEMA_FAILED`, que é **falha não transitória**
  → `FALHA_PROVISIONAMENTO` com código `PROVISIONING_MIGRATION_INTERRUPTED` e orientação de
  procedimento operacional. Interrupções **entre** versões (o caso de `CA-SC-006`, `T-02` e
  `CS-004`) retomam normalmente.
- **Rationale**: o MySQL não desfaz DDL de uma versão com várias instruções; repetir às cegas
  poderia aplicar metade de novo. Manter a regra de F00 R-04 evita uma segunda semântica de
  migração.
- **Alternatives considered**: exigir DDL idempotente nos artefatos (MySQL não tem `ADD COLUMN IF
  NOT EXISTS`); uma instrução por versão (restrição exagerada para o Tuteli); recriar o banco
  sob novo nome (deixaria bancos órfãos sem procedimento de limpeza).
- **Consequência para a spec**: a nova execução (US4, cenário 4) resolve causas corrigíveis
  (MySQL fora, privilégio ausente, falha antes da versão começar); versão interrompida exige
  procedimento operacional, documentado em `docs/operacao/provisionamento.md`. Registrado nas
  edge cases.

## R-08 — Classificação de falhas e repetição automática

- **Decision**: transitórias = perda ou recusa de conexão (`ECONNREFUSED`, `ECONNRESET`,
  `PROTOCOL_CONNECTION_LOST`, `ETIMEDOUT`), `ER_LOCK_DEADLOCK`, `ER_LOCK_WAIT_TIMEOUT`,
  `ER_CON_COUNT_ERROR`, servidor somente leitura. Não transitórias = privilégio negado,
  artefato inválido ou alterado, recurso em conflito, versão interrompida, erro de SQL do
  artefato. Até **5 tentativas** por etapa em cada execução, com espera `5 s × 3^(n-1)` limitada a
  5 min; esgotado ou não transitório → `FALHA_PROVISIONAMENTO`. A mensagem gravada é um código
  estável + texto seguro; a causa técnica vai só ao log estruturado, sem SQL nem nomes de usuário
  MySQL.
- **Rationale**: `SC-023` e FR-025; valores dentro da proposta da spec e configuráveis
  (`PROVISIONING_MAX_ATTEMPTS`).
- **Alternatives considered**: repetir qualquer erro (mascara falhas permanentes e atrasa o
  diagnóstico).

## R-09 — Segredo da credencial operacional

- **Decision**: senha de 32 bytes aleatórios (base64url), cifrada com AES-256-GCM pelo `KeyRing`
  com a nova chave **`INSTANCE_SECRET_KEY`** (+ `INSTANCE_SECRET_KEY_VERSION`), AAD = UUID da
  instância, gravada em `instance_resource.secret_enc`. Só o trabalhador cifra (ao criar) e só o
  contrato interno de conexão decifra. Nunca é exibida no painel, logada ou incluída em auditoria.
- **Rationale**: constituição ("cifrados com chave externa ao banco"); chave separada da
  `IDENTITY_SECRET_KEY` reduz o alcance de um vazamento e permite rotações independentes.
- **Alternatives considered**: reaproveitar `IDENTITY_SECRET_KEY` (mistura domínios); cofre de
  segredos externo (fora do alcance do MVP local; o `KeyRing` permite trocar depois).

## R-10 — Contrato interno de conexão do produto

- **Decision**: `GET /internal/v1/instances/{slug}/connection`, autenticado com credencial de
  aplicação do produto e novo escopo `connection` (a coluna `app_credential.scopes` ganha o
  valor). Resposta: `instanceId`, `state`, `host`, `port`, `database`, `accessDatabase`, `user`,
  `password`, `credentialVersion`; cabeçalhos `Cache-Control: no-store`. Instância de outro produto
  ou inexistente → `404` idêntico. Instância sem recursos prontos (`CADASTRADA`, `PROVISIONANDO`,
  `FALHA_PROVISIONAMENTO`) → `409 INSTANCE_NOT_READY`. Endereço e porta vêm de
  `INSTANCE_DB_HOST`/`INSTANCE_DB_PORT` (o endereço que os produtos usam, que pode diferir do
  usado pelo Core). Evento de segurança `conexao_entregue` sem a senha. O produto pode guardar a
  conexão em memória; com o Core fora, continua validando sessões pela projeção (F01, `T-15`).
- **Rationale**: diretrizes §6.1 ("referência opaca de conexão") e FR-031; a credencial de
  aplicação já tem escopo, rotação e validade (F01 R-09).
- **Alternatives considered**: o produto ler um arquivo de segredos por instância (não acompanha
  instâncias provisionadas em tempo de execução); o Core fazer proxy das consultas do produto
  (dependência síncrona que a D-04 evitou).

## R-11 — Projeção de acesso v2 e instância ainda não ativa

- **Decision**: artefato `access_projection` v2 acrescenta `'pronta'` ao ENUM
  `access_instance.state`. O provisionamento grava `pronta`; F03 passará a `ativa`. A regra
  normativa de validação (`state = 'ativa'`) não muda, então a v2 é **compatível** (o produto que
  conhece só a v1 continua negando sessões em instância pronta). Além disso, o login de produto no
  Core passa a exigir `instance.state = 'ATIVA'` antes de gravar qualquer sessão (`CA-SC-007`).
  As instâncias de F01 recebem a v2 pelo comando `npm run instances:migrate-access`, com a
  credencial do provisionador (o `db:migrate` continua só com a credencial de migração do Core).
- **Rationale**: sem um valor próprio, a instância pronta teria de usar `manutencao`, que tem outro
  significado em F03.
- **Alternatives considered**: não criar `access_instance` até a ativação (o produto não teria
  como distinguir "não ativa" de "banco quebrado").

## R-12 — Convite inicial preparado e emissão do link

- **Decision**: a etapa 7 insere em `spark_identity.invitation` um convite `instancia`,
  `administrador`, `is_initial = TRUE`, `status = 'pendente'`, com token aleatório **descartado**
  (só o sha256 é gravado, como sempre) e nova coluna `link_issued_at = NULL` ("aguardando
  emissão"). A emissão (`POST /api/v1/instances/{id}/initial-invitation/issue`) usa
  `createInvitationTx` de F01: revoga o pendente, cria outro com 48 h, grava `link_issued_at` e
  devolve o link uma única vez (resposta cifrada no registro de idempotência, como em F01).
  A situação exibida combina `status`, `expires_at` e `link_issued_at`: aguardando emissão,
  emitido, expirado, aceito, revogado. O trabalhador já tem `INSERT` em `spark_identity`; não
  precisa de `UPDATE`.
- **Rationale**: D-07 (link exibido a quem o gerou); a tarefa roda sem ninguém para receber o link
  (Assumptions da spec). Reaproveita reenvio, expiração e aceite de F01 sem código novo de
  convite.
- **Alternatives considered**: guardar o token cifrado para exibir depois (viola "persistência só
  do resumo", `COM-019`); criar o convite só na emissão (a "identidade preparada" de `SC-024`
  deixaria de ser verificável antes da emissão).
- **Nota para F03**: a ativação deve exigir administrador ativo ou convite inicial **emitido** e
  válido (`link_issued_at` não nulo, não expirado).

## R-13 — Contratantes: documento, homônimos e edição concorrente

- **Decision**:
  - CPF: 11 dígitos, dígitos verificadores módulo 11, recusa sequências repetidas.
  - CNPJ: 14 posições, as 12 primeiras alfanuméricas (`[0-9A-Z]`) e as 2 últimas numéricas;
    dígitos verificadores módulo 11 com valor do caractere = código ASCII − 48 (regra da Receita
    Federal para o CNPJ alfanumérico, que também valida o numérico). Normalização: maiúsculas, sem
    pontuação. Vetores de teste do material público da Receita Federal.
  - Unicidade: `UNIQUE (document_type, document_normalized)` com nulos permitidos.
  - Homônimos: `name_key` = nome sem acentos, minúsculas, sem pontuação e sem sufixos societários
    (`ltda`, `me`, `epp`, `eireli`, `sa`, `s/a`); candidatos = mesma chave, uma contida na outra
    ou mesmo documento; até 10 resultados.
  - Edição: coluna `version`, `UPDATE … WHERE version = ?`; 0 linhas → `409 CONFLICT_VERSION`.
  - Telefone opcional só com dígitos (10 a 13); endereço opcional estruturado (CEP, logradouro,
    número, complemento, bairro, cidade, UF).
- **Rationale**: `SC-004`, `SC-005`, `COM-027`; o CNPJ alfanumérico passou a ser emitido em 2026 e
  precisa ser aceito desde já.
- **Alternatives considered**: biblioteca de validação de documentos (pouco ganho para ~40
  linhas testáveis; várias ainda não tratam o formato alfanumérico); busca FULLTEXT (volume do MVP
  não justifica).

## R-14 — Catálogo: dados no banco, provisionadores no código

- **Decision**: tabela `product` com código (PK), nome, descrição, situação, versão e marca
  `reference_only`. Um registro em código (`server/src/modules/catalog/provisioners.ts`) mapeia
  código → diretório do artefato e ambientes permitidos. "Provisionável" é calculado em tempo de
  execução: produto ativo + provisionador registrado + artefato válido (`validateArtifact`) +
  ambiente permitido. A migração 0004 insere `sparkpet` (sem provisionador ⇒ não provisionável)
  em todos os ambientes; `sparkref` é inserido pela migração apenas quando existirem instâncias
  sintéticas de F01 e pelas sementes nos demais casos; em `production` o catálogo filtra
  `reference_only` e o registro recusa o provisionador. A interface edita só nome, descrição e
  situação; criar produto exige código implantado (`SC-008`).
- **Rationale**: FR-007/FR-010; nenhuma entrada de interface pode apontar para código.
- **Alternatives considered**: catálogo inteiro em código (não permitiria inativar produto pela
  interface); caminho do artefato no banco (abre a porta para "URL de código", proibida por
  `SC-009`).

## R-15 — Privilégios e credenciais por processo

- **Decision**: o trabalhador passa a carregar a credencial `provisioner` além de `worker` e
  `access`; o processo web continua sem ela. Os privilégios do provisionador de F00 já cobrem
  `sparkref\_%`/`sparkpet\_%` (inclusive os bancos `_acc`) e `CREATE USER`. Nenhuma mudança no
  script de init além do novo valor de escopo; `INSTANCE_SECRET_KEY` é exigida pelos dois
  processos (web decifra para o contrato de conexão, trabalhador cifra).
- **Rationale**: constituição I/IV (privilégios separados) e "o processo web não tem DDL".
- **Alternatives considered**: provisionar no processo web (daria DDL e acesso aos bancos de
  produto ao processo exposto à internet).

## R-16 — Auditoria administrativa do Core

- **Decision**: tabela `core_audit_event` em `spark_core`: ator (conta ou sistema), ação, tipo e
  UUID do objeto, `changes` JSON com valores anterior/novo de campos não sensíveis, motivo,
  correlação, instante. Só inserção pela aplicação, com teste que varre o código por `UPDATE`/
  `DELETE` nessa tabela (como `security_event` em F01). Consulta e exportação em F08-Core.
- **Rationale**: FR-039, `SC-034`; eventos de segurança (`spark_identity`) continuam para
  autenticação e acesso.
- **Alternatives considered**: reaproveitar `security_event` (mistura domínios e bancos).

## R-17 — Progresso na interface

- **Decision**: a tela de provisionamento consulta `GET /api/v1/instances/{id}/provisioning` a cada
  2 s com TanStack Query (`refetchInterval`) enquanto a tarefa está ativa, parando em estado final
  ou com a aba oculta; o `Stepper`/`StepsBlock` do design system mostra as etapas.
- **Rationale**: FR-043 sem servidor de eventos; carga desprezível no volume do MVP.
- **Alternatives considered**: SSE ou WebSocket (infraestrutura e testes extras sem ganho real).

## R-18 — Instâncias de F01 e sementes

- **Decision**: a migração 0004, só quando houver linhas sintéticas em `instance_ref`, cria o
  contratante sintético `[SINTÉTICO] Contratante de referência` e o produto `sparkref`, associa as
  instâncias que já operavam em F01 e grava estado `ATIVA` com transição `NULL → ATIVA` de ator
  `sistema` e motivo `migracao_f01`. As sementes (`seedF02`) criam as instâncias pelo
  provisionador em modo síncrono, com UUID fixo, criam os vínculos de administrador (ana em A,
  bruno em B) e só então chamam `activateSyntheticInstance`. Essa função executa
  `PRONTA → ATIVA` pelo serviço de transição, exige o mesmo caminho de acesso que F03 exigirá
  (administrador ativo, `SC-024`) e recusa se o marcador de ambiente for `production` ou se a
  instância não for sintética.
- **Rationale**: FR-044 e CS-009 — sessões e validações de F01 seguem funcionando, sem tela de
  ativação (F03).
- **Alternatives considered**: deixar as instâncias de F01 como `PRONTA` (quebraria login e todos
  os testes de F01).

## R-19 — Prova de queda e retomada

- **Decision**: duas camadas de teste. (1) Integração com o executor de etapas recebendo, só em
  teste, um gancho `afterEffect(step)` que lança uma interrupção depois do efeito no MySQL e antes
  do registro; outra instância do executor retoma após o lease (relógio de teste). Executado para
  cada etapa de 3 a 8 (CS-004). (2) Um teste de processo: o trabalhador real como processo filho,
  encerrado com `SIGKILL` durante a etapa 5 e reiniciado, conferindo `PRONTA` sem duplicidade
  (`NFR-014`). O gancho não existe no caminho de produção (injeção por parâmetro, não por
  variável de ambiente).
- **Rationale**: constituição V (falha observada com MySQL real); `T-02`.
- **Alternatives considered**: só o teste de processo (não cobre todas as etapas de forma
  determinística).

## R-20 — Observabilidade

- **Decision**: log estruturado por etapa (`event: "provisioning_step"`, tarefa, instância,
  etapa, tentativa, resultado, duração em ms, código de erro) e por tarefa concluída
  (`provisioning_finished`, duração total). A situação do sistema (F00) passa a contar tarefas
  pendentes e falhas de provisionamento. Sem backend de métricas no MVP.
- **Rationale**: FR-041, `NFR-010`; os dados também ficam nas tabelas para consultas de F08-Core.
- **Alternatives considered**: Prometheus/OpenTelemetry (infraestrutura fora do recorte).
