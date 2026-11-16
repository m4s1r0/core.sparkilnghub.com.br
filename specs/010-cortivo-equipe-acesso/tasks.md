# Tarefas: Equipe do Cortivo no artefato (versão 2) e ambiente de ensaio do C01

**Entrada**: Documentos de design em `/specs/010-cortivo-equipe-acesso/`

**Pré-requisitos**: `plan.md`, `spec.md`, `research.md`, `data-model.md` e `contracts/cortivo-artifact-v2.md`

**Testes**: Incluídos porque FR-007, FR-010, FR-017 e FR-018 e a constituição (princípio V)
exigem validação estática, testes em MySQL real, migração, isolamento e regressão. Escrever os
testes de alto risco primeiro e observar a falha antes da implementação.

**Organização**: Tarefas agrupadas por história de usuário; IDs são sequenciais na ordem sugerida.

## Fase 1: Setup

**Propósito**: preparar a mudança sem alterar dependências ou infraestrutura já existente.

Não há inicialização de projeto nem dependências novas necessárias: Node.js 24, TypeScript,
Vitest, MySQL 8.4 e o aplicador de artefatos estão configurados no workspace.

## Fase 2: Fundacional

**Propósito**: pré-requisitos comuns que bloqueiam as histórias.

Não há novas tabelas ou mecanismos compartilhados no Core. A v2 do artefato na US1 é o pré-requisito
para a migração de instâncias existentes (US2) e para a preparação C01 (US3).

## Fase 3: História 1 — Instância Cortivo nova nasce pronta para o C01 (Prioridade: P1) 🎯 MVP

**Objetivo**: publicar o artefato v2 imutável e provar que instâncias novas chegam à versão 2 com
cadastro mínimo de profissionais e integridade referencial e condicional no banco.

**Teste independente**: provisionar duas instâncias Cortivo sintéticas em MySQL real; ambas ficam
`PRONTA` com histórico v2 sem falhas, e as restrições de perfil/profissional rejeitam todas as
combinações inválidas.

### Testes da História 1

- [X] T001 [US1] Adicionar casos de integração MySQL para os campos e restrições da v2 em `server/tests/integration/migrations/cortivo-artifact.test.ts`; cobrir nome obrigatório até 120 caracteres, apelido opcional até 40, telefone internacional opcional até 16, situação `ativo`/`inativo` com padrão `ativo`, versão otimista inicial 1, e timestamps UTC; observar os casos falharem antes da migração v2.
- [X] T002 [US1] Adicionar casos em `server/tests/integration/migrations/cortivo-artifact.test.ts` que provem que barbeiro sem profissional, perfil sem barbeiro com profissional, profissional repetido entre dois perfis barbeiro e profissional inexistente são recusados pelo MySQL, e que profissional sem situação nasce `ativo`; observar falhas antes da implementação.
- [X] T003 [P] [US1] Atualizar `server/tests/integration/provisioning/cortivo.test.ts` para verificar duas instâncias Cortivo sintéticas em `PRONTA`, histórico v1+v2 sem pendência/falha e presença da tabela profissional.

### Implementação da História 1

- [X] T004 [US1] Criar `produtos/cortivo/artifact/migrations/0002_profissional.sql` com a tabela e os limites literais do modelo: `nome VARCHAR(120) NOT NULL`, `apelido VARCHAR(40) NULL`, `telefone VARCHAR(16) NULL` em formato internacional, `situacao ENUM('ativo','inativo') NOT NULL DEFAULT 'ativo'`, `version INT UNSIGNED NOT NULL DEFAULT 1`, `criado_em` e `atualizado_em DATETIME(6)` UTC; adicionar FK de `perfil_colaborador.profissional_id`, `CHECK` que exige profissional se e somente se `perfis` contém `barbeiro`, e índice único que permite no máximo um perfil barbeiro por profissional.
- [X] T005 [US1] Atualizar `produtos/cortivo/artifact/manifest.json` para publicar migrações sequenciais v1 e v2, calcular o checksum v2 e manter `formatVersion: 1`, `productCode: cortivo`, prefixo `cortivo_` e `appendOnlyTables: ["auditoria"]`; não alterar `produtos/cortivo/artifact/migrations/0001_base.sql` nem seu checksum publicado.
- [X] T006 [US1] Atualizar `server/src/modules/catalog/provisioners.ts` para registrar a versão atual do provisionador Cortivo sem alterar o código imutável `cortivo`, o prefixo de banco ou o caminho existente do artefato; garantir que o provisionamento aplique todas as versões do manifesto.
- [X] T007 [US1] Atualizar as verificações de versão do schema Cortivo herdadas da spec 009 em `server/tests/integration/migrations/cortivo-artifact.test.ts` para esperar v2 em provisionamentos novos, mantendo intactos os testes de imutabilidade do SQL/checksum da v1 e os comportamentos Tuteli/referência.
- [X] T008 [US1] Executar a validação estática de `produtos/cortivo/artifact/` e os testes de `server/tests/integration/migrations/cortivo-artifact.test.ts` e `server/tests/integration/provisioning/cortivo.test.ts`; corrigir falhas da história antes de iniciar a US2.

**Checkpoint**: artefato válido e imutável, instância nova na v2, valores inválidos recusados pelo banco; MVP da feature demonstrável.

## Fase 4: História 2 — Instância existente sobe para a versão 2 sem recriar nada (Prioridade: P1)

**Objetivo**: migrar instância Cortivo v1 existente por meio da tarefa de migração já disponível,
sem recriação, perda de dados nem divergência estrutural.

**Teste independente**: em MySQL real, migrar uma instância com dados v1 válidos para v2 e comparar
tabelas, colunas, índices e restrições com banco criado do zero em v1+v2; em dados legados
inválidos, confirmar falha segura, pendência visível e ausência de remoção.

### Testes da História 2

- [X] T009 [US2] Adicionar a `server/tests/integration/migrations/cortivo-artifact.test.ts` um cenário que aplique v1, grave perfil de recepção e unidade, depois aplique v2 e verifique que os dados seguem íntegros, legíveis e que somente a versão pendente 2 foi aplicada.
- [X] T010 [US2] Adicionar comparação em MySQL real em `server/tests/integration/migrations/cortivo-artifact.test.ts` entre schema v1→v2 e schema v1+v2 em banco vazio, comparando tabelas, colunas, índices e restrições; exigir zero diferenças.
- [X] T011 [P] [US2] Adicionar em `server/tests/integration/provisioning/cortivo.test.ts` cenário da tarefa real de migração v1→v2 com perfil barbeiro legado sem profissional; verificar falha segura, tarefa/histórico bloqueados, banco preservado e ausência de retry.

### Implementação da História 2

- [X] T012 [US2] Ajustar `produtos/cortivo/artifact/migrations/0002_profissional.sql` para que dados v1 válidos sejam preservados e dados legados que violem as novas restrições façam a migração falhar sem apagar ou corrigir linhas automaticamente; não introduzir DDL destrutivo.
- [X] T013 [US2] Se os testes T009–T011 demonstrarem divergência no caminho existente, ajustar `server/src/modules/provisioning/migration-steps.ts` e `server/src/platform/migrations/apply-artifact.ts` para aplicar apenas versões pendentes e preservar o estado de falha/pendência sem retry automático nem remoção; manter a rotina comum compartilhada pelo provisionamento.
- [X] T014 [US2] Executar os testes de migração em MySQL real em `server/tests/integration/migrations/cortivo-artifact.test.ts` e `server/tests/integration/provisioning/cortivo.test.ts`; comprovar equivalência estrutural, dados preservados e falha segura.

**Checkpoint**: instância v1 válida termina na v2 sem recriação; falha de dados legados inválidos não remove recursos e permanece visível.

## Fase 5: História 3 — Ambiente de ensaio do C01 no desenvolvimento (Prioridade: P2)

**Objetivo**: disponibilizar roteiro reexecutável para duas instâncias Cortivo, uma instância
Tuteli, duas contas sintéticas e duas credenciais de aplicação vinculadas às respectivas instâncias
Cortivo, estritamente em desenvolvimento.

**Teste independente**: executar o roteiro duas vezes em ambiente de desenvolvimento limpo e
confirmar instâncias, estados, vínculos e credenciais esperados; confirmar rejeição fora de
development, isolamento cruzado e ausência de segredos no repositório/log.

### Testes da História 3

- [X] T015 [US3] Criar testes de integração em `server/tests/integration/seeds/cortivo-c01.test.ts` que provem que a rotina recusa `homologation` e `production` antes de criar recursos e aceita somente `development`.
- [X] T016 [US3] Criar testes de integração em `server/tests/integration/seeds/cortivo-c01.test.ts` que executem duas vezes a preparação e verifiquem exatamente duas instâncias Cortivo (`cortivo-a`, `cortivo-b`) e uma Tuteli, duas contas, vínculos corretos e duas credenciais Cortivo, sem duplicação.
- [X] T017 [P] [US3] Em `server/tests/integration/seeds/cortivo-c01.test.ts`, usar a credencial de `cortivo-a` contra conexão, sessão, atividade e membros de `cortivo-b`, verificando resposta pública equivalente à de instância inexistente e ausência de segredos nos logs. Manter no mesmo arquivo os cenários de seed porque usam IDs de instância globais no MySQL de teste.

### Implementação da História 3

- [X] T018 [US3] Implementar a preparação idempotente em `server/seeds/cortivo-c01.ts`, usando o contratante sintético existente (ou criando-o pelo fluxo suportado), `requestInstance`, o trabalhador/aplicador existente e transições de instância sintética; criar `cortivo-a` e `cortivo-b` com produto `cortivo` e a instância Tuteli com o código imutável `sparkpet`, todas sintéticas e ativadas, sem alterar fixtures de `sparkref`.
- [X] T019 [US3] Completar `server/seeds/cortivo-c01.ts` com uma conta administradora vinculada a `cortivo-a`, `cortivo-b` e Tuteli e uma conta colaboradora vinculada a `cortivo-a`; usar identificadores fixos e padrões existentes, evitar duplicatas em reexecução, e nunca gravar ou registrar senha em texto claro.
- [X] T020 [US3] Completar `server/seeds/cortivo-c01.ts` com uma credencial por instância Cortivo, escopos de conexão, sessão e membros, sempre vinculada à instância correspondente; reutilizar ou informar credenciais existentes sem reemissão silenciosa, e exibir cada segredo somente uma vez na criação.
- [X] T021 [US3] Criar `server/src/cli/dev-prepare-cortivo-c01.ts` com guarda estrita de `SPARK_ENV=development` e do marcador de ambiente do banco antes de qualquer efeito; chamar a preparação idempotente e nunca emitir segredos em logs.
- [X] T022 [US3] Registrar `dev:prepare-cortivo-c01` em `package.json` e documentar em `docs/operacao/ensaio-cortivo-c01.md` os pré-requisitos, confirmação do ambiente, comando, slugs, nomes das contas, vínculos, locais de obtenção de credenciais, reexecução segura e recusa fora de desenvolvimento, sem incluir segredos.
- [X] T023 [US3] Executar `server/tests/integration/seeds/cortivo-c01.test.ts` contra MySQL real; validar duas execuções, guarda de ambiente, escopos por instância, respostas cruzadas indistinguíveis e ausência de segredos em arquivos/logs.

**Checkpoint**: o roteiro pode ser repetido com dados sintéticos e prepara as três instâncias e credenciais esperadas sem afetar outros produtos.

## Fase 6: Polimento e validação transversal

**Propósito**: confirmar compatibilidade e atualizar a documentação de execução.

- [X] T024 [P] Atualizar `specs/010-cortivo-equipe-acesso/quickstart.md` com os nomes finais dos testes e comandos de preparação documentados em `docs/operacao/ensaio-cortivo-c01.md`.
- [ ] T025 Executar `npm run artifact:validate -- produtos/cortivo/artifact`, `npm run test:integration` e `npm run verify` definidos em `package.json`; confirmar que Tuteli, produto de referência e regressões da spec 009 permanecem verdes, exceto verificações v1 atualizadas para v2. **Bloqueio**: validação do artefato e integração passaram; `npm run verify` para em `format:check` por seis documentos do ecossistema fora do formato no baseline (inclui `docs/ecossistema/01-registro-de-produtos.md` antes desta alteração), sem falhas de tipo/lint/teste atribuíveis à feature.

## Dependências e ordem de execução

### Dependências entre fases

- Setup e Fundacional: sem alterações necessárias; ferramentas e mecanismos já existem.
- US1: primeira fase implementável; publica o schema v2 e é o pré-requisito do restante.
- US2: depende da publicação da v2 pela US1; não cria mecanismo de migração paralelo.
- US3: depende da US1 para provisionar Cortivo v2; usa serviços existentes e pode ser executada em paralelo com US2 após a conclusão da US1, desde que os testes/arquivos não sejam alterados simultaneamente.
- Polimento: depende das histórias selecionadas para entrega.

### Dependências das histórias

- **US1 (P1)**: independente de outras histórias; MVP e primeiro checkpoint.
- **US2 (P1)**: depende de US1 para a versão 2 do artefato; pode ser validada sem o roteiro C01.
- **US3 (P2)**: depende de US1 para instâncias Cortivo v2; não depende da migração de uma instância v1 da US2.

### Dependências internas das tarefas

- T001–T003 antecedem a implementação da US1; T004 antecede T005; T005 antecede T006–T008.
- T009–T011 são escritos após a US1 e antes de mudanças específicas de migração; T012–T014 concluem a US2.
- T015–T017 são escritos antes da implementação da rotina; T018 antecede T019–T020; T021 integra a rotina e T022 publica o comando e roteiro; T023 valida a história.
- T024–T025 fecham a regressão e documentação.

## Oportunidades de paralelismo

- Na US1, T001, T002 e T003 podem ser trabalhadas em paralelo inicialmente; T001 e T002 tocam o mesmo arquivo de teste, então um único executor deve consolidá-las se não houver coordenação por hunk.
- Na US2, T009 e T010 compartilham arquivo e devem ser consolidadas; T011 pode ser feito em paralelo em arquivo distinto.
- Na US3, T015 e T016 compartilham arquivo e devem ser consolidadas; T017 pode ser paralelo. A implementação da rotina, testes, CLI e documentação têm caminhos distintos, mas devem respeitar a sequência de integração.
- US2 e US3 podem começar em paralelo após US1; ambas executam testes contra a mesma infraestrutura MySQL e devem usar nomes de bancos/fixtures isolados.

## Exemplos de execução paralela

```text
# Após iniciar US1, escrever testes independentes em arquivos distintos:
T001: testes de constraints do schema em server/tests/integration/migrations/cortivo-artifact.test.ts
T003: teste de provisionamento em server/tests/integration/provisioning/cortivo.test.ts

# Após US1, trabalhos independentes de migração e ambiente C01:
US2: cenários de migração em server/tests/integration/migrations/cortivo-artifact.test.ts e server/tests/integration/provisioning/cortivo.test.ts
US3: testes de guarda e idempotência em server/tests/integration/seeds/cortivo-c01.test.ts
```

## Estratégia de implementação

### MVP primeiro (somente História 1)

1. Preservar a v1 e escrever primeiro os testes MySQL para o schema e o provisionamento.
2. Implementar migração v2, manifesto e registro do provisionador, mantendo código e prefixo do produto.
3. Executar validação estática e testar duas instâncias sintéticas, defaults e restrições.
4. **Parar e validar**: US1 é o incremento mínimo que libera o C01 para integração.

### Entrega incremental

1. Concluir US1 e validar o provisionamento novo.
2. Concluir US2 e provar migração existente, dados preservados e falha segura.
3. Concluir US3 e validar setup, isolamento e reexecução.
4. Executar regressão transversal por `npm run verify`.
