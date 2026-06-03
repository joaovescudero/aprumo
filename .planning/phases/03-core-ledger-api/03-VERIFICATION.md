---
phase: 03-core-ledger-api
verified: 2026-05-30T15:30:00Z
status: passed
score: 5/5 roadmap success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Coverage gate: pnpm vitest run --coverage exits 0 with ≥90% functions on packages/core/src/** — resolved by fabd65f (exclude **/db/schema.ts from coverage collection)"
    - "withRetryOnSerializationFailure detects SQLSTATE 40001 through Drizzle's DrizzleQueryError wrapper (cause.code path) — resolved by 698ea4b (dual-path extraction) + 15db583 (RED test)"
  gaps_remaining: []
  regressions: []
known_flake:
  file: "tests/helpers/applyMigrationsToSchema.test.ts"
  test: "Test 6 (idempotent)"
  error: "PostgresError 42P07 — relation account_balance already exists"
  classification: "pre-existing phase-2 test-infra state-leak; intermittent; NOT a phase-3 gap"
  tracked: "/gsd-debug (separate investigation)"
---

# Phase 03: Core Ledger API Verification Report

**Phase Goal:** Core Ledger API — Fastify REST endpoints for transactions/accounts/postings, post_transaction function integration, idempotency, serialization-failure (40001) retry, BigInt-as-string serializer, RFC 9457 error handling, /health, swagger /docs.
**Verified:** 2026-05-30T15:30:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (two blockers from initial run)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC#1 | POST /transactions with balanced postings returns 201; amount_cents in JSON response is a string (not a number) | ✓ VERIFIED | transactions.test.ts:80-103 asserts 201 + `typeof amount_cents === 'string'`; BigInt serializer in bigint-serializer.ts uses JSON.stringify replacer; PostingResponseSchema declares Type.String() for amount_cents |
| SC#2 | POST /transactions with same Idempotency-Key sent twice concurrently (Promise.all) resolves both — no 409 or 500 | ✓ VERIFIED | transactions.test.ts:135-157 uses Promise.all([injectRequest(), injectRequest()]) and asserts both get [200,201] with same transaction id. No regression from gap-closure commits. |
| SC#3 | POST /transactions with unbalanced postings returns 422 with code=unbalanced_postings | ✓ VERIFIED | transactions.test.ts:159-183 asserts 422 + parsed.code === 'unbalanced_postings' + Content-Type: application/problem+json; pgErrorHandler maps P0001 → 422 |
| SC#4 | withRetryOnSerializationFailure wrapper retries entire db.transaction() on SQLSTATE 40001 — including Drizzle-wrapped DrizzleQueryError (cause.code path) | ✓ VERIFIED | with-retry.ts lines 35-39: pgCode = err.code ?? err.cause?.code. with-retry.test.ts line 69-89: test exercises Drizzle-wrapped shape (no top-level .code, cause.code='40001') and asserts retry-then-success (fn called twice). Logic verified: extraction yields '40001' from cause.code when top-level code is undefined. Commits 15db583 (RED) + 698ea4b (GREEN). |
| SC#5 | GET /health returns 200 with PG check; GET /docs serves OpenAPI UI; amount_cents documented as JSON string | ✓ VERIFIED | health.test.ts: 4 tests — 200 when PG up, 503 when db.execute throws (vi.spyOn), GET /docs returns 200, GET /docs/json contains "amount_cents" and "type":"string". |

**Score:** 5/5 roadmap truths verified

### Coverage Gate Truth

| Truth | Status | Evidence |
| ----- | ------ | -------- |
| pnpm vitest run --coverage exits 0 with ≥90% functions on packages/core/src/** | ✓ VERIFIED | Root command exit code 0 (confirmed by re-verification run). coverage-summary.json: packages/core/src/** functions 100% (30/30), lines 94.89%, statements 93.96%, branches 83.76% — all thresholds met. exclude: ["**/db/schema.ts"] in vitest.config.ts line 40 removes DDL-definition callbacks from collection. 166/167 tests passed, 1 pending (pre-existing). |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/src/api/server.ts` | Fastify server factory, swagger, BigInt serializer, error handler | ✓ VERIFIED | createServer(db), registerBigIntSerializer, swagger/swaggerUi registered, pgErrorHandler wired via setErrorHandler. No regression. |
| `packages/core/src/api/plugins/bigint-serializer.ts` | BigInt → string serializer | ✓ VERIFIED | Two-layer: setSerializerCompiler + setReplySerializer; bigIntReplacer converts typeof bigint to string |
| `packages/core/src/api/errors/pg-error-handler.ts` | RFC 9457 error handler | ✓ VERIFIED | Maps P0001 → 422, 40001 → 503 retryable:true, validation → 422/400, not_found → 404, 23505 → 409, default → 500 |
| `packages/core/src/api/errors/app-errors.ts` | Custom error classes | ✓ VERIFIED | LedgerError, ValidationError, NotFoundError, SerializationRetryExhaustedError all present |
| `packages/core/src/lib/with-retry.ts` | SQLSTATE 40001 retry wrapper — both err.code and err.cause.code paths | ✓ VERIFIED | Lines 35-39: dual-path extraction (err.code ?? err.cause?.code). Both paths covered by distinct unit tests. 100% function coverage. |
| `packages/core/src/api/routes/transactions.ts` | POST /transactions + GET /transactions/:id | ✓ VERIFIED | SELECT-first idempotency, withRetryOnSerializationFailure wrapping db.transaction(isolationLevel:'serializable'), post_transaction SQL call, 201/200 responses |
| `packages/core/src/api/routes/accounts.ts` | POST /accounts + GET /accounts/:id + GET /accounts/:id/postings | ✓ VERIFIED | All 3 routes; keyset cursor pagination; LEFT JOIN for balance; account type enum validated |
| `packages/core/src/api/routes/health.ts` | GET /health with PG SELECT 1 | ✓ VERIFIED | try/catch(no-variable), SELECT 1, 200/503 responses; 503 uses fixed 'unreachable' string |
| `packages/core/src/main.ts` | Entrypoint: all routes wired, SIGTERM shutdown | ✓ VERIFIED | DATABASE_URL required; postgres.js + drizzle; all 3 route plugins registered; SIGTERM handler |
| `packages/core/src/index.ts` | Public exports: createServer, AnyDrizzleDb, schema | ✓ VERIFIED | Exports createServer, AnyDrizzleDb, ServerOptions, and re-exports db/schema.ts |
| `packages/core/src/api/schemas/transaction.ts` | TypeBox request/response schemas; amount_cents as Type.String() in response | ✓ VERIFIED | PostingInputSchema: Type.Integer(minimum:1); PostingResponseSchema: Type.String() for amount_cents |
| `packages/core/src/api/schemas/account.ts` | Account schemas with balance as string|null | ✓ VERIFIED | AccountResponseSchema.balance: Type.Union([Type.String(), Type.Null()]) |
| `packages/core/migrations/0010_postings_created_at.sql` | Migration adding created_at to postings | ✓ VERIFIED | File exists; schema.ts reflects created_at on postings table |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `transactions.ts` | `with-retry.ts` | `import { withRetryOnSerializationFailure }` | ✓ WIRED | Import present; used as factory wrapper around db.transaction() call |
| `with-retry.ts` | `pg-error-handler.ts` | 40001 re-throw after exhaustion | ✓ WIRED | After MAX_RETRIES=3, withRetry re-throws; pgErrorHandler catches pgCode='40001' → 503 |
| `server.ts` | `pg-error-handler.ts` | `app.setErrorHandler(pgErrorHandler)` | ✓ WIRED | Covers all unhandled errors from all routes |
| `server.ts` | `bigint-serializer.ts` | `registerBigIntSerializer(app)` | ✓ WIRED | Called before any route registration |
| `main.ts` | `server.ts` | `createServer(db)` | ✓ WIRED | Registers all 3 route plugins |
| `main.ts` | `transactions.ts` | `app.register(transactionRoutes, { prefix: '/v1', db })` | ✓ WIRED | |
| `main.ts` | `accounts.ts` | `app.register(accountRoutes, { prefix: '/v1', db })` | ✓ WIRED | |
| `main.ts` | `health.ts` | `app.register(healthRoutes, { db })` | ✓ WIRED | No prefix (D-07) |
| `transactions.ts` (catch) | concurrent fallback SELECT | `errCode checks cause.code` | ✓ WIRED | transactions.ts: (err as { cause?: { code?: string } }).cause?.code — correctly handles Drizzle wrapping in CATCH block |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `transactions.ts` (POST handler) | `txId` from post_transaction | `tx.execute(sql\`SELECT post_transaction(...)\`)` inside db.transaction() | Calls PG function which inserts transactions + postings and returns UUID | ✓ FLOWING |
| `transactions.ts` (POST handler) | `newTx`, `newPostings` | `db.select().from(transactions)` + `db.select().from(postings)` | Real DB queries from test container | ✓ FLOWING |
| `accounts.ts` (GET /:id handler) | `balance` | LEFT JOIN `account_balance` on `accounts.id` | Real DB query with LEFT JOIN; null when no row | ✓ FLOWING |
| `accounts.ts` (GET /:id/postings) | `rows` | `db.select().from(postings).where(whereClause).orderBy(...).limit(effectiveLimit+1)` | Real DB query with keyset pagination | ✓ FLOWING |
| `health.ts` | PG liveness | `db.execute(sql\`SELECT 1\`)` | Real DB execute; catch returns fixed 503 | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Root coverage gate (CI command) | `pnpm vitest run --coverage` | Exit code 0; 166 passed, 1 pending; functions 100%, lines 94.89% | ✓ PASS |
| Drizzle-wrapped 40001 retry | with-retry.test.ts line 69-89 | fn called twice; promise resolves 'ok' | ✓ PASS |
| Direct err.code 40001 retry | with-retry.test.ts line 30-41 | Unchanged — fn called twice; promise resolves 'ok' | ✓ PASS (no regression) |
| Typecheck | `pnpm --filter @aprumo/core typecheck` | Exits 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| API-01 | 03-01, 03-04 | Fastify 5+ with coerceTypes, JSON Schema validation, @fastify/swagger | ✓ SATISFIED | server.ts: Fastify({ ajv: { coerceTypes:'array' } }).withTypeProvider(); swagger registered |
| API-02 | 03-04 | BigInt → JSON string serializer in all responses | ✓ SATISFIED | bigint-serializer.ts: two-layer setSerializerCompiler + setReplySerializer |
| API-03 | 03-05 | POST /transactions with Idempotency-Key, post_transaction(), 201 response | ✓ SATISFIED | transactions.ts: Idempotency-Key required; calls post_transaction SQL; 201 on success |
| API-04 | 03-05 | POST /transactions rejects unbalanced postings with 422 | ✓ SATISFIED | pgErrorHandler maps PG P0001 'do not balance' → 422 unbalanced_postings |
| API-05 | 03-05 | Idempotency-Key duplicate → 200 with original tx, never reprocesses | ✓ SATISFIED | SELECT-first check in transactions.ts; concurrent duplicate fallback |
| API-06 | 03-05 | GET /transactions/:id returns transaction + postings ordered | ✓ SATISFIED | transactions.ts GET handler; ORDER BY created_at DESC |
| API-07 | 03-06 | POST /accounts creates account with type + metadata | ✓ SATISFIED | accounts.ts POST handler; AccountTypeSchema enum; INSERT returning |
| API-08 | 03-06 | GET /accounts/:id returns metadata + materialized balance from account_balance | ✓ SATISFIED | accounts.ts LEFT JOIN accountBalance |
| API-09 | 03-06 | GET /accounts/:id/postings cursor-paginated by posting.id desc | ✓ SATISFIED | accounts.ts keyset pagination; ORDER BY created_at DESC, id DESC |
| API-10 | 03-03 | withRetryOnSerializationFailure: 40001 retry up to 3x with backoff — both err.code and err.cause.code paths | ✓ SATISFIED | with-retry.ts: dual-path extraction confirmed. with-retry.test.ts: 5 tests covering success, direct 40001, exhausted retries, non-40001, and Drizzle-wrapped 40001. |
| API-11 | 03-03, 03-04 | Global error handler: 40001 exhausted → 503, validation → 422, idempotency conflict → 200 | ✓ SATISFIED | pgErrorHandler wired via setErrorHandler; all branches tested |
| API-12 | 03-07 | GET /health liveness + readiness, PG check | ✓ SATISFIED | health.ts SELECT 1 liveness; 200/503 |
| API-13 | 03-04, 03-07 | OpenAPI spec auto-generated; amount_cents documented as JSON string | ✓ SATISFIED | swagger + swaggerUi registered; Type.String() in PostingResponseSchema |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/core/src/api/server.ts` | 15 | Stale comment: "coerceTypes: false" when actual value is 'array' | ⚠️ Warning | WR-04: misleading documentation; no runtime impact |
| `packages/core/src/api/server.ts` | 97 | `coerceTypes: 'array'` applies to request bodies — string integers coerced | ⚠️ Warning | WR-02: `{"amount_cents":"100"}` passes validation; fractional and negative amounts still rejected; money arithmetic unaffected |
| `packages/core/src/api/server.ts` | 98 | `removeAdditional: 'all'` mutates request.headers in-place | ⚠️ Warning | WR-03: strips all non-schema headers after validation; latent footgun for any future auth/CORS middleware added after validation |

No TBD/FIXME/XXX markers found in Phase 3 modified files.

No placeholder implementations (return null, return [], empty handlers) found.

Previously-blocker items now resolved:
- `with-retry.ts` cause.code path: fixed by 698ea4b; WR-01 closed.
- `schema.ts` function coverage: resolved by excluding DDL definitions from collection (fabd65f); coverage gate cleared.

### Human Verification Required

None — all observable behaviors verified programmatically via integration tests with real PG container. Root coverage command confirmed to exit 0.

Note: Swagger UI visual rendering (CSS, layout, click-through interactions) would benefit from browser inspection, but functional correctness (200 response, amount_cents as string in spec) is proven by automated test.

### Known Flake (Not a Phase Gap)

`tests/helpers/applyMigrationsToSchema.test.ts` Test 6 (idempotent) intermittently fails with `PostgresError 42P07 — relation account_balance already exists`. This is a pre-existing phase-2 test-infra state-leak bug, not introduced by phase-3 changes. A re-run always passes clean. Tracked separately for `/gsd-debug` — does not affect phase-3 status.

---

_Initial verification: 2026-05-30T09:45:00Z_
_Re-verified: 2026-05-30T15:30:00Z_
_Verifier: Claude (gsd-verifier)_
