import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/** Segredo aleatório em base64url (padrão 32 bytes = 256 bits): sessões, convites, links. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Compara dois resumos em hexadecimal sem vazar, pelo tempo, onde diferem. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Chaves AES-256 por versão (research.md R-03): a atual cifra; as anteriores só decifram, para
 * permitir rotação sem recadastro.
 */
export class KeyRing {
  readonly #keys = new Map<number, Buffer>();

  constructor(
    readonly currentVersion: number,
    current: Buffer,
    previous: ReadonlyMap<number, Buffer> = new Map(),
  ) {
    for (const [version, key] of [...previous, [currentVersion, current] as const]) {
      if (key.length !== 32) throw new TypeError("A chave AES-256 deve ter 32 bytes");
      this.#keys.set(version, key);
    }
  }

  /** Chave em base64 (ex.: `IDENTITY_SECRET_KEY`, `INSTANCE_SECRET_KEY`) na versão indicada. */
  static fromBase64(version: number, base64: string): KeyRing {
    return new KeyRing(version, Buffer.from(base64, "base64"));
  }

  key(version: number): Buffer {
    const key = this.#keys.get(version);
    if (!key) throw new Error(`versão de chave ${version} indisponível`);
    return key;
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM; saída `iv ‖ tag ‖ cifra`. `aad` amarra o segredo ao dono (ex.: id da conta). */
export function encryptSecret(
  ring: KeyRing,
  plain: Buffer,
  aad: Buffer,
): { data: Buffer; keyVersion: number } {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", ring.key(ring.currentVersion), iv);
  cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    data: Buffer.concat([iv, cipher.getAuthTag(), encrypted]),
    keyVersion: ring.currentVersion,
  };
}

export function decryptSecret(
  ring: KeyRing,
  data: Buffer,
  keyVersion: number,
  aad: Buffer,
): Buffer {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    ring.key(keyVersion),
    data.subarray(0, IV_BYTES),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}
