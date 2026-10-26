/** Erro de aplicação com código estável (contracts/conventions.md §4–5). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly options: {
      retryable?: boolean;
      field?: string | null;
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
}
