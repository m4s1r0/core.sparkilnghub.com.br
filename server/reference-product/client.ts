import { createHash } from "node:crypto";
import type { Connection } from "mysql2/promise";

/**
 * Cliente do produto de referência sintético (`sparkref`): a implementação de referência do
 * contrato de dados da projeção de acesso (contracts/access-projection.md) e dos contratos
 * internos de sessão (/internal/v1). É o que o SparkPet fará — sem nenhuma regra de negócio.
 *
 * Validação: uma consulta no banco de acesso da PRÓPRIA instância, com o usuário `inst_*`, sem
 * chamar o Core. Logout: só inserção em `access_session_logout`. Login e atividade: Core.
 */
export interface ProductHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface ProductHttpResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface ValidSession {
  accountId: string;
  membershipId: string;
  displayName: string;
  role: "administrador" | "colaborador";
  authorizationRevision: number;
}

interface Row {
  account_id: Buffer;
  membership_id: Buffer;
  display_name: string;
  role: ValidSession["role"];
  authorization_revision: number;
}

const uuid = (bin: Buffer) => {
  const hex = bin.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Regra normativa de validação (contracts/access-projection.md), copiada do contrato. */
const VALIDATE = `
  SELECT s.account_id, s.membership_id, m.display_name, m.role, i.authorization_revision
    FROM access_session s
    JOIN access_member m ON m.membership_id = s.membership_id
    JOIN access_instance i ON TRUE
   WHERE s.id_hash = ?
     AND s.ended_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM access_session_logout l WHERE l.id_hash = s.id_hash)
     AND s.expires_at > ?
     AND s.last_seen_at > ? - INTERVAL s.idle_timeout_seconds SECOND
     AND s.auth_revision = m.account_auth_revision
     AND m.status = 'ativo'
     AND m.account_status = 'ativa'
     AND i.state = 'ativa'`;

export class ReferenceProductClient {
  readonly slug: string;
  readonly access: Connection;
  readonly #credential: string;
  readonly #http: (request: ProductHttpRequest) => Promise<ProductHttpResponse>;

  constructor(options: {
    slug: string;
    /** `<id>.<segredo>` da credencial de aplicação do produto. */
    credential: string;
    /** Conexão com o banco de acesso da instância, usuário `inst_*` (só leitura + logout). */
    access: Connection;
    http: (request: ProductHttpRequest) => Promise<ProductHttpResponse>;
  }) {
    this.slug = options.slug;
    this.access = options.access;
    this.#credential = options.credential;
    this.#http = options.http;
  }

  #call(
    method: "GET" | "POST",
    path: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ) {
    return this.#http({
      method,
      url: `/internal/v1/instances/${this.slug}${path}`,
      headers: { authorization: `Bearer ${this.#credential}`, ...headers },
      ...(body !== undefined ? { body } : {}),
    });
  }

  /** Login pelo Core: o produto nunca vê senha guardada; recebe só o token opaco. */
  login(email: string, password: string, clientIp: string): Promise<ProductHttpResponse> {
    return this.#call("POST", "/sessions", {}, { email, password, clientIp });
  }

  /**
   * Valida o `INSTANCE_TOKEN` no banco da instância. `now` explícito nos testes; sem ele, o
   * relógio do MySQL. Nenhum dado enviado pelo navegador participa da decisão.
   */
  async validate(token: string, now?: Date): Promise<ValidSession | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const at = now ?? new Date();
    const [rows] = await this.access.query(VALIDATE, [sha256(token), at, at]);
    const row = (rows as Row[])[0];
    if (!row) return null;
    return {
      accountId: uuid(row.account_id),
      membershipId: uuid(row.membership_id),
      displayName: row.display_name,
      role: row.role,
      authorizationRevision: row.authorization_revision,
    };
  }

  /** Logout local: só acrescenta o encerramento; nunca pode ser desfeito pelo produto. */
  async logout(token: string): Promise<void> {
    await this.access.query(
      "INSERT IGNORE INTO access_session_logout (id_hash, ended_at) VALUES (?, UTC_TIMESTAMP(6))",
      [sha256(token)],
    );
  }

  /** Atividade (inatividade de 2 h medida pelo Core); chamar no máximo a cada 5 min. */
  async touch(token: string): Promise<number> {
    const response = await this.#call("POST", "/sessions/touch", { "x-instance-session": token });
    return response.status;
  }

  /** Contrato de vínculos locais (US4): chamada genérica com a sessão do administrador local. */
  members(
    token: string,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ProductHttpResponse> {
    return this.#call(method, path, { "x-instance-session": token, ...headers }, body);
  }
}
