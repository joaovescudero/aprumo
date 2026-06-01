---
phase: 3
slug: core-ledger-api
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-29
updated: 2026-06-01
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + coverage v8 (testcontainers PG for ledger path) |
| **Config file** | `packages/core/vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @aprumo/core test` |
| **Full suite command** | `pnpm --filter @aprumo/core test --coverage` |
| **Estimated runtime** | ~60 seconds (testcontainers PG startup amortized via globalSetup) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @aprumo/core test`
- **After every plan wave:** Run `pnpm --filter @aprumo/core test --coverage`
- **Before `/gsd:verify-work`:** Full suite green + 90% LoC coverage gate on `@aprumo/core`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Filled by planner. Every API requirement maps to an automated testcontainers test. The five
> critical ledger behaviors below are Nyquist-critical — each MUST have an explicit failing test
> written BEFORE the implementation (TDD non-negotiable per CLAUDE.md).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Task 1 | 03-03 | 2 | API-10 | T-03-03b | withRetry wraps full db.transaction() factory on 40001; retries ≤3x backoff; exhausted → re-throws | unit | `pnpm --filter @aprumo/core test -- with-retry` | ✅ `src/lib/with-retry.test.ts` | ✅ green |
| Task 2 | 03-03 | 2 | API-11 | T-03-03a | pgErrorHandler maps P0001 → 422, 40001 → 503 retryable:true, validation → 422; 500 never leaks internals | unit | `pnpm --filter @aprumo/core test -- pg-error-handler` | ✅ `src/api/errors/pg-error-handler.test.ts` | ✅ green |
| Task 1 | 03-05 | 4 | API-02, API-03, API-04, API-05 | T-03-05a,e | BigInt amount_cents as string; balanced → 201; unbalanced → 422; concurrent dupe key → both exactly 200, same body | integration | `pnpm --filter @aprumo/core test -- transactions.test` | ✅ `src/api/routes/transactions.test.ts` | ✅ green |
| Task 1 | 03-06 | 5 | API-08, API-09 | T-03-06a,b | balance from account_balance (null if absent); cursor pagination by created_at DESC; limit cap 100 | integration | `pnpm --filter @aprumo/core test -- accounts.test` | ✅ `src/api/routes/accounts.test.ts` | ✅ green |
| Task 1 | 03-07 | 6 | API-12, API-13 | T-03-07a | GET /health → 200 PG up; 503 when db.execute stubs throw; GET /docs/json spec has amount_cents as type:string | integration | `pnpm --filter @aprumo/core test -- health.test` | ✅ `src/api/routes/health.test.ts` | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test files are created by the TDD RED tasks in each plan — they are the "Wave 0" scaffolds:

- [x] **03-03 Task 1**: `with-retry.test.ts` + `pg-error-handler.test.ts` (RED before implementation)
- [x] **03-05 Task 1**: `transactions.test.ts` (RED before transactions.ts)
- [x] **03-06 Task 1**: `accounts.test.ts` (RED before accounts.ts)
- [x] **03-07 Task 1**: `health.test.ts` (RED before health.ts)

No separate Wave 0 plan needed — TDD tasks in each plan create the failing tests first.

*Phase 2 testcontainers infrastructure covers the ledger PG path. No mocks on the ledger PG path (CLAUDE.md).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `GET /docs` Swagger UI renders visually | API-13 | Visual swagger UI render not fully asserted in unit test | Start server, open `/docs`, confirm `amount_cents` shows `type: string` — human checkpoint in 03-07 Task 2 |

*All ledger-critical behaviors have automated verification. Only the swagger UI visual render is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or TDD RED gate
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covered by TDD RED tasks in plans 03-03, 03-05, 03-06, 03-07
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (2026-05-29) · validated (2026-06-01)

---

## Validation Audit 2026-06-01

Full suite: **104 passed, 1 skipped** (16 test files) via `pnpm --filter @aprumo/core test` — ~8.4s.
All 5 Nyquist-critical rows mapped to existing test files, all green. No gaps found.

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

**Skipped test (not a gap):** `globalSetup.race.test.ts` RACE-01 — `it.skip`, documentation-only / non-deterministic. Real regression gate is RACE-02 (green). Maps to no Phase 3 API requirement.
