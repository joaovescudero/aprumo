---
phase: 03-core-ledger-api
plan: "04"
subsystem: core-api
tags:
  - fastify
  - typebox
  - bigint-serialization
  - schemas
  - openapi
  - tdd
dependency_graph:
  requires:
    - 03-01  # fastify + typebox packages installed
    - 03-03  # pgErrorHandler created
  provides:
    - createServer factory (server.ts)
    - AnyDrizzleDb type union
    - registerBigIntSerializer plugin
    - TypeBox schemas (transaction.ts, account.ts, common.ts)
  affects:
    - 03-05  # transaction routes — imports PostTransactionBodySchema, AnyDrizzleDb
    - 03-06  # account routes — imports AccountResponseSchema, AnyDrizzleDb
    - 03-07  # health route — imports createServer for full integration tests
tech_stack:
  added:
    - "@fastify/swagger registered via createServer factory"
    - "@fastify/swagger-ui registered at /docs routePrefix"
    - "setSerializerCompiler + setReplySerializer for universal BigInt→string"
    - "TypeBoxTypeProvider wired to Fastify instance"
  patterns:
    - "Two-layer BigInt serializer: setSerializerCompiler (schema routes) + setReplySerializer (fallback)"
    - "createServer(db) factory injectable for tests (node-postgres Pool) and main.ts (postgres.js)"
    - "AnyDrizzleDb union type exported for use across all route plugins"
key_files:
  created:
    - packages/core/src/api/schemas/common.ts
    - packages/core/src/api/schemas/transaction.ts
    - packages/core/src/api/schemas/account.ts
    - packages/core/src/api/plugins/bigint-serializer.ts
    - packages/core/src/api/server.ts
    - packages/core/src/api/server.test.ts
  modified: []
decisions:
  - "Two-layer BigInt serializer: setSerializerCompiler alone does not apply to schema-less routes in Fastify 5 (confirmed by runtime test). Added setReplySerializer as universal fallback covering both schema-validated and schema-less routes."
  - "AnyDrizzleDb = PostgresJsDatabase | NodePgDatabase to support postgres.js (production) and pg.Pool via drizzle-orm/node-postgres (testcontainers tests)"
  - "registerBigIntSerializer must be called BEFORE swagger and route registration (wiring order enforced in createServer)"
metrics:
  duration: "8m 5s"
  completed: "2026-05-30"
  tasks_completed: 3
  files_created: 6
---

# Phase 03 Plan 04: TypeBox Schemas, BigInt Serializer, and Server Factory Summary

**One-liner:** Fastify 5 server factory with TypeBox type provider, two-layer BigInt→string serializer (setSerializerCompiler + setReplySerializer), swagger registered before routes, and 6 TypeBox schemas for transactions/accounts/common.

## What Was Built

### Task 1 — TypeBox schema files (feat commit fa56a47)

Three schema files created in `packages/core/src/api/schemas/`:

**common.ts:** `ProblemSchema` (RFC 9457 — type/title/status/detail/code/instance) and `PaginationCursorSchema`.

**transaction.ts:**
- `PostingInputSchema` — amount_cents as `Type.Integer({minimum:1})` (request)
- `PostTransactionBodySchema` — postings array (minItems:2), optional description/metadata
- `PostTransactionHeadersSchema` — lowercase `"idempotency-key"` (Fastify lowercases headers)
- `PostingResponseSchema` — amount_cents as `Type.String()` (BigInt serialized as decimal string)
- `TransactionResponseSchema` — full transaction with postings array
- `GetTransactionParamsSchema` — UUID format validation on :id param

**account.ts:**
- `PostAccountBodySchema` — type enum (5 account types), owner_ref (not logged), optional metadata
- `AccountResponseSchema` — balance as `Type.Union([Type.String(), Type.Null()])` (null when balance worker hasn't run)
- `GetAccountParamsSchema`, `GetPostingsParamsSchema` — UUID format on :id
- `GetPostingsQuerySchema` — cursor (opaque string), limit (max 200, default 50 per D-06)
- `PostingsPageResponseSchema` — data array + next_cursor (string | null)

### Task 2 — TDD RED (test commit d5275ef)

`server.test.ts` written with 3 test cases importing from `./server.js` (non-existent at commit time):
- BigInt 100n → string '100' (not number 100)
- BigInt 9007199254740993n → string '9007199254740993' (>MAX_SAFE_INTEGER, no precision loss)
- GET /docs → statusCode < 400 (swagger UI up)

### Task 3 — TDD GREEN (feat commit c11d9a5)

**bigint-serializer.ts:** `registerBigIntSerializer(app)` — two-layer approach:
1. `setSerializerCompiler` — replaces fast-json-stringify for TypeBox schema-validated routes
2. `setReplySerializer` — universal fallback for schema-less routes (test routes, edge cases)

Both use the same `bigIntReplacer` function: `typeof value === 'bigint' ? value.toString() : value`

**server.ts:** `createServer(db: AnyDrizzleDb)` factory:
- Fastify 5 + TypeBoxTypeProvider
- coerceTypes: false, removeAdditional: 'all', useDefaults: true (Ajv strict config)
- onProtoPoisoning: 'error' (T-03-04c)
- genReqId: randomUUID() (D-09)
- pino logger: silent in test, info in prod; redact: authorization, cookie, idempotency-key (D-10)
- BigInt serializer registered FIRST
- @fastify/swagger then @fastify/swagger-ui BEFORE routes (Pitfall 4 prevention)
- pgErrorHandler wired via setErrorHandler
- X-Request-Id onSend hook (D-09)
- Exports: `createServer`, `AnyDrizzleDb`, `ServerOptions`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two-layer BigInt serializer required for Fastify 5 schema-less routes**
- **Found during:** Task 3 GREEN implementation
- **Issue:** `setSerializerCompiler` alone does not apply to routes without a response schema in Fastify 5. Routes without schemas fall through to native `JSON.stringify`, which throws `TypeError: Do not know how to serialize a BigInt`. The test routes (`app.get('/test-bigint', {}, ...)`) have no response schema per the plan spec, so they hit this code path.
- **Root cause confirmed:** `node --input-type=module` test in `packages/core` context showed status 500 with `"Do not know how to serialize a BigInt"` before fix; status 200 with `{"amount_cents":"100"}` after adding `setReplySerializer`.
- **Fix:** Added `app.setReplySerializer((payload) => JSON.stringify(payload, bigIntReplacer))` as universal fallback alongside the `setSerializerCompiler`. The two layers are disjoint: schema present → setSerializerCompiler; schema absent → setReplySerializer.
- **Files modified:** `packages/core/src/api/plugins/bigint-serializer.ts`
- **Why not Rule 4:** No architectural change — same module, same responsibility, complementary Fastify API. Production routes all have TypeBox response schemas so `setSerializerCompiler` is the primary path; `setReplySerializer` is defense-in-depth.

None of the other plan items required deviation.

## TDD Gate Compliance

- RED commit: `d5275ef` — `test(03-04): add failing server.test.ts`
- GREEN commit: `c11d9a5` — `feat(03-04): implement bigint-serializer.ts and createServer factory`
- Gate sequence: RED precedes GREEN. No refactor commit needed (code is clean).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what is documented in the plan's `<threat_model>`. The `/docs` endpoint is unauthenticated as explicitly accepted (T-03-04e).

## Self-Check: PASSED

All 6 created files confirmed present on disk. All 3 task commits (fa56a47, d5275ef, c11d9a5) confirmed in git log.
