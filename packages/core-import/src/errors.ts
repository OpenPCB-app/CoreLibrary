export class ImportValidationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = "import-validation",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ImportValidationError";
    this.code = code;
    this.details = details;
  }
}
