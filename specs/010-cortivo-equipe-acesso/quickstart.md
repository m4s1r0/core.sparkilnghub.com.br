# Validação rápida — Cortivo v2 e ensaio do C01

**Spec**: [spec.md](./spec.md) · **Plano**: [plan.md](./plan.md) · **Modelo**: [data-model.md](./data-model.md)

Este roteiro descreve a evidência necessária para validar a feature. O comando de preparação C01
`npm run dev:prepare-cortivo-c01` deve recusar qualquer ambiente que não seja `development`.

## Pré-requisitos

- Node.js 24 e dependências do workspace instaladas.
- Docker disponível e MySQL 8.4 de desenvolvimento acessível.
- `.env` local configurado para `SPARK_ENV=development`; nunca usar homologação ou produção.
- Repositório na branch de trabalho da feature, com a v1 Cortivo publicada na árvore.

## 1. Validar o artefato e o schema novo

```powershell
npm run artifact:validate -- produtos/cortivo/artifact
```

**Esperado**: manifesto válido, versões sequenciais 1 e 2, checksums corretos e nenhuma construção
proibida. A v1 e `appendOnlyTables` permanecem inalteradas.

Executar os testes de integração do artefato em MySQL real:

```powershell
npm run dev:up
npm run test:integration -- server/tests/integration/migrations/cortivo-artifact.test.ts server/tests/integration/provisioning/cortivo.test.ts
```

**Esperado**: uma instância nova chega a `PRONTA` na v2; os casos inválidos de associação são
recusados pelo banco; status omitido de profissional resulta em `ativo`.

## 2. Provar migração e falha segura

Usar banco descartável MySQL: aplicar a v1, inserir dados válidos da v1, migrar para v2 e comparar
tabelas, colunas, índices e restrições contra outro banco que recebeu v1+v2 do zero.

Repetir com perfil barbeiro legado sem profissional. **Esperado**: a v2 falha sem excluir dados nem
recursos, com tarefa em falha e pendência visível; não há repetição automática.

## 3. Preparar e reexecutar o ensaio C01

Confirme que `SPARK_ENV=development` e o marcador em `spark_core.environment_marker` também indicam
`development`. Depois de executar `npm run db:migrate`, rode o comando dedicado descrito em
[`docs/operacao/ensaio-cortivo-c01.md`](../../docs/operacao/ensaio-cortivo-c01.md):

```powershell
npm run dev:prepare-cortivo-c01
```

Executar o roteiro duas vezes. **Esperado**: `cortivo-a` e `cortivo-b` (Cortivo v2) e uma instância
Tuteli (`sparkpet`) ativadas; duas contas sintéticas com os vínculos descritos em
[data-model.md](./data-model.md); duas credenciais Cortivo vinculadas à respectiva instância. A
segunda execução não duplica registros nem revela segredos anteriormente emitidos.

Usar a credencial de `cortivo-a` para consultar recursos de `cortivo-b`. **Esperado**: a mesma
resposta de uma instância inexistente. Confirmar também que nenhum segredo foi gravado no
repositório ou nos logs.

Validar o roteiro e o isolamento em MySQL real:

```powershell
npm run test:integration -- server/tests/integration/seeds/cortivo-c01.test.ts
```

## 4. Regressão

```powershell
npm run verify
```

**Esperado**: etapas de validação da CI verdes; testes existentes do Tuteli, produto de referência
e spec 009 continuam aprovados, exceto os testes de versão do schema Cortivo atualizados para v2.
