# 07 — Checklist de novo SaaS

Sequência obrigatória para colocar um produto novo no ecossistema. Complementa
[`docs/operacao/novo-produto.md`](../operacao/novo-produto.md) (passos técnicos no Core) com os
padrões deste diretório.

## Antes do C00

- [ ] Nome comercial e marca aprovados em `UX/marcas-produtos.md`; pasta em
      `UX/assets/logomarcas-produtos/final-v1/<produto>/`.
- [ ] Escopo de produto em `<produto>/<produto>.sparklinghub.com.br/docs/escopo/` com IDs
      estáveis (`<P>-*`, `CORE-<P>-*`, `NFR-<P>-*`, `AC-<P>-*`) e fatias `Cnn`.
- [ ] Modelagem preliminar em `docs/modelagem/` (módulos, dados, API, telas, breadcrumbs, campos
      com máscara, permissões).
- [ ] Decisões `D-<P>-*` respondidas pelo responsável ou explicitamente adiadas com prazo.

## C00 — Base (lado do Core, um PR)

- [ ] Linha no [registro de produtos](./01-registro-de-produtos.md): código, prefixo, portas.
- [ ] Migração do catálogo `spark_core` (`INSERT INTO product …`).
- [ ] `produtos/<produto>/artifact/manifest.json` + `0001_<base>.sql` com `_spark_instance`,
      `idempotencia`, `auditoria` (declarada só-inserção), `outbox_evento`.
- [ ] Provisionador em `server/src/modules/catalog/provisioners.ts` e caminho em `paths.ts`.
- [ ] `GRANT` do provisionador no prefixo em `docker/mysql/init/01-databases-and-users.sh`.
- [ ] `npm run artifact:validate -- produtos/<produto>/artifact` verde.

## C00 — Base (lado do produto)

- [ ] Repositório com a estrutura de [02 · ECO-010](./02-arquitetura-padrao-saas.md#eco-010--estrutura-do-repositório).
- [ ] `.specify/` inicializado; constituição derivada com princípios I–IX (`ECO-015`).
- [ ] `vendor/design-system/sparkling-hub-design-system-0.5.0.tgz` + `docs/design-system-updates.md`.
- [ ] `web/public/brand/` com os sete arquivos da marca e teste de sha256 (`UI-050`).
- [ ] Shell (`layouts.tsx`, `MenuPrincipal.tsx`, `Brand.tsx`, `PageHeader.tsx`) conforme `UI-010`/`UI-020`.
- [ ] `.env.example` com as portas reservadas, `SPARKCORE_INTERNAL_URL=http://127.0.0.1:5273`,
      `TRUSTED_PROXIES`, `PUBLIC_ORIGIN`, `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS`.
- [ ] Kit de segurança de [05](./05-baseline-seguranca.md#kit-de-implementação-recomendado-por-produto) esqueletado com testes.
- [ ] CI: typecheck, lint, unit, integração com MySQL 8.4, contrato, E2E, `npm audit --omit=dev`.

## C01 — Instância e acesso

- [ ] Duas instâncias sintéticas provisionadas; credencial **por instância** para cada uma.
- [ ] Boot `INT-010`, conexão `INT-020`, login `INT-030`, cookie `INT-040`, projeção `INT-050`,
      touch `INT-051`, logout `INT-060`, equipe `INT-070`.
- [ ] Os sete testes de contrato de [03 · INT-110](./03-contrato-saas-core.md#int-110--testes-de-contrato-obrigatórios-por-produto).
- [ ] `SEC-BASE-02..08, 10, 11, 17..20` verdes.

## Modelo de prompt SDD de entrada (C00 + C01)

> Trocar `<Produto>`, `<code>`, portas e caminhos. O prompt efetivo do Cortivo está em
> `cortivo/cortivo.sparklinghub.com.br/docs/sdd/`.

```text
/speckit-specify Base e acesso do <Produto> (C00 + C01).

Entradas normativas, nesta precedência: constituição do SparkCore; contratos em
core/core.sparkilnghub.com.br/contracts (/internal/v1 v1.3.3 → v1.4); padrões canônicos em
core/core.sparkilnghub.com.br/docs/ecossistema (01–07); escopo em docs/escopo; modelagem em
docs/modelagem.

Entregar: repositório api/+web/ com stack ECO-011; constituição derivada (ECO-015); registro do
produto `<code>` no catálogo e artefato 0001 no Core; boot, conexão, login, validação pela
projeção D-04, touch, logout e equipe conforme INT-001..INT-070; shell com menu lateral,
breadcrumbs, marca do produto e DS 0.5.0 conforme UI-001..UI-050; linha de base SEC-BASE
aplicável; testes INT-110 com duas instâncias.

Fora: regras de negócio a partir de C02.
```
