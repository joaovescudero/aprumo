---
status: complete
phase: 03-core-ledger-api
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md, 03-07-SUMMARY.md]
started: 2026-06-01T00:00:00Z
updated: 2026-06-01T00:00:00Z
note: "Re-run requested by user (prior session was not hand-tested). 3 code fixes from prior diagnosis already committed: dev --env-file order, console.log(process.env) removal, postgres-js cursor Date-param + µs precision."
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Stop any running server. Start fresh (`docker compose up -d postgres`, `pnpm db:migrate`, `pnpm --filter @aprumo/core dev`). Server boots without errors, listens on port 3000, GET /health returns {"status":"ok","postgres":"up"}. No env dump / secrets in logs.
result: pass

### 2. Create Transaction (POST /v1/transactions)
expected: POST /v1/transactions with header Idempotency-Key and body of 2+ postings. amount_cents is a POSITIVE integer (minimum 1); the `direction` (debit/credit) carries the sign — server computes balance from direction. Returns 201 with transaction id, ts, postings array. amount_cents in response is a STRING not number.
result: pass
note: "Live-verified: debit 1000 / credit 1000 (both positive) → 201, amount_cents:\"1000\" as string, tx fb183245. NB: amount_cents must be positive (Integer minimum:1); negative values 422 by design — sign comes from direction, not the number."

### 3. Idempotency Replay
expected: Repeat the exact same POST /v1/transactions with the SAME Idempotency-Key. Returns 200 OK with the same transaction (no duplicate created, no error).
result: pass

### 4. Unbalanced Postings Rejected
expected: POST /v1/transactions where postings do NOT sum to zero returns 422 application/problem+json with code "unbalanced_postings". No transaction persisted.
result: pass

### 5. Get Transaction (GET /v1/transactions/:id)
expected: GET /v1/transactions/{id} for an existing tx returns 200 with transaction + postings (ordered created_at DESC), amount_cents as strings. Unknown id returns 404 problem+json code "not_found". Non-UUID id returns 400.
result: pass

### 6. Create Account (POST /v1/accounts)
expected: POST /v1/accounts with type in (asset|liability|revenue|expense|equity) + owner_ref returns 201/200 with account id. balance is null (balance worker is Phase 4). Invalid type rejected 422.
result: pass

### 7. Get Account (GET /v1/accounts/:id)
expected: GET /v1/accounts/{id} returns 200 with account fields; balance null until worker runs. Unknown id → 404.
result: pass

### 8. Postings Pagination (GET /v1/accounts/:id/postings)
expected: With several postings on an account, GET /v1/accounts/{id}/postings?limit=2 returns 2 items + non-null next_cursor. Passing that cursor returns the next page with no overlap; last page has next_cursor null. limit > 200 rejected 422. Bad cursor → 400 invalid_cursor.
result: pass
note: "Re-verified after prior page-2 500 fix (postgres-js cursor Date-param). Page 2 with valid cursor → 200, no overlap; limit=201 → 422; bad cursor → 400."

### 9. Health Check (GET /health)
expected: GET /health returns 200 {"status":"ok","postgres":"up"} when PG reachable. (503 unreachable path is unit-tested via stub.)
result: pass

### 10. OpenAPI Docs (GET /docs)
expected: GET /docs serves swagger UI (status < 400). GET /docs/json contains amount_cents declared as type "string" (API-13).
result: pass

### 11. BigInt Precision (amount_cents > MAX_SAFE_INTEGER)
expected: A transaction with amount_cents 9007199254740993 (> 2^53) is returned in responses as the exact decimal STRING "9007199254740993" — no rounding/precision loss.
result: pass
note: "Seeded via post_transaction SQL (tx c36b9cd7) — JSON POST body can't carry >2^53 precisely. API GET returned amount_cents:\"9007199254740993\" exact on both postings. No precision loss."

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
