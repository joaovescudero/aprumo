---
phase: 02-schema-foundation-db-tooling
plan: "05"
subsystem: database
tags: [postgres, plpgsql, constraint-trigger, double-entry, deferred, tdd, immutability]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "04"
    provides: 0003_post_transaction.sql; post_transaction SECURITY DEFINER function; posting_input composite type
  - phase: 02-schema-foundation-db-tooling
    plan: "08"
    provides: createTestDb helper for schema-per-file integration tests with role-specific pools

provides:
  - packages/core/migrations/0005_double_entry_trigger.sql (CREATE FUNCTION
    check_double_entry_balance LANGUAGE plpgsql; CREATE CONSTRAINT TRIGGER assert_double_entry
    AFTER INSERT DEFERRABLE INITIALLY DEFERRED; ERRCODE P0001 with double_entry_violation: prefix)
  - packages/core/migrations/meta/_journal.json (updated with 0005_double_entry_trigger entry idx=5)
  - packages/core/tests/schema/constraint-trigger.integration.test.ts (TDD: 2 tests asserting
    pg_constraint row exists and condeferrable=true + condeferred=true)

affects:
  - 02-09 (migration drift check — hashes 0005_double_entry_trigger.sql against journal)
  - Phase 3+ (Fastify error handler catches P0001 with double_entry_violation: prefix → HTTP 422)
  - Any path that calls post_transaction (belted by trigger if function check bypassed)

tech-stack:
  added: []
  patterns:
    - CONSTRAINT TRIGGER (only trigger type supporting DEFERRABLE) on AFTER INSERT
    - DEFERRABLE INITIALLY DEFERRED fires at COMMIT — aggregate check across all INSERTs in tx
    - COALESCE(SUM(CASE direction WHEN debit THEN +amount WHEN credit THEN -amount ELSE 0 END), 0)
    - ERRCODE P0001 with double_entry_violation: prefix for Phase 3 HTTP 422 routing
    - RETURN NULL at end of AFTER trigger (return value ignored by Postgres)

key-files:
  created:
    - packages/core/migrations/0005_double_entry_trigger.sql
    - packages/core/tests/schema/constraint-trigger.integration.test.ts
  modified:
    - packages/core/migrations/meta/_journal.json

key-decisions:
  - "Migration landed at idx=5 (0005_double_entry_trigger.sql) — plan originally named 0004 but
    plan 02-06 (audit triggers) occupied idx=4 during parallel execution"
  - "CONSTRAINT TRIGGER chosen over standard trigger — only CONSTRAINT TRIGGER supports DEFERRABLE,
    which is essential for deferred-to-COMMIT firing semantics"
  - "AFTER INSERT only — postings is append-only; no UPDATE/DELETE allowed (REVOKE in 0002_grants.sql)"
  - "P0001 with double_entry_violation: prefix — Phase 3 maps error.code=P0001 + message prefix to 422"
  - "RETURN NULL at end — Postgres AFTER triggers ignore return value; NULL is correct and conventional"

requirements-completed:
  - FND-10
  - FND-11

duration: 2min
completed: 2026-05-22
---

# Phase 02 Plan 05: Double-Entry Constraint Trigger Summary

**CONSTRAINT TRIGGER `assert_double_entry` DEFERRABLE INITIALLY DEFERRED on `postings` fires at
COMMIT and validates `SUM(signed amount_cents) = 0` per `transaction_id` — third immutability layer
that cannot be bypassed by application code**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-22T21:27:47Z
- **Completed:** 2026-05-22T21:30:17Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- Created `packages/core/tests/schema/constraint-trigger.integration.test.ts` with 2 test cases:
  `assert_double_entry` trigger row exists in `pg_constraint` for `postings` table;
  `assert_double_entry` has `condeferrable=true` AND `condeferred=true` (FND-11)
- Created `packages/core/migrations/0005_double_entry_trigger.sql`:
  `check_double_entry_balance()` plpgsql function computes signed `SUM` per `transaction_id` and
  raises `P0001` with `double_entry_violation:` prefix if not zero;
  `CONSTRAINT TRIGGER assert_double_entry AFTER INSERT ON postings DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW` — fires at COMMIT time to catch any unbalanced transaction
- Updated `_journal.json` via `drizzle-kit generate --custom` to register
  `0005_double_entry_trigger` at idx=5
- All CLAUDE.md invariants enforced: Invariant #2 (double-entry check at COMMIT time as
  belt-and-suspenders after post_transaction's inline check)
- No `SET CONSTRAINTS ALL IMMEDIATE` anywhere — confirmed by grep returning zero non-comment matches
- `AFTER INSERT` only — no UPDATE/DELETE events since postings is append-only

## Task Commits

1. `e3f7210` — `test(02-05): add RED constraint trigger condeferrable/condeferred tests`
2. `bd8c5c6` — `feat(02-05): add 0005_double_entry_trigger migration; constraint trigger GREEN`

## Files Created

- `packages/core/migrations/0005_double_entry_trigger.sql` — `check_double_entry_balance()` plpgsql
  function with signed-sum aggregate check + `CONSTRAINT TRIGGER assert_double_entry DEFERRABLE
  INITIALLY DEFERRED` targeting `postings` table AFTER INSERT; ERRCODE P0001 with
  `double_entry_violation:` prefix
- `packages/core/tests/schema/constraint-trigger.integration.test.ts` — 2 integration tests
  asserting pg_constraint catalog shows `condeferrable=true` and `condeferred=true` for
  `assert_double_entry` on `postings`

## Files Modified

- `packages/core/migrations/meta/_journal.json` — added entry idx=5 for
  `0005_double_entry_trigger`; added trailing newline for Biome compliance

## Decisions Made

- **Migration is 0005 (not 0004):** Plan 02-06 (audit triggers) ran before this plan in the same
  wave and occupied idx=4. Drizzle-kit correctly assigned idx=5. Functional outcome identical —
  migrations are applied in numeric order. Summary reflects actual landed filename.
- **CONSTRAINT TRIGGER over standard TRIGGER:** Only `CONSTRAINT TRIGGER` syntax supports
  `DEFERRABLE`. Standard AFTER ROW triggers fire per statement; CONSTRAINT TRIGGER with
  `DEFERRABLE INITIALLY DEFERRED` fires at COMMIT. This distinction is the entire point of FND-10.
- **AFTER INSERT only:** Postings is append-only. Adding UPDATE/DELETE to the trigger events would
  be dead code and potentially confusing — it implies the table is mutable.
- **RETURN NULL at trigger end:** Postgres AFTER trigger return value is ignored. Returning `NULL`
  is the conventional correct form.
- **P0001 with message prefix:** Using `USING ERRCODE = 'P0001'` with a `double_entry_violation:`
  prefix enables Phase 3 to route precisely: `code === 'P0001' && message.includes('double_entry_violation:')` → HTTP 422.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration assigned idx=5, not idx=4 as originally planned**
- **Found during:** Task 2 (drizzle-kit generate)
- **Issue:** Plan 02-05 was originally written expecting to claim idx=4 (filename
  `0004_double_entry_trigger.sql`). Plan 02-06 ran first in the same wave and took idx=4.
  Drizzle-kit assigned idx=5 (`0005_double_entry_trigger.sql`).
- **Fix:** Accepted drizzle-kit assignment. Updated test file comment and SUMMARY.md to document
  actual landed filename. Migration content and functional behavior are identical.
- **Files modified:** `packages/core/migrations/0005_double_entry_trigger.sql` (correct name),
  `packages/core/migrations/meta/_journal.json` (idx=5 entry)
- **Commit:** bd8c5c6

**2. [Rule 1 - Bug] Biome trailing newline required in _journal.json**
- **Found during:** Task 2 GREEN commit preparation (pre-commit hook)
- **Issue:** `drizzle-kit generate --custom` does not append trailing newline to `_journal.json`;
  Biome pre-commit hook rejects files lacking trailing newline.
- **Fix:** Added trailing newline to `_journal.json` before staging.
- **Files modified:** `packages/core/migrations/meta/_journal.json`
- **Commit:** bd8c5c6

## TDD Gate Compliance

- RED commit `e3f7210`: `test(02-05): add RED constraint trigger condeferrable/condeferred tests`
  — exists BEFORE implementation
- GREEN commit `bd8c5c6`: `feat(02-05): add 0005_double_entry_trigger migration; constraint trigger
  GREEN` — exists AFTER RED
- Gate sequence: RED → GREEN — PASSED

## Known Stubs

None — this plan delivers a SQL migration and integration tests with no UI or data stubs.

## Threat Flags

No new security surface beyond what the plan's threat_model covers.

- T-2-01 mitigated: `check_double_entry_balance()` constraint trigger catches any unbalanced
  transaction at COMMIT even if `post_transaction`'s inline check is bypassed (superuser, migration
  script, etc.). Integration test (FND-11) asserts `condeferrable=true` and `condeferred=true` to
  confirm deferred semantics are in place.
- T-2-02 (schema drift): `0005_double_entry_trigger.sql` registered in `_journal.json` at idx=5
  for Plan 09 drift check.
- T-2-03 (SET CONSTRAINTS ALL IMMEDIATE): grep confirmed zero non-comment SQL lines containing
  `SET CONSTRAINTS` — prohibition enforced.
- T-2-04 (search_path injection): Trigger function has no `SET search_path` override — it runs
  under the search_path of the caller, which for constraint triggers is the table's schema
  (`postings` → `public`). No dynamic SQL in the trigger function body — only parameterized queries.

## Self-Check: PASSED

Files verified on disk:
- packages/core/migrations/0005_double_entry_trigger.sql: FOUND
- packages/core/tests/schema/constraint-trigger.integration.test.ts: FOUND
- packages/core/migrations/meta/_journal.json: FOUND (entry for 0005_double_entry_trigger at idx=5)

Commits verified:
- e3f7210: FOUND (test(02-05): add RED constraint trigger condeferrable/condeferred tests)
- bd8c5c6: FOUND (feat(02-05): add 0005_double_entry_trigger migration; constraint trigger GREEN)

Verification checks:
- DEFERRABLE INITIALLY DEFERRED in DDL statement (line 55): PRESENT
- P0001 ERRCODE: PRESENT (1 match)
- double_entry_violation: prefix in error message: PRESENT (1 match)
- SET CONSTRAINTS as SQL (not comment): 0 matches — PASSED
- 0005_double_entry_trigger in _journal.json at idx=5: 1 match — PASSED
- AFTER INSERT only (no UPDATE/DELETE): VERIFIED
- typecheck: exits 0 — PASSED

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
