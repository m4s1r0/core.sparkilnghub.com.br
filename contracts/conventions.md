# Convenções de contrato do SparkCore — v1

Aplica-se a toda API HTTP do SparkCore, interna (consumida pelo Tuteli) ou administrativa
(consumida pela interface do Core). Fonte: diretrizes §4.3, §6.1; constituição, princípio III.
Publicada no repositório em `contracts/conventions.md`; mudanças seguem versionamento abaixo.

## 1. Versionamento

- Prefixo de caminho por versão maior: `/api/v1/...` (administrativa) e `/internal/v1/...`
  (consumida pelo Tuteli, a partir de F01).
- Mudança compatível (campo opcional novo, novo endpoint, novo código de erro documentado como
  extensível) mantém a versão e é registrada no changelog de contratos.
- Mudança incompatível (remover/renomear campo, mudar tipo, tornar obrigatório, mudar semântica)
  exige `/v2`, convivência com `/v1` até migração do consumidor e registro de impacto.
- Cada capacidade tem versão própria no [catálogo](./capabilities.md).

## 2. Formato JSON

- `application/json; charset=utf-8`; campos em `camelCase`.
- Instantes em RFC 3339 UTC com sufixo `Z`; datas civis `YYYY-MM-DD` com fuso explícito no
  contexto.
- Dinheiro em centavos inteiros (`amountCents`), nunca decimal ou float (`COM-021`).
- UUIDs em texto canônico minúsculo.
- Campos desconhecidos na requisição são rejeitados (`422`), exceto onde o contrato declarar
  extensão.

## 3. Correlação

- Cabeçalho `X-Correlation-Id`. Se a requisição trouxer um UUID válido, ele é reutilizado; caso
  contrário, o servidor gera um UUID v7.
- Toda resposta, inclusive erro, devolve `X-Correlation-Id`; o corpo de erro repete o valor.
- Todo log da requisição contém `correlationId`, `product: "sparkcore"` e, quando verificado no
  servidor, `instanceId`. Instância informada pelo cliente nunca vai ao log como verificada.

## 4. Envelope de erro

```json
{
  "error": {
    "code": "SYSTEM_DEPENDENCY_UNAVAILABLE",
    "message": "Um componente do sistema está indisponível. Tente novamente em instantes.",
    "field": null,
    "retryable": true,
    "correlationId": "0192f6b0-7c1e-7a3b-9d2e-5f8a1c3b4d6e"
  }
}
```

| Campo           | Regras                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `code`          | `UPPER_SNAKE_CASE`, estável, documentado; prefixo por área (`VALIDATION_`, `AUTH_`, `CONFLICT_`, `SYSTEM_`…) |
| `message`       | pt-BR, segura para exibir; sem SQL, segredo, caminho de arquivo ou stack trace                               |
| `field`         | caminho JSON Pointer do campo inválido, ou `null`                                                            |
| `retryable`     | `true` somente quando repetir a mesma requisição pode ter sucesso                                            |
| `correlationId` | igual ao cabeçalho                                                                                           |

Validação com vários campos usa `error.details: [{ field, code, message }]` além do primeiro
erro em `error.field`.

## 5. Códigos HTTP

| Status | Uso                                                                                                   | `retryable`                |
| ------ | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| `400`  | Corpo malformado (JSON inválido)                                                                      | `false`                    |
| `401`  | Sem sessão válida ou sessão expirada/revogada                                                         | `false`                    |
| `403`  | Sessão válida sem permissão **num recurso cuja existência o usuário já pode conhecer**                | `false`                    |
| `404`  | Recurso inexistente **ou** de outra instância/contexto não autorizado — mesma resposta nos dois casos | `false`                    |
| `409`  | Conflito de estado, versão otimista, chave de idempotência com payload diferente                      | `false`                    |
| `422`  | Validação de domínio ou de campos                                                                     | `false`                    |
| `429`  | Limite de tentativas                                                                                  | `true` (com `Retry-After`) |
| `503`  | Dependência indisponível (MySQL, identidade, trabalhador quando exigido)                              | `true` (com `Retry-After`) |
| `500`  | Falha inesperada; mensagem genérica, detalhe só no log com a correlação                               | `false`                    |

Regra de não revelação: recurso de outra instância nunca produz `403`; produz `404` idêntico ao
de inexistente (princípio I).

## 6. Idempotência

- Operações críticas declaradas no contrato exigem `Idempotency-Key` (UUID, gerado pelo cliente
  por intenção do usuário, não por clique).
- Escopo da chave: ator + instância/contexto + operação. Persistência ≥ 24 h com resumo sha256
  do corpo canônico e resposta (`COM-026`).
- Mesma chave + mesmo resumo → repete a resposta original (inclusive status). Mesma chave +
  resumo diferente → `409 CONFLICT_IDEMPOTENCY_KEY_REUSED`. Requisição concorrente com chave
  em processamento → `409 CONFLICT_REQUEST_IN_PROGRESS`, `retryable: true`.
- Implementação a partir de F01/F02; F00 publica apenas a regra.

## 7. Segurança de transporte e cabeçalhos

- TLS obrigatório fora de desenvolvimento. Respostas da API com `Cache-Control: no-store`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; CSP definida para a
  interface servida pelo mesmo servidor.
- Valores enviados pelo cliente (`instanceId`, `role`, `userId`, nome de banco) nunca são
  autoridade (diretrizes §4.3).
