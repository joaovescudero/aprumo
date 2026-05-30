// withRetryOnSerializationFailure — retry wrapper for SERIALIZABLE transactions.
//
// Per CLAUDE.md Invariant #5: operations that touch the ledger use SERIALIZABLE isolation.
// PG SQLSTATE 40001 (serialization_failure) requires the ENTIRE transaction to be retried
// from scratch — not just the failing SQL statement. This function wraps the full
// db.transaction() factory function and retries up to MAX_RETRIES times with exponential backoff.
//
// CRITICAL: Caller must pass a factory fn `() => Promise<T>`, NOT the promise itself.
// Each retry must create a fresh db.transaction() call.
//
// Reference: postgresql.org/docs/current/mvcc-serialization-failure-handling.html
// See: T-03-03b (DoS mitigation: MAX_RETRIES=3, backoff 50/100/200ms)

const SERIALIZATION_FAILURE = "40001";
const MAX_RETRIES = 3;

/**
 * Wraps an async factory function in a retry loop for PG serialization failures.
 *
 * On SQLSTATE 40001, waits with exponential backoff (50ms, 100ms, 200ms) and retries
 * the full factory (including the db.transaction() call). After MAX_RETRIES exhausted,
 * re-throws the last error. Non-40001 errors are re-thrown immediately without retry.
 */
export async function withRetryOnSerializationFailure<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      // Extract PG error code using type-safe pattern (no any).
      // Must check both err.code (postgres-js native PostgresError at COMMIT level)
      // AND err.cause.code (Drizzle's DrizzleQueryError wrapping a PG DatabaseError for
      // intra-transaction query failures). Mirrors pg-error-handler.ts:160 and
      // transactions.ts:193 where the same dual-path check is applied.
      const pgCode =
        typeof err === "object" && err !== null
          ? ((err as { code?: unknown }).code ??
            (err as { cause?: { code?: unknown } }).cause?.code)
          : undefined;

      if (pgCode === SERIALIZATION_FAILURE && attempt < MAX_RETRIES) {
        lastError = err;
        // Exponential backoff: 50ms, 100ms, 200ms
        await new Promise<void>((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
        continue;
      }
      // Non-40001 error, or retries exhausted on last attempt — throw immediately
      throw err;
    }
  }
  // Unreachable in correct flow (loop always returns or throws), but TypeScript requires this
  throw lastError;
}
