/**
 * Normalização documentada do e-mail (COM-007): sem espaços nas pontas e em minúsculas. Pontos e
 * sufixos `+` são preservados: remover mudaria o endereço em muitos provedores.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `a***@dominio`: identifica o convite sem revelar o endereço completo. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
