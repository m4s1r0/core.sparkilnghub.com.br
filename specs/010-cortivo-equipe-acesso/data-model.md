# Modelo de dados — Cortivo v2 e ambiente de ensaio C01

**Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md)

## Banco operacional de cada instância Cortivo

### `profissional` (nova na v2)

| Campo | Tipo/semântica | Regras |
|---|---|---|
| `profissional_id` | `BINARY(16)` | Chave primária; identificador UUID compatível com o ponteiro já existente em `perfil_colaborador`. |
| `nome` | `VARCHAR(120)` | Obrigatório; máximo de 120 caracteres. |
| `apelido` | `VARCHAR(40)` | Opcional; máximo de 40 caracteres. |
| `telefone` | `VARCHAR(16)` | Opcional; armazenado em formato internacional. |
| `situacao` | `ENUM('ativo','inativo')` | Obrigatório; padrão `ativo`. A situação pode mudar após associação. |
| `version` | `INT UNSIGNED` | Obrigatório; versão para edição otimista, inicializada como 1. |
| `criado_em` | `DATETIME(6)` UTC | Instante de criação. |
| `atualizado_em` | `DATETIME(6)` UTC | Instante da última atualização. |

Não há conta obrigatória nem exclusão física de profissionais no escopo desta feature.

### `perfil_colaborador` (tabela existente, restrições adicionadas na v2)

| Campo | Tipo/semântica | Regras da v2 |
|---|---|---|
| `membership_id` | `BINARY(16)` | Chave primária existente; identifica o vínculo local. |
| `perfis` | `SET('recepcao','barbeiro')` | Continua exigindo perfil não vazio. |
| `profissional_id` | `BINARY(16) NULL` | FK para `profissional.profissional_id`; `NOT NULL` quando `perfis` contém `barbeiro`, `NULL` caso contrário; índice único permite no máximo um perfil barbeiro por profissional. |
| `version` | `INT UNSIGNED` | Edição otimista existente. |
| `definido_por`, `criado_em`, `atualizado_em` | Campos existentes | Mantidos sem mudança semântica. |

**Validações relacionais**:

1. `perfis` contém `barbeiro` se, e somente se, `profissional_id` não é nulo.
2. Todo `profissional_id` referencia um profissional existente.
3. Um `profissional_id` aparece em no máximo um perfil.
4. Profissional inativo pode permanecer associado; a regra de exigir profissional ativo ao operar
   é responsabilidade do serviço Cortivo, não desta restrição do banco.

**Transição de schema**: migração sequencial v1→v2. Instâncias existentes preservam todos os
registros válidos da v1. Se dados legados violarem as novas restrições, a migração falha e deixa a
pendência visível; não apaga nem corrige registros automaticamente. A comparação estrutural de
v1→v2 com v1+v2 em banco vazio deve resultar em zero diferenças.

## Dados sintéticos do ensaio C01

| Entidade | Quantidade / relação |
|---|---|
| Instância Cortivo | `cortivo-a` e `cortivo-b`; ambas ativas e com schema v2. |
| Instância Tuteli | Uma instância ativa; código de produto imutável `sparkpet`. |
| Conta administradora de teste | Uma conta sintética vinculada às duas instâncias Cortivo e à instância Tuteli. |
| Conta colaboradora de teste | Uma conta sintética vinculada a `cortivo-a`. |
| Credencial de aplicação | Uma por instância Cortivo, com escopos de conexão, sessão e membros e vínculo à instância correspondente. |

Os registros do ensaio são independentes das entidades de negócio do produto. O Core não guarda
senha ou segredo da credencial em texto claro; o operador recebe segredo somente quando a
credencial é criada.
