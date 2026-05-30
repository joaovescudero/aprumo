---
phase: 03-core-ledger-api
plan: "06"
subsystem: api
tags:
  - accounts
  - cursor-pagination
  - tdd
  - bigint
  - fastify
dependency_graph:
  requires:
    - 03-05  # transactionRoutes pattern, pgErrorHandler, server factory
    - 03-04  # TypeBox schemas, BigInt serializer, AnyDrizzleDb
    - 03-03  # pgErrorHandler (extended in this plan)
  provides:
    - accountRoutes plugin (POST /v1/accounts, GET /v1/accounts/:id, GET /v1/accounts/:id/postings)
    - invalid_cursor error case in pgErrorHandler
  affects:
    - packages/core/src/api/server.ts (coerceTypes fix for querystring integers)
    - packages/core/src/api/errors/pg-error-handler.ts (invalid_cursor → 400)
tech_stack:
  added: []
  patterns:
    - Keyset cursor pagination (created_at DESC + id DESC tiebreaker)
    - Opaque base64url cursor encoding (D-05)
    - Limit+1 pattern for next_cursor detection
    - Throw-with-code pattern for non-schema HTTP errors (pgErrorHandler delegation)
key_files:
  created:
    - packages/core/src/api/routes/accounts.ts
    - packages/core/src/api/routes/accounts.test.ts
  modified:
    - packages/core/src/api/errors/pg-error-handler.ts
    - packages/core/src/api/server.ts
decisions:
  - "D-06 limit enforcement via Ajv maximum:200 requires coerceTypes:'array' (not false) since querystrings are always strings at the HTTP layer"
  - "invalid_cursor error routing via throw+pgErrorHandler (same pattern as not_found) — avoids TypeScript error from reply.status(400) when schema only declares 200"
metrics:
  duration: "7m 26s"
  completed_date: "2026-05-30"
  tasks: 2
  files: 4
---

# Phase 3 Plan 06: Accounts Routes + Cursor Pagination Summary

Account management and posting pagination routes with full TDD cycle. Implements cursor-paginated GET /v1/accounts/:id/postings using an opaque base64url (created_at, id) keyset cursor ordered by created_at DESC + id DESC.

## What Was Built

- `accounts.ts` — FastifyPluginAsync with POST /accounts, GET /accounts/:id, GET /accounts/:id/postings
- `accounts.test.ts` — 10 integration tests (RED before GREEN), exercising all D-04/D-05/D-06 decisions
- `pgErrorHandler` extended: added `invalid_cursor` → 400 case (T-03-06a)
- `server.ts` patched: `coerceTypes: false` → `'array'` to enable querystring integer coercion (D-06)

## TDD Gate Compliance

- RED commit `77227c7`: test(03-06) — 10 failing tests, `accounts.ts` did not exist
- GREEN commit `a1c52f9`: feat(03-06) — all 10 tests pass; typecheck passes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `coerceTypes: false` broke querystring integer validation**
- **Found during:** Task 2 GREEN cycle
- **Issue:** Fastify's `coerceTypes: false` prevents HTTP query string values (always strings) from being validated as `Type.Integer()`. `?limit=2` → string `"2"` failed integer validation → 422 before handler ran. Both `limit=2` (valid) and `limit=201` (over-max) returned 422 for the same wrong reason.
- **Fix:** Changed `coerceTypes: false` to `coerceTypes: 'array'` in server.ts ajv config. `'array'` coerces scalars (string → integer) but not arrays-to-scalars, preserving the original security intent while enabling standard querystring behavior. Updated comment to document D-06 rationale.
- **Files modified:** `packages/core/src/api/server.ts`
- **Impact:** None on existing tests (all 99 still pass). The fix is additive — enables querystring integer coercion that was already expected by the plan.

**2. [Rule 2 - Missing critical functionality] `invalid_cursor` error case not in pgErrorHandler**
- **Found during:** Task 2 GREEN cycle (TypeScript typecheck)
- **Issue:** Route handler threw `{ code: 'invalid_cursor' }` but pgErrorHandler had no case for it — would fall through to 500. T-03-06a threat mitigation requires decode failures to return 400, not 500.
- **Fix:** Added explicit `pgCode === 'invalid_cursor'` case to pgErrorHandler returning 400 problem+json. Also changed handler to use throw pattern (same as not_found) instead of `reply.status(400).send()` which TypeBox type provider rejects when schema only declares 200.
- **Files modified:** `packages/core/src/api/errors/pg-error-handler.ts`
- **Commit:** `a1c52f9`

**3. [Rule 1 - Bug] `"base64url"` not in TypeScript `BufferEncoding` union**
- **Found during:** Task 2 typecheck
- **Issue:** `Buffer.from(cursor, "base64url")` — TypeScript's `@types/node` version does not include `"base64url"` in `BufferEncoding`. Runtime supports it (Node 18+).
- **Fix:** Cast to `"base64url" as BufferEncoding` with explanatory comment.
- **Files modified:** `packages/core/src/api/routes/accounts.ts`

## Verification Results

```
pnpm --filter @aprumo/core test -- accounts.test
  Test Files: 15 passed (15)
  Tests:      99 passed | 1 skipped (100)

pnpm --filter @aprumo/core typecheck  → exit 0

pnpm --filter @aprumo/core test       → 99 passed | 1 skipped (full suite, no regressions)
```

Cursor pagination round-trip verified: page 1 with `limit=2` returns 2 items + non-null cursor; page 2 with that cursor returns 1 remaining item + null cursor; no ID overlap between pages.

## Known Stubs

None. `balance: null` in POST /accounts response is intentional per API-07 (balance worker runs in Phase 4, not Phase 3). This is documented design, not a stub — the GET /accounts/:id endpoint already correctly returns the materialized balance when the account_balance row exists.

## Threat Surface Scan

No new threat surface introduced beyond what is in the plan's threat model. All T-03-06a through T-03-06f mitigations are implemented:
- T-03-06a: cursor decode in try/catch → throws `invalid_cursor` → pgErrorHandler → 400
- T-03-06b: cursor values passed via Drizzle `sql` template (parameterized)
- T-03-06c: TypeBox `maximum:200` + Math.min belt-and-suspenders
- T-03-06d: TypeBox AccountTypeSchema enum rejects invalid type strings
- T-03-06e/f: balance and metadata returned as-is; pino redact config in server prevents PII logging

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/core/src/api/routes/accounts.ts | FOUND |
| packages/core/src/api/routes/accounts.test.ts | FOUND |
| .planning/phases/03-core-ledger-api/03-06-SUMMARY.md | FOUND |
| RED commit 77227c7 | FOUND |
| GREEN commit a1c52f9 | FOUND |
