---
"@aprumo/core": minor
---

Phase 03: Core Ledger API.

- Fastify 5 HTTP server factory with BigInt-safe JSON serialization and OpenAPI `/docs`.
- `POST /v1/transactions` (idempotent via Idempotency-Key) and `GET /v1/transactions/:id`.
- `POST /v1/accounts` and `GET /v1/accounts/:id` with keyset (cursor) pagination over postings.
- `GET /health` liveness/readiness route.
- `withRetryOnSerializationFailure` wrapper for `40001` serialization failures (incl. Drizzle-wrapped `err.cause.code`).
- RFC 9457 problem-details error handling via `pgErrorHandler` mapping Postgres error codes to HTTP responses.
- Migration `0016_postings_created_at`: adds `created_at` column + index to `postings` for cursor pagination.
