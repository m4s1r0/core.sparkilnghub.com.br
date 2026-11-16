# Pesquisa — Equipe do Cortivo no artefato v2 e ensaio do C01

**Data**: 2026-11-16 · **Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

As escolhas herdam D-05 e os mecanismos de F00–F03. Não restam pontos `NEEDS CLARIFICATION`
para o desenho desta feature.

## R-01 — Stack, persistência e testes

- **Decisão**: usar Node.js 24, TypeScript 5.9, MySQL 8.4, `mysql2`/Kysely e o migrador/aplicador
  existentes; testar as garantias relacionais e de migração com MySQL real, usando Vitest.
- **Justificativa**: são as escolhas confirmadas por D-05 e já utilizadas pelo catálogo, provisionador
  e aplicador de artefatos.
- **Alternativas consideradas**: adicionar um ORM/migrador ou uma dependência de teste; rejeitadas
  porque não agregam capacidade necessária e aumentariam a complexidade vedada pelo princípio VII.

## R-02 — Evolução do artefato Cortivo

- **Decisão**: manter o manifesto no formato atual, acrescentar a migração sequencial v2 ao
  diretório `produtos/cortivo/artifact/` e preservar literalmente o SQL e checksum publicados da
  v1. A v2 cria somente `profissional` e impõe as restrições de perfil; `appendOnlyTables` continua
  exatamente `["auditoria"]`.
- **Justificativa**: o contrato `migration-artifact.md` exige sequência, checksum e imutabilidade
  de versões publicadas; a tabela `perfil_colaborador` da v1 já reserva `profissional_id
  BINARY(16) NULL`, explicitamente sem FK até uma migração posterior
  (`produtos/cortivo/artifact/migrations/0001_base.sql:77-89`).
- **Alternativas consideradas**: editar a v1, alterar a projeção de acesso ou criar outra tabela de
  perfil; todas quebrariam compatibilidade, imutabilidade ou o escopo mínimo.

## R-03 — Integridade de profissional e perfil

- **Decisão**: usar o formato UUID `BINARY(16)` compatível com `perfil_colaborador.profissional_id`.
  A tabela nova inclui nome obrigatório, apelido/telefone opcionais, situação com padrão `ativo`,
  versão otimista e timestamps UTC. A v2 adiciona a FK do perfil, unicidade de
  `profissional_id` (permitindo vários `NULL`) e uma restrição de verificação que exige
  `profissional_id` se, e somente se, `perfis` contém `barbeiro`.
- **Justificativa**: as restrições ficam no banco, como exige FR-003 a FR-005, enquanto a unicidade
  do ponteiro impede associação a mais de um barbeiro. A situação `ativo`/`inativo` não participa
  da restrição porque a regra de profissional ativo depende da lógica do produto Cortivo, fora do
  Core.
- **Alternativas consideradas**: validar somente no serviço ou criar gatilhos; rejeitados porque
  permitem gravação inválida por outros caminhos e acrescentam lógica operacional desnecessária.

## R-04 — Migração de instâncias

- **Decisão**: não criar caminho de migração paralelo. Instâncias novas aplicam as versões do
  manifesto em ordem pelo provisionador; instâncias v1 recebem somente a v2 pela tarefa e pelo
  aplicador já existentes. A migration v2 é aditiva e não corrige nem remove dados legados
  silenciosamente.
- **Justificativa**: `apply-artifact.ts` aplica o manifesto sequencialmente; as etapas de migração
  reaproveitam o mesmo aplicador e verificam o histórico contra o manifesto. Se um registro legado
  de barbeiro sem profissional impedir a criação da restrição, a tarefa deve falhar de forma
  segura, deixando pendência visível e sem remoção de recursos.
- **Alternativas consideradas**: recadastrar a instância ou introduzir um migrador específico do
  Cortivo; rejeitados por risco de perda de dados e duplicação do mecanismo padrão.

## R-05 — Ambiente de ensaio C01

- **Decisão**: documentar um comando dedicado, estritamente guardado para `development`, que
  reaproveita o padrão de sementes sintéticas idempotentes e os serviços normais do Core. Usar o
  código imutável `cortivo` para Cortivo e `sparkpet` para Tuteli; criar instâncias por
  `requestInstance`, executar a tarefa pelo trabalhador e ativar pelo serviço de instância
  sintética. Usar IDs/emails de teste fixos, evitar duplicar contas/vínculos/credenciais e criar
  credenciais `connection`, `sessions` e `members` sempre vinculadas à instância Cortivo.
- **Justificativa**: as sementes existentes já usam IDs fixos, requisições e execução do fluxo
  normal, verificação de contas/vínculos e ativação sintética. O `db:seed` geral permite tanto
  `development` quanto `homologation`; por isso não é suficiente como fronteira de segurança para
  este roteiro. O CLI de credenciais exibe o segredo apenas na criação e persiste apenas seu hash.
- **Alternativas consideradas**: inserir linhas diretamente no banco, executar o fluxo via
  `db:seed` sem guarda adicional ou armazenar credenciais em arquivo; rejeitados por contornar
  regras de domínio, permitir execução fora do ambiente permitido ou persistir segredos.

## R-06 — Superfícies de contrato e regressão

- **Decisão**: documentar o delta relacional em `contracts/cortivo-artifact-v2.md`. Não alterar
  `/internal/v1`, a projeção `access-projection.md` nem os contratos do Tuteli e do produto de
  referência.
- **Justificativa**: o único contrato ampliado é o artefato de banco do Cortivo; os vínculos,
  credenciais e chamadas de aplicação já usam contratos existentes. A spec exige testes de
  regressão das suítes existentes.
- **Alternativas consideradas**: criar uma nova API/versão de projeção; rejeitada por estar fora do
  escopo e não ser necessária para o cadastro de profissional.
