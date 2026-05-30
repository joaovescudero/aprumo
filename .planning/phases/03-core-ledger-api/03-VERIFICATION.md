---
phase: 03-core-ledger-api
verified: 2026-05-30T09:45:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified
overrides_applied: 0
gap_closure_applied: 2026-05-30
gap_closure_status: resolved
gaps:
  - truth: "Coverage gate: pnpm vitest run --coverage exits 0 with ≥90% functions on packages/core/src/**"
    status: resolved
    resolved_at: "2026-05-30"
    resolved_by: "fabd65f — fix(03): exclude declarative Drizzle schema from coverage functions gate"
    resolution: "Added exclude: ['**/db/schema.ts'] to root vitest.config.ts coverage block. Declarative DDL callbacks in schema.ts removed from coverage collection. Root pnpm vitest run --coverage now exits 0."
    reason: "Root coverage run (which CI uses) reports 76.92% function coverage for packages/core/src/** against a 90% threshold — exits with ERROR. The SUMMARY ran --filter @aprumo/core which silently ignores the threshold in workspace mode (per vitest.config.ts comment). The actual threshold gate in CI uses `pnpm vitest run --coverage` from root. Root cause: schema.ts has 0% function coverage because v8 counts pgTable callback arrow functions as uncovered (10 uncovered functions across rawEvents, accountBalance, outboundEndpoints, outboundEvents tables); these are pre-existing from Phase 2 but Phase 3 did not remediate them and the API additions were not enough to lift the ratio above 90%."
    artifacts:
      - path: "packages/core/src/db/schema.ts"
        issue: "0% function coverage (0/~10 Drizzle pgTable callback functions covered by v8)"
      - path: "vitest.config.ts"
        issue: "packages/core/src/** threshold requires functions: 90; actual 76.92%"
    missing:
      - "Either: configure vitest coverage to exclude schema.ts (it contains Drizzle static definitions, not logic) from the function coverage threshold; OR add tests that exercise the remaining outbound/account_balance table definitions; OR reduce the functions threshold to reflect Drizzle schema files are infrastructure, not application logic."
  - truth: "withRetryOnSerializationFailure detects SQLSTATE 40001 through Drizzle's DrizzleQueryError wrapper (cause.code path)"
    status: resolved
    resolved_at: "2026-05-30"
    resolved_by: "698ea4b — fix(03): retry on Drizzle-wrapped serialization failure (err.cause.code); test: 15db583"
    resolution: "Updated pgCode extraction in with-retry.ts to check err.cause?.code in addition to err.code. Added unit test for Drizzle-wrapped shape (RED: 15db583, GREEN: 698ea4b)."
    reason: "WR-01 (code review): with-retry.ts line 33-36 reads err.code directly but not err.cause.code. When Drizzle's DrizzleQueryError wraps a real PG 40001 (e.g. intra-transaction query failure), the code is on cause.code, not err.code — so the retry condition is not triggered and the error is re-thrown immediately. The SC#4 test (transactions.test.ts:265) injects Error({ code: '40001' }) directly at db.transaction level, bypassing Drizzle wrapping, so the test passes without proving the real path. The pgErrorHandler correctly handles both err.code and err.cause.code (line 160), and the catch block in transactions.ts (line 193) also handles cause.code — but with-retry.ts itself does not. Mitigating factor: for postgres-js (production driver), COMMIT-level 40001 propagates as native PostgresError with direct code property, so the most common production path works. The gap is intra-transaction 40001 failures."
    artifacts:
      - path: "packages/core/src/lib/with-retry.ts"
        issue: "Lines 33-36: pgCode extraction reads only err.code, not err.cause?.code — Drizzle-wrapped 40001 errors skip retry"
      - path: "packages/core/src/api/routes/transactions.test.ts"
        issue: "Line 273: SC#4 test mock injects err.code='40001' directly, bypassing Drizzle wrapping — does not prove production path"
    missing:
      - "Fix with-retry.ts lines 33-36 to read: const pgCode = typeof err === 'object' && err !== null ? ((err as { code?: unknown }).code ?? (err as { cause?: { code?: unknown } }).cause?.code) : undefined;"
      - "Add or annotate test to clarify the mock bypasses Drizzle; optionally add a separate integration test injecting a real 40001 via concurrent SQL to validate the cause.code path."
---

# Phase 03: Core Ledger API Verification Report

**Phase Goal:** Core Ledger API — Fastify REST endpoints for transactions/accounts/postings, post_transaction function integration, idempotency, serialization-failure (40001) retry, BigInt-as-string serializer, RFC 9457 error handling, /health, swagger /docs.
**Verified:** 2026-05-30T09:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC#1 | POST /transactions with balanced postings returns 201; amount_cents in JSON response is a string (not a number) | ✓ VERIFIED | transactions.test.ts:80-103 asserts 201 + `typeof amount_cents === 'string'`; BigInt serializer in bigint-serializer.ts uses JSON.stringify replacer; PostingResponseSchema declares Type.String() for amount_cents; test suite passes (103 passed) |
| SC#2 | POST /transactions with same Idempotency-Key sent twice concurrently (Promise.all) resolves both — no 409 or 500 | ✓ VERIFIED | transactions.test.ts:135-157 uses Promise.all([injectRequest(), injectRequest()]) and asserts both get [200,201] with same transaction id. Note: ROADMAP says "200 both times" but test correctly allows one 201 (winner) and one 200 (loser) — the intent (no error on duplicate) is met. |
| SC#3 | POST /transactions with unbalanced postings returns 422 with code=unbalanced_postings | ✓ VERIFIED | transactions.test.ts:159-183 asserts 422 + parsed.code === 'unbalanced_postings' + Content-Type: application/problem+json; pgErrorHandler maps P0001 containing 'do not balance' to 422; post_transaction() PG function performs the double-entry constraint check |
| SC#4 | withRetryOnSerializationFailure wrapper retries entire db.transaction() on SQLSTATE 40001 — verified by mocking serialization_failure on first attempt | ✗ FAILED | See gap 2: test at transactions.test.ts:265 proves wiring (db.transaction spy with direct { code: '40001' }) but with-retry.ts does NOT check err.cause.code, so a real Drizzle-wrapped DrizzleQueryError with cause.code='40001' would skip retry and throw immediately. Production COMMIT-level 40001 works (postgres-js native PostgresError has code directly), but intra-transaction 40001 and all node-postgres (test driver) paths skip retry. |
| SC#5 | GET /health returns 200 with PG check; GET /docs serves OpenAPI UI; amount_cents documented as JSON string | ✓ VERIFIED | health.test.ts: 4 tests all pass — 200 when PG up, 503 when db.execute throws (vi.spyOn), GET /docs returns 200, GET /docs/json contains "amount_cents" and "type":"string". health.ts implements try/catch(no-variable) pattern, returns fixed 'unreachable' on 503. |

**Score:** 4/5 roadmap truths verified (SC#4 failed)

### Coverage Gate Truth

| Truth | Status | Evidence |
| ----- | ------ | -------- |
| pnpm vitest run --coverage exits 0 with ≥90% LoC on @aprumo/core | ✗ FAILED (BLOCKER) | Root run produces: "ERROR: Coverage for functions (76.92%) does not meet 'packages/core/src/**' threshold (90%)". Lines: 91.34% (passes), Statements: 90.17% (passes), Branches: 75.4% (passes 80% threshold), Functions: 76.92% (FAILS 90% threshold). The SUMMARY ran `--filter @aprumo/core` which silently ignores root-level thresholds. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/core/src/api/server.ts` | Fastify server factory, swagger, BigInt serializer, error handler | ✓ VERIFIED | createServer(db), registerBigIntSerializer, swagger/swaggerUi registered, pgErrorHandler wired via setErrorHandler |
| `packages/core/src/api/plugins/bigint-serializer.ts` | BigInt → string serializer | ✓ VERIFIED | Two-layer: setSerializerCompiler + setReplySerializer; bigIntReplacer converts typeof bigint to string |
| `packages/core/src/api/errors/pg-error-handler.ts` | RFC 9457 error handler | ✓ VERIFIED | Maps P0001 → 422, 40001 → 503 retryable:true, validation → 422/400, not_found → 404, 23505 → 409, default → 500 (no internals) |
| `packages/core/src/api/errors/app-errors.ts` | Custom error classes | ✓ VERIFIED | LedgerError, ValidationError, NotFoundError, SerializationRetryExhaustedError all present |
| `packages/core/src/lib/with-retry.ts` | SQLSTATE 40001 retry wrapper | ⚠️ PARTIAL | Exists, substantive, wired — but only checks err.code, not err.cause.code (WR-01 gap) |
| `packages/core/src/api/routes/transactions.ts` | POST /transactions + GET /transactions/:id | ✓ VERIFIED | SELECT-first idempotency, withRetryOnSerializationFailure wrapping db.transaction(isolationLevel:'serializable'), post_transaction SQL call, 201/200 responses |
| `packages/core/src/api/routes/accounts.ts` | POST /accounts + GET /accounts/:id + GET /accounts/:id/postings | ✓ VERIFIED | All 3 routes implemented; keyset cursor pagination; LEFT JOIN for balance; account type enum validated |
| `packages/core/src/api/routes/health.ts` | GET /health with PG SELECT 1 | ✓ VERIFIED | try/catch(no-variable), SELECT 1, 200/503 responses; 503 uses fixed 'unreachable' string |
| `packages/core/src/main.ts` | Entrypoint: all routes wired, SIGTERM shutdown | ✓ VERIFIED | DATABASE_URL required; postgres.js + drizzle; all 3 route plugins registered; SIGTERM handler closes app + pgClient |
| `packages/core/src/index.ts` | Public exports: createServer, AnyDrizzleDb, schema | ✓ VERIFIED | Exports createServer, AnyDrizzleDb, ServerOptions, and re-exports db/schema.ts |
| `packages/core/src/api/schemas/transaction.ts` | TypeBox request/response schemas; amount_cents as Type.String() in response | ✓ VERIFIED | PostingInputSchema: Type.Integer(minimum:1); PostingResponseSchema: Type.String() for amount_cents |
| `packages/core/src/api/schemas/account.ts` | Account schemas with balance as string|null | ✓ VERIFIED | AccountResponseSchema.balance: Type.Union([Type.String(), Type.Null()]) |
| `packages/core/migrations/0010_postings_created_at.sql` | Migration adding created_at to postings | ✓ VERIFIED | File exists; schema.ts reflects created_at on postings table |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `transactions.ts` | `with-retry.ts` | `import { withRetryOnSerializationFailure }` | ✓ WIRED | Line 24: import present; line 150: used as factory wrapper around db.transaction() call |
| `with-retry.ts` | `pg-error-handler.ts` | 40001 re-throw after exhaustion | ✓ WIRED | After MAX_RETRIES=3, withRetry re-throws; pgErrorHandler catches pgCode='40001' → 503 |
| `server.ts` | `pg-error-handler.ts` | `app.setErrorHandler(pgErrorHandler)` | ✓ WIRED | server.ts line 125; covers all unhandled errors from all routes |
| `server.ts` | `bigint-serializer.ts` | `registerBigIntSerializer(app)` | ✓ WIRED | server.ts line 106; called before any route registration |
| `main.ts` | `server.ts` | `createServer(db)` | ✓ WIRED | main.ts imports and calls createServer; registers all 3 route plugins |
| `main.ts` | `transactions.ts` | `app.register(transactionRoutes, { prefix: '/v1', db })` | ✓ WIRED | main.ts line 53 |
| `main.ts` | `accounts.ts` | `app.register(accountRoutes, { prefix: '/v1', db })` | ✓ WIRED | main.ts line 54 |
| `main.ts` | `health.ts` | `app.register(healthRoutes, { db })` | ✓ WIRED | main.ts line 55 (no prefix — at root per D-07) |
| `transactions.ts` (catch) | concurrent fallback SELECT | `errCode checks cause.code` | ✓ WIRED | transactions.ts line 193: `(err as { cause?: { code?: string } }).cause?.code` — correctly handles Drizzle wrapping in the CATCH block (unlike with-retry.ts itself) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `transactions.ts` (POST handler) | `txId` from post_transaction | `tx.execute(sql\`SELECT post_transaction(...)\`)` inside db.transaction() | Calls PG function which inserts transactions + postings and returns UUID | ✓ FLOWING |
| `transactions.ts` (POST handler) | `newTx`, `newPostings` | `db.select().from(transactions)` + `db.select().from(postings)` | Real DB queries from test container | ✓ FLOWING |
| `accounts.ts` (GET /:id handler) | `balance` | LEFT JOIN `account_balance` on `accounts.id` | Real DB query with LEFT JOIN; null when no row | ✓ FLOWING |
| `accounts.ts` (GET /:id/postings) | `rows` | `db.select().from(postings).where(whereClause).orderBy(...).limit(effectiveLimit+1)` | Real DB query with keyset pagination | ✓ FLOWING |
| `health.ts` | PG liveness | `db.execute(sql\`SELECT 1\`)` | Real DB execute; catch returns fixed 503 | ✓ FLOWING |

### Behavioral Spot-Checks

All checks done via Vitest test suite (integration tests against real PG container):

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Full test suite | `pnpm --filter @aprumo/core test --run` | 103 passed, 1 skipped | ✓ PASS |
| Coverage (lines) | `pnpm vitest run --coverage` | Lines 91.34%, Statements 90.17% | ✓ PASS |
| Coverage (functions) | `pnpm vitest run --coverage` | Functions 76.92% vs threshold 90% | ✗ FAIL — BLOCKER |
| Typecheck | `pnpm --filter @aprumo/core typecheck` | Exits 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| API-01 | 03-01, 03-04 | Fastify 5+ with coerceTypes, JSON Schema validation, @fastify/swagger | ✓ SATISFIED | server.ts: Fastify({ ajv: { coerceTypes:'array' } }).withTypeProvider(); swagger registered |
| API-02 | 03-04 | BigInt → JSON string serializer in all responses | ✓ SATISFIED | bigint-serializer.ts: two-layer setSerializerCompiler + setReplySerializer; tested in SC#1 and BigInt boundary test |
| API-03 | 03-05 | POST /transactions with Idempotency-Key, post_transaction(), 201 response | ✓ SATISFIED | transactions.ts: Idempotency-Key required in PostTransactionHeadersSchema; calls post_transaction SQL; 201 on success |
| API-04 | 03-05 | POST /transactions rejects unbalanced postings with 422 | ✓ SATISFIED | pgErrorHandler maps PG P0001 'do not balance' → 422 unbalanced_postings; tested in SC#3 |
| API-05 | 03-05 | Idempotency-Key duplicate → 200 with original tx, never reprocesses | ✓ SATISFIED | SELECT-first check in transactions.ts; concurrent duplicate fallback; tested in SC#2 |
| API-06 | 03-05 | GET /transactions/:id returns transaction + postings ordered | ✓ SATISFIED | transactions.ts GET handler; ORDER BY created_at DESC; tested in transactions.test.ts |
| API-07 | 03-06 | POST /accounts creates account with type + metadata | ✓ SATISFIED | accounts.ts POST handler; AccountTypeSchema enum; accounts.ts INSERT returning |
| API-08 | 03-06 | GET /accounts/:id returns metadata + materialized balance from account_balance | ✓ SATISFIED | accounts.ts LEFT JOIN accountBalance; balance null when no row; tested in accounts.test.ts |
| API-09 | 03-06 | GET /accounts/:id/postings cursor-paginated by posting.id desc | ✓ SATISFIED | accounts.ts keyset pagination; ORDER BY created_at DESC, id DESC; cursor base64url encode/decode |
| API-10 | 03-03 | withRetryOnSerializationFailure: 40001 retry up to 3x with backoff | ⚠️ PARTIAL | Retry wiring verified for direct err.code path; WR-01: err.cause.code path (Drizzle wrapping) not handled in with-retry.ts — production postgres-js COMMIT-level 40001 works, intra-transaction does not |
| API-11 | 03-03, 03-04 | Global error handler: 40001 exhausted → 503, validation → 422, idempotency conflict → 200 | ✓ SATISFIED | pgErrorHandler wired via setErrorHandler; all branches tested in pg-error-handler.test.ts |
| API-12 | 03-07 | GET /health liveness + readiness, PG check | ✓ SATISFIED | health.ts SELECT 1 liveness; 200/503; tested in health.test.ts |
| API-13 | 03-04, 03-07 | OpenAPI spec auto-generated; amount_cents documented as JSON string | ✓ SATISFIED | swagger + swaggerUi registered; Type.String() in PostingResponseSchema; health.test.ts asserts /docs/json contains "amount_cents" and "type":"string" |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/core/src/api/server.ts` | 15 | Stale comment: "coerceTypes: false" when actual value is 'array' | ⚠️ Warning | WR-04: misleading documentation; no runtime impact |
| `packages/core/src/api/server.ts` | 97 | `coerceTypes: 'array'` applies to request bodies — string integers coerced | ⚠️ Warning | WR-02: `{"amount_cents":"100"}` passes validation; fractional and negative amounts still rejected; money arithmetic unaffected |
| `packages/core/src/api/server.ts` | 98 | `removeAdditional: 'all'` mutates request.headers in-place | ⚠️ Warning | WR-03: strips all non-schema headers after validation; latent footgun for any future auth/CORS middleware added after validation |
| `packages/core/src/lib/with-retry.ts` | 33-36 | Only checks `err.code`, not `err.cause?.code` | 🛑 Blocker | WR-01: Drizzle-wrapped DrizzleQueryError skips retry; intra-transaction 40001 not retried |
| `packages/core/src/db/schema.ts` | multiple | 0% function coverage for pgTable callbacks | 🛑 Blocker | Causes functions threshold failure in root coverage run (76.92% < 90%) |

No TBD/FIXME/XXX markers found in Phase 3 modified files.

No placeholder implementations (return null, return [], empty handlers) found.

### Human Verification Required

None — all observable behaviors verified programmatically via integration tests with real PG container.

Note: Swagger UI visual rendering (CSS, layout, click-through interactions) would benefit from browser inspection, but functional correctness (200 response, amount_cents as string in spec) is proven by automated test.

### Gaps Summary

Two blockers prevent goal achievement:

**Blocker 1 — Coverage gate failure (functions: 76.92% < 90%)**

The phase SUMMARY reported the coverage gate as passed (90.14% lines) by running `pnpm --filter @aprumo/core test --coverage`. However, per the comment in `vitest.config.ts`: "per-project coverage is silently ignored in workspace mode" — the threshold enforcement only works in the root `pnpm vitest run --coverage`. The CI `coverage-gate` job runs the root command, which fails with `ERROR: Coverage for functions (76.92%) does not meet "packages/core/src/**" threshold (90%)`.

Root cause: `packages/core/src/db/schema.ts` has 0% function coverage because v8 counts the 9 Drizzle pgTable callback arrow functions `(table) => [...]` as uncovered (they execute at module import time during schema definition, not during test scenarios that explicitly use those tables). The rawEvents, accountBalance, outboundEndpoints, and outboundEvents table definitions are imported but not exercised in Phase 3 tests. Adding Phase 3 API files (all at 100% functions) was not enough to lift the ratio above 90%.

Remediation options (any one sufficient):
1. Exclude `src/db/schema.ts` from the functions threshold (it is infrastructure, not logic).
2. Add schema coverage tests that instantiate queries against the uncovered tables.
3. Lower the functions threshold to reflect the Drizzle schema file pattern.

**Blocker 2 — with-retry.ts does not detect Drizzle-wrapped 40001 errors (WR-01)**

`withRetryOnSerializationFailure` reads only `err.code`, not `err.cause?.code`. When Drizzle's `DrizzleQueryError` wraps a PG `DatabaseError`, the SQLSTATE `40001` is on `cause.code`, not `code`. Intra-transaction query failures are silently re-thrown without retry.

The SC#4 test at `transactions.test.ts:265` bypasses this by injecting `new Error({ code: '40001' })` directly at the `db.transaction` spy level — it proves retry wiring but not the Drizzle-wrapped path. In contrast, `pgErrorHandler` and the catch block in `transactions.ts` correctly handle `cause.code`.

Mitigating factor: for the production postgres-js driver, COMMIT-level `40001` arrives as a native `PostgresError` with `code` directly accessible — so the most common production path (serialization conflict at COMMIT) still works. The unhandled path is intra-transaction query-level 40001 failures.

The fix is one line in `with-retry.ts` lines 33-36 (see code review WR-01 for the exact replacement).

---

_Verified: 2026-05-30T09:45:00Z_
_Verifier: Claude (gsd-verifier)_
