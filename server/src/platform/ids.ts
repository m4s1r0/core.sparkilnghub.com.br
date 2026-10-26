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

/** Usuário MySQL operacional da instância (máximo 32 caracteres). */
export function instanceUserName(uuid: string): string {
  if (!isUuid(uuid)) throw new TypeError("UUID de instância inválido");
  return `inst_${uuid.replaceAll("-", "").toLowerCase().slice(0, 24)}`;
}

/**
 * Nome de banco para uso em GRANT: `_` e `%` são curingas ali e precisam de escape, senão o
 * padrão concedido fica mais amplo que o banco (e mais amplo que o grant do provisionador).
 */
export function grantDatabaseName(database: string): string {
  return database.replace(/[_%]/g, (char) => "\\" + char);
}
