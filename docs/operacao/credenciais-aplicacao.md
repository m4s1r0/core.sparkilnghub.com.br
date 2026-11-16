# Credenciais de aplicação, TLS e proxies (endurecimento v1.4)

Procedimento de implantação do Core endurecido (`specs/008-endurecimento-seguranca-core`,
contrato `/internal/v1` v1.4). Linha de base: `docs/ecossistema/05-baseline-seguranca.md`.

## 1. Credencial por instância (SEC-01) — sem parada

A partir da v1.4 o Core **recusa** credenciais com escopo `connection`, `sessions` ou `members`
que não estejam vinculadas a uma instância. Cada implantação de produto usa a sua.

Antes de implantar o Core novo (o Core antigo ignora o vínculo, então a ordem é segura):

1. Liste as credenciais e veja quais estão marcadas `POR PRODUTO — recusada`:

   ```bash
   npm run app-credential -- list
   ```

2. Para cada credencial por produto em uso por **uma** implantação, vincule-a à instância que essa
   implantação atende. O segredo não muda; nada precisa ser reconfigurado no produto:

   ```bash
   npm run app-credential -- bind <id> --instance <slug>
   ```

3. Se a mesma credencial era usada por **várias** implantações, vincule-a a uma delas (passo 2) e,
   para cada uma das outras, emita uma nova, configure a implantação e reinicie-a:

   ```bash
   npm run app-credential -- create <produto> "<rótulo>" --scopes sessions,members,connection --instance <slug>
   ```

4. Implante o Core. Confira nos eventos de segurança (`credencial_aplicacao` com resultado
   `negado`, `instancia_divergente`) que nenhuma implantação ficou para trás.
5. Revogue o que sobrou sem uso: `npm run app-credential -- revoke <id>`.

Pedido com o slug de outra instância recebe a mesma resposta de uma instância inexistente e gera
o evento `instancia_divergente` com a credencial — investigar sempre.

## 2. TLS até o MySQL e host das credenciais (SEC-15)

- `MYSQL_TLS=required` (cifra; certificado do servidor não verificado) ou `verify` (com
  `MYSQL_TLS_CA` apontando para o PEM da CA). `off` só em `development`: em homologação e produção
  o Core recusa iniciar.
- `INSTANCE_DB_USER_HOST` = padrão de host da rede da aplicação (ex.: `10.0.%`). `%` só em
  `development`.
- Credenciais operacionais novas já nascem com `REQUIRE SSL` e o host configurado. Para as
  existentes, depois de implantar:

  ```bash
  npm run instances:sync-grants
  ```

  Isso aplica `REQUIRE SSL` e os privilégios por tabela. **Host:** usuários criados antes com
  `'%'` precisam ser renomeados pela operação (o provisionador não lê `mysql.user`):
  `RENAME USER 'inst_x'@'%' TO 'inst_x'@'10.0.%';` — depois rode `instances:sync-grants` de novo.

- As credenciais do próprio Core (`spark_core_*`, `spark_provisioner`, `spark_access_writer`) são
  criadas pela operação: crie-as com o mesmo host restrito e `REQUIRE SSL`.
- O contrato `/connection` passa a devolver `tls: "required"`; o produto MUST abrir o pool com TLS.
- Em desenvolvimento o `compose.yaml` publica o MySQL só em `127.0.0.1`.

## 3. Tabelas só-inserção (SEC-12)

O artefato declara `appendOnlyTables` (o Tuteli declara `auditoria_evento`). A credencial
operacional recebe só `SELECT, INSERT` nelas e nenhuma escrita em `_spark_*`. Provisionamento e
migrações reaplicam sozinhos; instâncias existentes: `npm run instances:sync-grants`.

## 4. Proxies confiáveis (SEC-13)

`TRUSTED_PROXIES` lista os IPs/CIDRs do proxy reverso. Só deles o Core aceita `X-Forwarded-For`
(salto mais à direita não confiável); vazio = IP do socket. Sem isso, atrás de proxy todos os
usuários do painel compartilham um IP e a limitação por origem bloqueia todos.

## 5. Limitação de login (SEC-02, SEC-14)

| Regra                                     | Limite                                                          |
| ----------------------------------------- | --------------------------------------------------------------- |
| (e-mail, origem)                          | a partir da 5ª falha, atraso de 1 s dobrando até 15 min         |
| e-mail (qualquer origem)                  | 100 falhas em 1 h → 15 min; evento `login_bloqueado` ao titular |
| origem (painel) / credencial+IP (produto) | 50 falhas em 15 min → 15 min                                    |
| credencial de aplicação                   | 300 falhas em 15 min → 15 min                                   |

O Core ainda não tem canal de e-mail: o aviso de bloqueio é o evento `login_bloqueado` (consulta de
eventos de segurança) e um alerta `login_bloqueado` no log — configure o alerta no coletor de logs.
