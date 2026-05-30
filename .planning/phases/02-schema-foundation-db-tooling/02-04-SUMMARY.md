---
phase: 02-schema-foundation-db-tooling
plan: "04"
subsystem: database
tags: [postgres, plpgsql, security-definer, double-entry, idempotency, tdd, immutability]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "03"
    provides: 0001_roles.sql + 0002_grants.sql; aprumo_app and aprumo_migration roles configured;
      REVOKE UPDATE/DELETE on postings/raw_events; GRANT EXECUTE ON ALL FUNCTIONS for future functions
  - phase: 02-schema-foundation-db-tooling
    plan: "08"
    provides: createTestDb helper for schema-per-file integration tests with role-specific pools

provides:
  - packages/core/migrations/0003_post_transaction.sql (CREATE TYPE posting_input;
    CREATE FUNCTION post_transaction SECURITY DEFINER; ALTER FUNCTION OWNER TO aprumo_migration;
    GRANT EXECUTE TO aprumo_app)
  - packages/core/migrations/meta/_journal.json (updated with 0003_post_transaction entry idx=3)
  - packages/core/tests/schema/post-transaction.integration.test.ts (TDD: 7 tests covering
    balanced success, idempotency, P0001 error paths, 42501 sole-write-path enforcement)

affects:
  - 02-05 (double_entry_trigger — CONSTRAINT TRIGGER defers the same SUM=0 check to COMMIT)
  - 02-09 (migration drift check — hashes 0003_post_transaction.sql against journal)
  - Phase 3+ (Fastify calls post_transaction via aprumo_app pool; P0001 maps to HTTP 422)
  - Phase 7 (Webhooks call post_transaction for settlement posting)

tech-stack:
  added: []
  patterns:
    - SECURITY DEFINER + SET search_path = public (sole write path via function, T-2-04 mitigated)
    - Composite type posting_input for PG-level type safety over JSONB array
    - Idempotency: SELECT INTO + IF FOUND THEN RETURN (no error on duplicate key)
    - Belt-and-suspenders balance check in function + deferred constraint trigger (Plan 05)
    - ERRCODE P0001 with descriptive message prefixes for Phase 3 HTTP 422 mapping

key-files:
  created:
    - packages/core/migrations/0003_post_transaction.sql
    - packages/core/tests/schema/post-transaction.integration.test.ts
  modified:
    - packages/core/migrations/meta/_journal.json

key-decisions:
  - "SECURITY DEFINER function owned by aprumo_migration closes INSERT path on postings at DB level"
  - "Composite type posting_input chosen over JSONB array for PG-level type safety"
  - "Idempotency handled by IF FOUND THEN RETURN (no error) — matches API-05 semantics"
  - "P0001 error code with message prefix used for all validation failures — mappable to 422 in Phase 3"
  - "Balance check in function is belt-and-suspenders with Plan 05 CONSTRAINT TRIGGER"

requirements-completed:
  - FND-09

duration: 3min
completed: 2026-05-22
---

# Phase 02 Plan 04: post_transaction SECURITY DEFINER Function Summary

**SECURITY DEFINER plpgsql function `post_transaction` closes the sole INSERT path into
`postings` — validates double-entry balance and idempotency before atomically persisting
`transactions` + `postings` rows**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-22T21:14:37Z
- **Completed:** 2026-05-22T21:17:47Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- Created `packages/core/tests/schema/post-transaction.integration.test.ts` with 7 tests:
  balanced success returns UUID, idempotency returns same UUID on duplicate key, unbalanced
  postings raise P0001 with "do not balance", empty array raises P0001 with "must not be empty",
  invalid direction raises P0001 with "invalid direction", zero amount raises P0001 with "must be
  positive", direct INSERT by aprumo_app raises 42501
- Created `packages/core/migrations/0003_post_transaction.sql`: `CREATE TYPE posting_input` +
  `CREATE FUNCTION post_transaction SECURITY DEFINER SET search_path = public` with full
  validation loop + idempotency guard + atomic INSERT of transactions and postings
- Updated `_journal.json` via `drizzle-kit generate --custom` to register 0003_post_transaction
  at idx=3
- All CLAUDE.md invariants enforced: Invariant #1 (sole write path), Invariant #2 (double-entry
  validated before INSERT), Invariant #3 (idempotency — no error on duplicate key)
- No GRANT INSERT ON postings anywhere — confirmed by grep returning no matches

## Task Commits

1. `10a3b3d` — `test(02-04): add RED post_transaction integration tests`
2. `72d132e` — `feat(02-04): add 0003_post_transaction migration with SECURITY DEFINER; GREEN`

## Files Created

- `packages/core/migrations/0003_post_transaction.sql` — composite type posting_input + SECURITY
  DEFINER post_transaction function with balance validation, idempotency, and ownership/EXECUTE grants
- `packages/core/tests/schema/post-transaction.integration.test.ts` — 7 integration tests asserting
  success path, idempotency, 4 P0001 error paths, and 42501 for direct INSERT attempt

## Files Modified

- `packages/core/migrations/meta/_journal.json` — added entry idx=3 for 0003_post_transaction

## Decisions Made

- `SECURITY DEFINER` chosen over `GRANT INSERT + convention`: convention can be bypassed by future
  code; DB-level enforcement cannot. The function runs as `aprumo_migration` (which has INSERT on
  postings) even when called by `aprumo_app` (which does not).
- `posting_input` composite type chosen over JSONB array: gives PG-level type safety
  (`rec.account_id`, `rec.amount_cents`, `rec.direction` vs manual JSON extraction with casts).
- Balance validated BEFORE any INSERT: if validation fails, no partial writes occur. This is
  belt-and-suspenders with the deferred CONSTRAINT TRIGGER (Plan 05).
- `P0001` error code used for all validation failures (empty array, invalid direction, negative
  amount, unbalanced sum) with distinctive message prefixes for Phase 3 HTTP 422 routing.
- `ALTER FUNCTION OWNER TO aprumo_migration` is explicit: though the migration runs as superuser,
  explicit ownership documents intent and survives role ownership changes.

## Deviations from Plan

None — plan executed exactly as written. Two Biome formatting fixes were required (regex
multi-line formatting in test file, trailing newline in `_journal.json`) — standard hook
compliance, not plan deviations.

## TDD Gate Compliance

- RED commit `10a3b3d`: `test(02-04): add RED post_transaction integration tests` — exists BEFORE
  implementation
- GREEN commit `72d132e`: `feat(02-04): add 0003_post_transaction migration with SECURITY DEFINER;
  GREEN` — exists AFTER RED
- Gate sequence: RED → GREEN — PASSED

## Known Stubs

None — this plan delivers a SQL migration and integration tests with no UI or data stubs.

## Threat Flags

No new security surface beyond what the plan's threat_model covers.

- T-2-01 mitigated: `aprumo_app` has EXECUTE on `post_transaction` but no direct INSERT on
  `postings`. Integration test asserts `42501` on direct INSERT attempt.
- T-2-04 mitigated: `SET search_path = public` present in SECURITY DEFINER function (line 36 of
  0003_post_transaction.sql). Prevents malicious caller from redirecting function calls.
- T-2-02 (schema drift): 0003_post_transaction.sql registered in `_journal.json` at idx=3 for
  Plan 09 drift check.

## Self-Check: PASSED

Files verified on disk:
- packages/core/migrations/0003_post_transaction.sql: FOUND
- packages/core/tests/schema/post-transaction.integration.test.ts: FOUND
- packages/core/migrations/meta/_journal.json: FOUND (entry for 0003_post_transaction at idx=3)

Commits verified:
- 10a3b3d: FOUND (test(02-04): add RED post_transaction integration tests)
- 72d132e: FOUND (feat(02-04): add 0003_post_transaction migration with SECURITY DEFINER; GREEN)

Verification checks:
- SECURITY DEFINER in function definition (line 35): PRESENT
- SET search_path = public in function: PRESENT
- GRANT INSERT ON postings in any migration: 0 matches (grep exit code 1) — PASSED
- 0003_post_transaction in _journal.json: 1 match — PASSED
- typecheck: exits 0 — PASSED

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
