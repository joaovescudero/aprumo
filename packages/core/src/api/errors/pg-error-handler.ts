// pgErrorHandler — Fastify global error handler mapping PG error codes to RFC 9457 problem+json.
//
// Per D-02: all error responses use Content-Type: application/problem+json with RFC 9457 shape:
//   { type, title, status, detail, code, instance }
// Per D-09: instance is set to req.id (X-Request-Id correlation id injected by Fastify).
// Per T-03-03a: 500 path NEVER includes error.message or error.stack in the response body.
// Per T-03-03c: pgCode extracted via type-safe cast — unknown errors fall through to 500.
//
// Discrimination order (per plan):
//   1) validation array present AND some element has missingProperty === 'idempotency-key' → 400
//   2) validation array present (generic) → 422
//   3) pgCode === 'P0001' with 'do not balance' message → 422 unbalanced_postings
//   4) pgCode === 'P0001' other → 422 ledger_constraint_violation
//   5) pgCode === '40001' → 503 serialization_retry_exhausted
//   6) pgCode === '23505' → 409 conflict
//   7) default → 500 internal_error (no internals leaked)

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

// PG SQLSTATE / error code constants
const PG_RAISE_EXCEPTION = "P0001";
const PG_SERIALIZATION_FAILURE = "40001";
const PG_UNIQUE_VIOLATION = "23505";

/**
 * RFC 9457 problem+json response body shape.
 * The `type` field is a URN giving a machine-readable error namespace.
 */
interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  instance: string;
  [key: string]: unknown; // allow additional fields (e.g. retryable)
}

function buildProblem(
  status: number,
  code: string,
  title: string,
  detail: string,
  instance: string,
): ProblemDetail {
  return {
    type: `urn:aprumo:error:${code}`,
    title,
    status,
    detail,
    code,
    instance,
  };
}

/**
 * Type guard for a validation element that indicates a missing idempotency-key header.
 * Per D-08: missing Idempotency-Key is a client protocol error (400), distinct from
 * generic schema validation failures (422).
 */
function isMissingIdempotencyKeyElement(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;

  // Ajv 8 format (Fastify 5): missingProperty nested under params
  // { keyword: 'required', params: { missingProperty: 'idempotency-key' }, ... }
  const el = element as Record<string, unknown>;
  if (
    typeof el.params === "object" &&
    el.params !== null &&
    (el.params as Record<string, unknown>).missingProperty === "idempotency-key"
  ) {
    return true;
  }

  // Legacy fallback: top-level missingProperty (used in unit tests with hand-crafted errors)
  if ("missingProperty" in el && el.missingProperty === "idempotency-key") {
    return true;
  }

  return false;
}

/**
 * Fastify error handler that maps PG error codes (and Fastify validation errors)
 * to RFC 9457 application/problem+json HTTP responses.
 *
 * Registered via: `app.setErrorHandler(pgErrorHandler)`
 *
 * NEVER logs error.message in the response body for 500 errors (T-03-03a).
 */
export function pgErrorHandler(
  error: FastifyError & { code?: string; validation?: unknown[]; validationContext?: string },
  req: FastifyRequest,
  reply: FastifyReply,
): void {
  const instance = req.id;

  // Helper: set content-type and send the problem body
  const sendProblem = (status: number, body: ProblemDetail): void => {
    reply.header("content-type", "application/problem+json");
    reply.status(status).send(body);
  };

  // 1 & 2) Fastify validation errors (schema rejection)
  if (Array.isArray(error.validation)) {
    // Check for missing Idempotency-Key header (D-08: 400, not 422)
    if (error.validation.some(isMissingIdempotencyKeyElement)) {
      sendProblem(
        400,
        buildProblem(
          400,
          "idempotency_key_required",
          "Idempotency-Key header is required",
          "The Idempotency-Key header must be provided for this request.",
          instance,
        ),
      );
      return;
    }

    // Path params validation failure → 400 (malformed request structure, not business validation)
    // validationContext='params' is set by Fastify when the path parameter fails validation.
    // e.g. GET /v1/transactions/not-a-uuid fails uuid format check → 400.
    if (error.validationContext === "params") {
      sendProblem(
        400,
        buildProblem(
          400,
          "validation_error",
          "Validation failed",
          "Request path parameters did not pass schema validation.",
          instance,
        ),
      );
      return;
    }

    // Generic validation failure (body / headers) → 422
    sendProblem(
      422,
      buildProblem(
        422,
        "validation_error",
        "Validation failed",
        "Request body or headers did not pass schema validation.",
        instance,
      ),
    );
    return;
  }

  // Extract PG error code via safe cast (per PATTERNS.md pattern, no any).
  // Drizzle wraps PG query errors as DrizzleQueryError with message "Failed query: ..."
  // and stores the original PG DatabaseError (with its SQLSTATE code) as `error.cause`.
  // We must check both the top-level code AND the cause's code.
  const errAsObj = error as unknown as {
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const pgCode = errAsObj.code ?? errAsObj.cause?.code;

  // 2.5) Application not_found errors (thrown by route handlers for missing resources)
  // Route handlers cannot call reply.status(404) when the TypeBox schema only declares 200,
  // so they throw an error with code='not_found' and statusCode=404 instead.
  //
  // 2.6) Application invalid_cursor errors (thrown by accounts postings handler — T-03-06a)
  // Cursor decode failures must return 400 with code='invalid_cursor', not 500.
  if (pgCode === "invalid_cursor") {
    sendProblem(
      400,
      buildProblem(
        400,
        "invalid_cursor",
        "Invalid cursor",
        error.message ?? "The cursor parameter is malformed or expired.",
        instance,
      ),
    );
    return;
  }

  if (pgCode === "not_found" || (error as unknown as { statusCode?: number }).statusCode === 404) {
    sendProblem(
      404,
      buildProblem(
        404,
        "not_found",
        "Not found",
        error.message ?? "The requested resource was not found.",
        instance,
      ),
    );
    return;
  }

  // 3 & 4) PG RAISE EXCEPTION (post_transaction validation failures)
  if (pgCode === PG_RAISE_EXCEPTION) {
    // Check for "do not balance" in the cause message (Drizzle-wrapped) or top-level message.
    const pgMessage = errAsObj.cause?.message ?? error.message;
    if (pgMessage.includes("do not balance")) {
      sendProblem(
        422,
        buildProblem(
          422,
          "unbalanced_postings",
          "Unbalanced postings",
          "Transaction postings must sum to zero (double-entry invariant).",
          instance,
        ),
      );
    } else {
      sendProblem(
        422,
        buildProblem(
          422,
          "ledger_constraint_violation",
          "Ledger constraint violation",
          "A ledger constraint was violated. Check the transaction postings.",
          instance,
        ),
      );
    }
    return;
  }

  // 5) Serialization failure — withRetryOnSerializationFailure exhausted retries
  if (pgCode === PG_SERIALIZATION_FAILURE) {
    const body = {
      ...buildProblem(
        503,
        "serialization_retry_exhausted",
        "Service temporarily unavailable",
        "The transaction could not be serialized after multiple attempts. Please retry.",
        instance,
      ),
      retryable: true,
    };
    sendProblem(503, body);
    return;
  }

  // 6) Unique violation (e.g. duplicate account id, other unique constraints)
  if (pgCode === PG_UNIQUE_VIOLATION) {
    sendProblem(
      409,
      buildProblem(
        409,
        "conflict",
        "Conflict",
        "A resource with the same unique identifier already exists.",
        instance,
      ),
    );
    return;
  }

  // 7) Default — unknown error. NEVER leak error.message or error.stack (T-03-03a).
  sendProblem(
    500,
    buildProblem(
      500,
      "internal_error",
      "Internal server error",
      "An unexpected error occurred.",
      instance,
    ),
  );
}
