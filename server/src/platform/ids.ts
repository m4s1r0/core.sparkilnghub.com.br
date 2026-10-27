import { v7 as uuidv7, validate as uuidValidate } from "uuid";

export const newId = (): string => uuidv7();

export function isUuid(value: string): boolean {
  return uuidValidate(value);
}

export function uuidToBin(uuid: string): Buffer {
  if (!isUuid(uuid)) throw new TypeError("UUID inválido");
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function binToUuid(bin: Buffer): string {
  if (bin.length !== 16) throw new TypeError("BINARY(16) esperado");
  const hex = bin.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const PREFIX = /^[a-z][a-z0-9]{2,15}_$/;

/**
 * Nome do banco de uma instância: prefixo do produto + UUID sem hífens. Nunca derivado de texto
 * livre (SC-016, princípio I).
 */
export function instanceDatabaseName(prefix: string, uuid: string): string {
  if (!PREFIX.test(prefix)) throw new TypeError(`Prefixo de banco inválido: ${prefix}`);
  if (!isUuid(uuid)) throw new TypeError("UUID de instância inválido");
  return `${prefix}${uuid.replaceAll("-", "").toLowerCase()}`;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** Base32 (RFC 4648, minúsculas, sem preenchimento): 16 bytes → 26 caracteres. */
function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Usuário MySQL operacional da instância: `inst_` + UUID inteiro em base32 (31 caracteres, limite
 * de 32 do MySQL). Sem perda: dois UUIDs nunca compartilham o usuário. A versão anterior truncava
 * o UUID em 24 caracteres hexadecimais e fazia instâncias com UUIDs próximos (as sementes A e B)
 * dividirem a mesma credencial (F02, defeito corrigido).
 */
export function instanceUserName(uuid: string): string {
  if (!isUuid(uuid)) throw new TypeError("UUID de instância inválido");
  return `inst_${base32(uuidToBin(uuid))}`;
}

/** Nome do usuário até F01 (truncado); só para a limpeza de desenvolvimento. */
export function legacyInstanceUserName(uuid: string): string {
  return `inst_${uuid.replaceAll("-", "").toLowerCase().slice(0, 24)}`;
}

/**
 * Nome de banco para uso em GRANT: `_` e `%` são curingas ali e precisam de escape, senão o
 * padrão concedido fica mais amplo que o banco (e mais amplo que o grant do provisionador).
 */
export function grantDatabaseName(database: string): string {
  return database.replace(/[_%]/g, (char) => "\\" + char);
}
