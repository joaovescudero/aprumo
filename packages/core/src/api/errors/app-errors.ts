// Custom error classes for the Aprumo ledger API.
//
// Per CLAUDE.md conventions: error classes extend Error, discriminated by `name` and `code`.
// Never throw strings. Each class sets this.name for proper stack trace display and
// instanceof checks across module boundaries.
//
// Per D-02: HTTP status codes are embedded in each error class (statusCode) so the
// pgErrorHandler can derive the correct HTTP response without duplicating the mapping.

/**
 * Base error class for all Aprumo ledger domain errors.
 * Discriminated by the `code` property (machine-readable, kebab-case).
 */
export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/**
 * Thrown when withRetryOnSerializationFailure exhausts all retry attempts (SQLSTATE 40001).
 * Maps to HTTP 503 — the caller should retry the request.
 */
export class SerializationRetryExhaustedError extends LedgerError {
  public readonly retryable = true;

  constructor() {
    super("Serialization retry exhausted", "serialization_retry_exhausted", 503);
    this.name = "SerializationRetryExhaustedError";
  }
}

/**
 * Thrown when request body or header validation fails.
 * Maps to HTTP 422 Unprocessable Entity.
 */
export class ValidationError extends LedgerError {
  constructor(message: string) {
    super(message, "validation_error", 422);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a requested resource (account, transaction) is not found.
 * Maps to HTTP 404 Not Found.
 */
export class NotFoundError extends LedgerError {
  constructor(message: string) {
    super(message, "not_found", 404);
    this.name = "NotFoundError";
  }
}
