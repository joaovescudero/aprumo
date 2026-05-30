---
phase: "03-core-ledger-api"
plan: "03"
subsystem: "core"
tags: ["retry", "error-handling", "rfc9457", "tdd", "fastify", "postgres"]
dependency_graph:
  requires: ["03-01"]
  provides: ["withRetryOnSerializationFailure", "pgErrorHandler", "LedgerError", "ValidationError", "NotFoundError", "SerializationRetryExhaustedError"]
  affects: ["03-04", "03-05", "03-06"]
tech_stack:
  added: []
  patterns: ["TDD red-green", "RFC 9457 problem+json", "exponential backoff retry", "type-safe error code extraction"]
key_files:
  created:
    - packages/core/src/lib/with-retry.ts
    - packages/core/src/lib/with-retry.test.ts
    - packages/core/src/api/errors/app-errors.ts
    - packages/core/src/api/errors/pg-error-handler.ts
    - packages/core/src/api/errors/pg-error-handler.test.ts
  modified: []
decisions:
  - "Timer fix: used Promise.all([ expect(promise).rejects, vi.advanceTimersByTimeAsync() ]) to avoid unhandled rejection in exhaustion test"
  - "makeError helper in test uses 'as unknown as FastifyError' double-cast because Object.assign result lacks 'code' property that FastifyError requires (strict TS)"
metrics:
  duration: "6m 7s"
  completed: "2026-05-30"
  tasks_completed: 3
  files_created: 5
---

# Phase 3 Plan 03: withRetryOnSerializationFailure + pgErrorHandler Summary

**One-liner:** SERIALIZABLE retry wrapper (50/100/200ms backoff, MAX_RETRIES=3) and RFC 9457 pgErrorHandler mapping PG codes P0001/40001/23505 to typed problem+json without leaking internals.

## Tasks Completed

| # | Task | Commit | Status |
|---|------|--------|--------|
| 1 | TDD RED — with-retry tests | bebeef0 | Complete |
| 2 | TDD RED — pg-error-handler + app-errors tests | 776035e | Complete |
| 3 | TDD GREEN — implement all three modules | 20e39c2 | Complete |

## TDD Gate Compliance

- `test(03-03)` commit `bebeef0` — RED gate for with-retry.test.ts
- `test(03-03)` commit `776035e` — RED gate for pg-error-handler.test.ts
- `feat(03-03)` commit `20e39c2` — GREEN gate (all 11 tests pass)
- REFACTOR: not required (no `any`, correct types, no logic duplication)

## Artifacts Produced

### `packages/core/src/lib/with-retry.ts`

Exports `withRetryOnSerializationFailure<T>(fn: () => Promise<T>): Promise<T>`.

Key behaviors:
- `SERIALIZATION_FAILURE = '40001'`, `MAX_RETRIES = 3`
- Loop: attempt 0..3. On catch: extract `pgCode` via `typeof err === 'object' && err !== null && 'code' in err`. If 40001 and attempt < MAX_RETRIES: await backoff (50 * 2^attempt ms), continue. Else: throw.
- Non-40001 errors propagate immediately.
- Backoff values: 50ms, 100ms, 200ms (total max 350ms across all retries).

### `packages/core/src/api/errors/app-errors.ts`

Exports `LedgerError`, `SerializationRetryExhaustedError`, `ValidationError`, `NotFoundError`.

- All extend `Error`. Each sets `this.name`. Discriminated by `code` (machine-readable) + `statusCode`.
- `SerializationRetryExhaustedError`: code=`serialization_retry_exhausted`, status=503, `retryable=true`.
- `ValidationError`: code=`validation_error`, status=422.
- `NotFoundError`: code=`not_found`, status=404.

### `packages/core/src/api/errors/pg-error-handler.ts`

Exports `pgErrorHandler` (FastifyErrorHandler signature).

RFC 9457 discrimination order:
1. `error.validation` array with element `missingProperty === 'idempotency-key'` → 400 `idempotency_key_required`
2. `error.validation` present (generic) → 422 `validation_error`
3. pgCode `P0001` + message contains "do not balance" → 422 `unbalanced_postings`
4. pgCode `P0001` other → 422 `ledger_constraint_violation`
5. pgCode `40001` → 503 `serialization_retry_exhausted` + `retryable: true`
6. pgCode `23505` → 409 `conflict`
7. Default → 500 `internal_error`, detail = "An unexpected error occurred." (no leak)

All branches: `Content-Type: application/problem+json`, `body.instance = req.id`.

## Verification Results

```
pnpm --filter @aprumo/core test -- with-retry pg-error-handler
→ Test Files  2 passed (2)
→ Tests  11 passed (11)

pnpm --filter @aprumo/core typecheck
→ (exit 0, no errors)

grep '\bany\b' (non-comment lines)
→ No any in with-retry.ts, app-errors.ts, pg-error-handler.ts

grep 'error.message|.stack' pg-error-handler.ts (non-comment lines)
→ error.message used only in P0001 branch to discriminate message content (not leaked to response)
→ 500 path detail = "An unexpected error occurred." (no internals)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.useFakeTimers + unhandled rejection in exhaustion test**

- **Found during:** Task 3 (GREEN cycle — running tests after first implementation)
- **Issue:** The `re-throws after exhausting MAX_RETRIES` test used sequential `await vi.advanceTimersByTimeAsync()` calls after creating the promise, but before `expect(promise).rejects` — this caused the promise rejection to be "unhandled" transiently, triggering vitest's unhandled rejection warning and test failure.
- **Fix:** Switched to `Promise.all([ expect(withRetryOnSerializationFailure(fn)).rejects.toMatchObject(...), vi.advanceTimersByTimeAsync(351) ])` so the rejection is always handled atomically with the timer advancement.
- **Files modified:** `packages/core/src/lib/with-retry.test.ts`
- **Commit:** Included in feat(03-03) `20e39c2`

**2. [Rule 1 - Bug] TypeScript cast in test makeError helper**

- **Found during:** Task 3 (typecheck pass)
- **Issue:** `Object.assign(new Error(...), fields) as FastifyError` fails strict TypeScript because `FastifyError` requires `code: string` as a non-optional field, but `Object.assign` result does not guarantee it.
- **Fix:** Changed cast to `as unknown as FastifyError` (double-cast pattern per CLAUDE.md — the comment in the test explains why: the mock factory needs to produce partial FastifyError shapes for testing).
- **Files modified:** `packages/core/src/api/errors/pg-error-handler.test.ts`
- **Commit:** Included in feat(03-03) `20e39c2`

## Known Stubs

None — all exports are fully implemented with correct logic.

## Threat Flags

No new threat surface beyond what was specified in the plan's threat model. The three mitigations from T-03-03a/b/c are all implemented and tested:
- T-03-03a: 500 path detail = "An unexpected error occurred." — asserted by test "maps unknown error code to 500 internal_error without leaking SQL details"
- T-03-03b: MAX_RETRIES=3 hard limit — asserted by test "re-throws after exhausting MAX_RETRIES"
- T-03-03c: type-safe pgCode extraction — no `any`, no assumed error shape

## Self-Check: PASSED

- `packages/core/src/lib/with-retry.ts` — FOUND
- `packages/core/src/lib/with-retry.test.ts` — FOUND
- `packages/core/src/api/errors/app-errors.ts` — FOUND
- `packages/core/src/api/errors/pg-error-handler.ts` — FOUND
- `packages/core/src/api/errors/pg-error-handler.test.ts` — FOUND
- Commit `bebeef0` (RED with-retry) — FOUND
- Commit `776035e` (RED pg-error-handler) — FOUND
- Commit `20e39c2` (GREEN implementation) — FOUND
