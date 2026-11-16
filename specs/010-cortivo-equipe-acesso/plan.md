# Plano de Implementação: Equipe do Cortivo no artefato (versão 2) e ambiente de ensaio do C01

**Branch**: `010-cortivo-equipe-acesso` | **Data**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Entrada**: Especificação de funcionalidade em `specs/010-cortivo-equipe-acesso/spec.md`

## Resumo

Publicar a migração v2 do artefato existente `cortivo`, preservando sem alterações a v1, com o
cadastro mínimo de profissionais e restrições relacionais no banco entre profissional e perfil de
colaborador. O provisionamento existente aplicará v1 e v2 em instâncias novas; a tarefa de migração
existente aplicará somente a v2 nas instâncias Cortivo na v1. Para o C01, acrescentar um roteiro
dedicado e estritamente limitado ao ambiente de desenvolvimento, que use os fluxos existentes do
Core para preparar `cortivo-a`, `cortivo-b` e uma instância Tuteli (`sparkpet`), vínculos sintéticos
e uma credencial vinculada a cada instância Cortivo. Nenhuma rota `/internal/v1` nem a projeção de
acesso será alterada.

## Contexto técnico

**Linguagem/Versão**: TypeScript 5.9 strict, Node.js 24 LTS (ESM), conforme D-05.

**Dependências principais**: Fastify 5, TypeBox, `mysql2`, Kysely e migrador próprio; sem
dependências novas. Vitest para testes e as ferramentas de validação do artefato já existentes.

**Armazenamento**: MySQL 8.4. O artefato Cortivo opera no banco exclusivo da instância com prefixo
`cortivo_`; credenciais, vínculos e metadados das instâncias permanecem nos bancos existentes
`spark_identity` e `spark_core`. Nenhuma migração de banco do Core é prevista.

**Testes**: Validação estática do manifesto/SQL, testes de unidade dos guardas e do roteiro, e
testes de integração em MySQL real para provisionamento, migração v1→v2, restrições, falha segura,
equivalência estrutural e isolamento entre duas instâncias. Executar também as suítes existentes
de regressão referenciadas pela spec.

**Plataforma alvo**: Desenvolvimento local em Windows/Linux; CI Ubuntu; MySQL 8.4 em contêiner,
conforme o toolchain existente.

**Tipo de projeto**: Monólito modular (API, trabalhador, artefatos dos produtos e CLI/rotinas de
desenvolvimento).

**Metas de desempenho**: N/A para novos caminhos de requisição; provisionamento e migração
mantêm os limites e a execução persistente do trabalhador existentes.

**Restrições**: Imutabilidade da v1; apenas uma tabela de negócio nova no artefato; sem
`DROP DATABASE`, SQL livre, nova dependência ou serviço; sem mudanças em `/internal/v1` e na
projeção de acesso; roteiro recusado fora de `development`; dados sintéticos e segredos nunca
gravados em arquivos ou logs.

**Escala/escopo**: Uma migração nova do Cortivo (v2), uma tabela `profissional`, integridade
condicional em `perfil_colaborador`, testes de provisionamento/migração e um roteiro para três
instâncias-alvo do C01 (preservando fixtures existentes do produto de referência), duas contas de
teste e duas credenciais Cortivo.

## Verificação da constituição

*Portão: aprovado antes da pesquisa; reavaliado após o desenho.*

| Princípio / regra | Aplicação nesta fatia | Resultado |
|---|---|---|
| I. Isolamento por instância | Profissionais ficam somente no banco operacional da instância. Testar `cortivo-a` e `cortivo-b`, inclusive credencial cruzada e resposta indistinguível de instância inexistente. | ✅ |
| II. Identidade e autorização no servidor | Criar contas, vínculos, ativação e credenciais pelos serviços existentes; credenciais de conexão/sessão/membros sempre vinculadas à instância e com segredo exibido somente na emissão. | ✅ |
| III. Contratos versionados e mínimos | Acrescentar uma migração sequencial ao artefato imutável; manter `/internal/v1` e `access-projection.md` inalterados. Registrar o delta de schema em contrato próprio. | ✅ |
| IV. Operações idempotentes e retomáveis | Reaproveitar o aplicador e a tarefa de migração existentes. O roteiro usa IDs/chaves fixos e verificações antes de criar; falha de DDL permanece visível e não remove recursos. | ✅ |
| V. MySQL real e cenários de falha | Cobrir as restrições e a equivalência v1→v2 em MySQL 8.4; incluir nova instância, instância existente, dados legados inválidos e falha da migração. | ✅ |
| VI. Auditoria e privacidade | Ambiente de ensaio usa dados sintéticos; nomes/emails de teste não identificam pessoas; nenhum segredo vai ao repositório, log ou histórico. | ✅ |
| VII. Monólito e escopo disciplinado | Reusar provisionador, trabalhador, serviços e CLI existentes; não adicionar serviço, broker, dependência nem regra de negócio além do cadastro mínimo. | ✅ |
| VIII. Design system | Nenhuma tela nova ou alteração visual nesta feature; controles existentes permanecem sob o design system. | N/A |
| Portão de prontidão | A spec 009 já fornece v1, artefato e provisionador Cortivo; a spec 010 não altera essa versão publicada. | ✅ |

**Pós-design**: o modelo e o contrato preservam a estrutura v1 e não introduzem interface HTTP
nova. O roteiro usa o código de catálogo imutável `sparkpet` para o produto comercial Tuteli e
exige um guarda estrito de `development`, pois o comando geral `db:seed` também aceita homologação.
O número de instâncias do critério C01 é contado apenas para as duas instâncias Cortivo e a
instância Tuteli; fixtures sintéticas existentes do produto de referência são preservadas.
Nenhuma violação constitucional ou exceção de complexidade foi identificada. O nome da branch
definido pela spec/setup é `010-cortivo-equipe-acesso`; o checkout atual observado durante o plano
é `010-setup-cortivo`, sem troca de branch.

## Estrutura do projeto

### Documentação desta feature

```text
specs/010-cortivo-equipe-acesso/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── cortivo-artifact-v2.md
└── tasks.md                         # Fase 2; não é gerado por este plano
```

### Código e testes existentes afetados

```text
produtos/cortivo/artifact/
├── manifest.json                    # registrar versão 2; manter v1/checksum intactos
└── migrations/
    ├── 0001_base.sql                # publicado; imutável
    └── 0002_<slug>.sql              # nova migração aditiva

server/src/modules/catalog/provisioners.ts
server/src/modules/provisioning/       # reaproveitar aplicador e tarefa de migração
server/src/cli/                        # comando dedicado de preparação C01
server/seeds/                          # padrões de IDs fixos e criação idempotente
server/tests/integration/migrations/
package.json                           # expor o comando de preparação C01
scripts/
docs/operacao/                         # roteiro reproduzível do ensaio
```

**Decisão de estrutura**: manter o artefato e o código de domínio nos locais atuais. A preparação
do C01 será um comando dedicado, com guarda de desenvolvimento, que reutiliza as rotinas sintéticas
existentes e será exposta como `npm run dev:prepare-cortivo-c01`; não será acrescentada sem guarda
ao `db:seed`, que também é permitido em homologação. Não haverá rota ou tela nova.

## Acompanhamento de complexidade

Sem violações ou novas dependências/camadas que exijam justificativa.
