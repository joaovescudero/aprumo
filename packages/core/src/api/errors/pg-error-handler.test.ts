// pg-error-handler unit tests (RED — written before pg-error-handler.ts and app-errors.ts exist).
// Per API-11: pgErrorHandler maps PG error codes to RFC 9457 application/problem+json responses.
// Per D-02: all error responses use application/problem+json with type/title/status/detail/code/instance.
// Per D-08: missing Idempotency-Key header is 400 code='idempotency_key_required' (client protocol error).
// Per D-09: instance field is set to req.id (X-Request-Id correlation id).
// Per T-03-03a: 500 path NEVER leaks error.message or error.stack in the response body.
//
// Wave dependency: Plan 03 (this plan). No DB needed — pure unit tests with vi.fn() mocks.
// Tests are RED until pg-error-handler.ts and app-errors.ts are implemented.

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { pgErrorHandler } from "./pg-error-handler.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockReply() {
  const reply = {
    statusCode: 200,
    _body: undefined as unknown,
    _headers: {} as Record<string, string>,
  };

  const mock = {
    status: vi.fn((code: number) => {
      reply.statusCode = code;
      return mock;
    }),
    send: vi.fn((body: unknown) => {
      reply._body = body;
      return mock;
    }),
    header: vi.fn((name: string, value: string) => {
      reply._headers[name] = value;
      return mock;
    }),
    // Expose internal state for assertions
    _state: reply,
  };

  return mock;
}

function makeMockRequest(id = "test-req-id") {
  return { id } as unknown as FastifyRequest;
}

function makeError(fields: Record<string, unknown>): FastifyError {
  return Object.assign(new Error(String(fields.message ?? "error")), fields) as FastifyError;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("pgErrorHandler", () => {
  it("maps P0001 with 'do not balance' message to 422 unbalanced_postings", () => {
    const error = makeError({ code: "P0001", message: "postings do not balance" });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(422);
    expect(reply._state._body).toMatchObject({
      code: "unbalanced_postings",
      status: 422,
      instance: "test-req-id",
    });
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("maps 40001 to 503 serialization_retry_exhausted with retryable=true", () => {
    const error = makeError({ code: "40001" });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(503);
    expect(reply._state._body).toMatchObject({
      code: "serialization_retry_exhausted",
      status: 503,
      retryable: true,
      instance: "test-req-id",
    });
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("maps validation error with missingProperty=idempotency-key to 400 idempotency_key_required", () => {
    const error = makeError({
      message: "validation error",
      validation: [{ instancePath: "/headers", missingProperty: "idempotency-key" }],
    });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(400);
    expect(reply._state._body).toMatchObject({
      code: "idempotency_key_required",
      status: 400,
      instance: "test-req-id",
    });
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("maps generic validation error (non-idempotency-key) to 422 validation_error", () => {
    const error = makeError({
      message: "validation error",
      validation: [{ instancePath: "/body/postings", message: "must be string" }],
    });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(422);
    expect(reply._state._body).toMatchObject({
      code: "validation_error",
      status: 422,
      instance: "test-req-id",
    });
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("maps 23505 to 409 conflict", () => {
    const error = makeError({ code: "23505", message: "duplicate key value" });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(409);
    expect(reply._state._body).toMatchObject({
      code: "conflict",
      status: 409,
      instance: "test-req-id",
    });
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("maps unknown error code to 500 internal_error without leaking SQL details", () => {
    const error = makeError({
      code: undefined,
      message: "SELECT * FROM secrets WHERE password = '1234'",
    });
    const req = makeMockRequest();
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect(reply._state.statusCode).toBe(500);
    const body = reply._state._body as Record<string, unknown>;
    expect(body.code).toBe("internal_error");
    expect(body.status).toBe(500);
    expect(body.instance).toBe("test-req-id");
    // Must NOT leak SQL details (T-03-03a: information disclosure mitigation)
    expect(String(body.detail)).not.toContain("SELECT");
    expect(String(body.detail)).not.toContain("secrets");
    expect(body.detail).not.toBe(error.message);
    expect(reply._state._headers["content-type"]).toBe("application/problem+json");
  });

  it("sets body.instance to the request id (correlation id D-09)", () => {
    const error = makeError({ code: "23505", message: "conflict" });
    const req = makeMockRequest("custom-correlation-id-xyz");
    const reply = makeMockReply();

    pgErrorHandler(error, req, reply as unknown as FastifyReply);

    expect((reply._state._body as Record<string, unknown>).instance).toBe(
      "custom-correlation-id-xyz",
    );
  });
});
