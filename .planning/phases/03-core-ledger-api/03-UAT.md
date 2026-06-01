---
status: diagnosed
phase: 03-core-ledger-api
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md, 03-07-SUMMARY.md]
started: 2026-06-01T00:00:00Z
updated: 2026-06-01T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running server. Start fresh (`docker compose up -d postgres`, `pnpm db:migrate`, `pnpm --filter @aprumo/core dev`). Server boots without errors, listens on port 3000, GET /health returns {"status":"ok","postgres":"up"}.
result: pass
note: "Failed initially (DATABASE_URL not loaded + console.log(process.env) secret leak). Both fixed during UAT — dev script --env-file moved before script path; debug console.log removed. Re-verified: server boots, GET /health → 200 {status:ok,postgres:up}, no env dump in logs."

### 2. Create Transaction (POST /v1/transactions)
expected: POST /v1/transactions with header Idempotency-Key and body of 2+ balanced postings (SUM amount_cents with sign = 0) returns 201/200 with transaction id, ts, and postings array. amount_cents in response is a STRING not number.
result: [pending]

### 3. Idempotency Replay
expected: Repeat the exact same POST /v1/transactions with the SAME Idempotency-Key. Returns 200 OK with the same transaction (no duplicate created, no error).
result: [pending]

### 4. Unbalanced Postings Rejected
expected: POST /v1/transactions where postings do NOT sum to zero returns 422 application/problem+json with code "unbalanced_postings". No transaction persisted.
result: [pending]

### 5. Get Transaction (GET /v1/transactions/:id)
expected: GET /v1/transactions/{id} for an existing tx returns 200 with transaction + postings (ordered created_at DESC), amount_cents as strings. Unknown id returns 404 problem+json code "not_found". Non-UUID id returns 400.
result: pass
note: "Live-verified: known tx → 200; unknown uuid → 404 not_found; non-uuid → 400; missing Idempotency-Key on POST → 400."

### 6. Create Account (POST /v1/accounts)
expected: POST /v1/accounts with type in (asset|liability|revenue|expense|equity) + owner_ref returns 201/200 with account id. balance is null (balance worker is Phase 4). Invalid type rejected 422.
result: pass
note: "Live-verified: asset + revenue accounts created 201, balance:null; type 'bogus' → 422."

### 7. Get Account (GET /v1/accounts/:id)
expected: GET /v1/accounts/{id} returns 200 with account fields; balance null until worker runs. Unknown id → 404.
result: pass
note: "Live-verified: known account → 200 balance:null; unknown uuid → 404."

### 8. Postings Pagination (GET /v1/accounts/:id/postings)
expected: With several postings on an account, GET /v1/accounts/{id}/postings?limit=2 returns 2 items + non-null next_cursor. Passing that cursor returns the next page with no overlap; last page has next_cursor null. limit > 200 rejected 422. Bad cursor → 400 invalid_cursor.
result: issue
reported: "page 2 (valid next_cursor from page 1) returns HTTP 500 internal_error; live verified against postgres-js production driver"
severity: blocker

### 9. Health Check (GET /health)
expected: GET /health returns 200 {"status":"ok","postgres":"up"} when PG reachable. (503 unreachable path is unit-tested via stub.)
result: pass
note: "Live-verified during cold-start: GET /health → 200 {status:ok,postgres:up}."

### 10. OpenAPI Docs (GET /docs)
expected: GET /docs serves swagger UI (status < 400). GET /docs/json contains amount_cents declared as type "string" (API-13).
result: pass
note: "Live-verified: /docs → 200; /docs/json has amount_cents type:string (response) and type:integer (request input). API-13 satisfied."

### 11. BigInt Precision (amount_cents > MAX_SAFE_INTEGER)
expected: A transaction with amount_cents 9007199254740993 (> 2^53) is returned in responses as the exact decimal STRING "9007199254740993" — no rounding/precision loss.
result: pass
note: "Seeded via post_transaction (JSON body can't carry value precisely). API GET returned amount_cents:\"9007199254740993\" exact. No precision loss."

## Summary

total: 11
passed: 10
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "`pnpm --filter @aprumo/core dev` boots the server with DATABASE_URL loaded from root .env"
  status: resolved
  reason: "User reported: got `Error: DATABASE_URL environment variable is required` even with DATABASE_URL in .env. FIXED during UAT."
  severity: blocker
  test: 1
  root_cause: "dev script in packages/core/package.json has --env-file AFTER the script path (`tsx watch src/main.ts --env-file=../../.env`). tsx only loads --env-file when it precedes the script; placed after, it becomes an argv passed to main.ts and is ignored, so .env never loads. db:migrate/db:reset have correct order (flag before script) which is why they work."
  artifacts:
    - path: "packages/core/package.json"
      issue: "dev script: --env-file after script path; should be `tsx watch --env-file=../../.env src/main.ts`"
  missing:
    - "Move --env-file=../../.env before src/main.ts in dev script"
  debug_session: ""

- truth: "main.ts never logs the DATABASE_URL value (T-03-07b, Invariant #8)"
  status: resolved
  reason: "Found incidentally during diagnosis: console.log(process.env) at main.ts:34 prints entire env including DATABASE_URL secret. FIXED during UAT (line removed)."
  severity: blocker
  test: 1
  root_cause: "Left-in debug statement `console.log(process.env)` at main.ts:34 dumps full environment, leaking the DATABASE_URL connection string (with credentials) to stdout. Violates CLAUDE.md Invariant #8 / threat T-03-07b which the 03-07 SUMMARY claims is enforced (value never logged)."
  artifacts:
    - path: "packages/core/src/main.ts"
      issue: "line 34: console.log(process.env) — secret leak, remove"
  missing:
    - "Remove console.log(process.env) from main.ts"
  debug_session: ""

- truth: "GET /v1/accounts/:id/postings page 2 (using next_cursor from page 1) returns the next page of postings (API-09 cursor pagination)"
  status: failed
  reason: "User-flow live test: page 2 with a valid next_cursor returns HTTP 500 internal_error instead of the next page"
  severity: blocker
  test: 8
  root_cause: "accounts.ts:256 builds the keyset WHERE with `${new Date(cursorPayload.created_at)}` bound as a raw Drizzle sql template parameter. The postgres-js driver (production driver wired in main.ts via drizzle-orm/postgres-js) rejects a JS Date object as a query parameter: `ERR_INVALID_ARG_TYPE: The \"string\" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`. The 03-06 integration tests pass because they inject a node-postgres (pg.Pool) db via AnyDrizzleDb — node-postgres DOES serialize Date params, postgres-js does NOT. Driver-mismatch: tests exercise a different driver than production. Confirmed by isolated repro running the exact query through drizzle-orm/postgres-js. Page 1 (no cursor) works because it has no keyset clause and binds no Date."
  artifacts:
    - path: "packages/core/src/api/routes/accounts.ts"
      issue: "line 256: `${new Date(cursorPayload.created_at)}` bound as raw sql param — postgres-js rejects Date. Bind the ISO string (cursorPayload.created_at) instead; PG casts to timestamptz. Works on both drivers."
    - path: "packages/core/src/api/routes/accounts.test.ts"
      issue: "Coverage gap: pagination integration tests run only against node-postgres, never postgres-js (the production driver). The entire Date-param failure class is invisible to the suite. Add a pagination test that exercises the postgres-js path (or bind driver-agnostic values)."
  missing:
    - "Bind ISO string instead of Date in keyset sql template (accounts.ts:256)"
    - "Add failing test reproducing the postgres-js Date-param 500, then fix (TDD RED→GREEN)"
    - "Cover the postgres-js driver in accounts pagination tests so prod-driver regressions are caught"
  debug_session: ""

- truth: "Keyset cursor tiebreaker (created_at = X AND id < Y) is robust against same-timestamp collisions (D-04)"
  status: failed
  reason: "Secondary finding surfaced during diagnosis (not user-reported): cursor + Drizzle row hydration truncate created_at to millisecond precision, but postings.created_at is timestamptz with microsecond precision"
  severity: minor
  test: 8
  root_cause: "encodeCursor uses Date.toISOString() (millisecond precision) and Drizzle hydrates created_at into a JS Date (also ms). The DB stores microseconds (e.g. .258388). The keyset `created_at = $cursorMs` equality branch can never match the actual µs-precision row, so the id tiebreaker is effectively dead. Two postings sharing the same millisecond but differing in microseconds can be silently skipped at a page boundary. Low probability at v0.1 volume but a latent correctness bug in an append-only ledger listing."
  artifacts:
    - path: "packages/core/src/api/routes/accounts.ts"
      issue: "encodeCursor/decodeCursor lose sub-millisecond precision; keyset tiebreaker unreliable across same-ms inserts"
  missing:
    - "Carry full timestamp precision in the cursor (e.g. epoch microseconds or raw PG timestamp string) so the (created_at, id) keyset tiebreaker actually fires"
    - "Add a test: 2+ postings in the same millisecond, paginate limit=1 across them, assert no skip/duplicate"
  debug_session: ""
