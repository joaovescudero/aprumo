---
phase: 02-schema-foundation-db-tooling
plan: 14
subsystem: testing
tags: [testcontainers, postgres, globalsetup, vitest, roles, pg_authid, race-condition]

requires:
  - phase: 02-schema-foundation-db-tooling
    provides: "plans 02-01 through 02-13: schema, migrations, applyMigrationsToSchema with savepoint handler"

provides:
  - "globalSetup.ts pre-creates aprumo_app and aprumo_migration roles once before any worker fork"
  - "RACE-01/RACE-02 tests documenting the 23505 race and verifying the fix boundary"
  - "CREATE ROLE race eliminated — parallel test file workers no longer race on pg_authid"

affects:
  - "All future phases using pnpm --filter @aprumo/core test"
  - "CI pipeline — testcontainers integration test suite now fully green"

tech-stack:
  added: []
  patterns:
    - "globalSetup role pre-creation: pre-create cluster-global PG roles before any worker fork using PL/pgSQL EXCEPTION duplicate_object"
    - "TDD RED/GREEN: RACE-02 asserts shared container has roles pre-created — fails RED, passes GREEN after fix"
    - "Ephemeral container isolation: RACE-01 uses own container (not shared) to demonstrate raw race without savepoint masking"

key-files:
  created:
    - packages/core/tests/helpers/globalSetup.race.test.ts
  modified:
    - packages/core/tests/globalSetup.ts

key-decisions:
  - "D-50: globalSetup pre-creates cluster-global roles with PL/pgSQL EXCEPTION duplicate_object (not IF NOT EXISTS) — atomic idempotency for both cold and reuse-mode containers"
  - "D-51: RACE-02 targets shared inject('pgUri') container (not ephemeral) to test the actual fix boundary; RACE-01 targets ephemeral container to document raw race without savepoint masking"

patterns-established:
  - "Cluster-global DDL (roles, types) must be pre-created in globalSetup before worker forks, not left to per-file migration runners"

requirements-completed: [FND-12]

duration: 12min
completed: 2026-05-25
---

# Phase 02 Plan 14: Schema Foundation DB Tooling Summary

**globalSetup pre-creates aprumo_app and aprumo_migration roles via PL/pgSQL EXCEPTION duplicate_object before worker forks, eliminating the non-atomic IF NOT EXISTS CREATE ROLE race (SQLSTATE 23505) that caused 4 integration suites to fail intermittently under parallel vitest execution**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-25T12:37:38Z
- **Completed:** 2026-05-25T12:49:45Z
- **Tasks:** 3 (RED + GREEN + VERIFY)
- **Files modified:** 2

## Accomplishments

- Pre-create cluster-global roles once in single-threaded globalSetup before any vitest worker fork starts
- RACE-01 documents the raw race: concurrent CREATE ROLE without EXCEPTION handling produces 23505 on pg_authid_rolname_index
- RACE-02 asserts the fix boundary: shared container must have both roles pre-created by globalSetup
- Full test suite: 10 files, 65 tests, 0 failures, 0 skips — exit 0
- Migration drift gate intact: 10 migrations verified, no SHA-256 drift
- APRUMO_TEST_REUSE=1 path is idempotent: EXCEPTION duplicate_object absorbs 42710 on warm container

## Task Commits

1. **Task 1 (RED): add RACE-01/RACE-02 tests** - `608f63e` (test)
2. **Task 2 (GREEN): pre-create PG roles in globalSetup** - `e52a4a1` (fix)

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Full suite | `pnpm --filter @aprumo/core test` | 10 files, 65 tests, exit 0 |
| audit-triggers | vitest run (individual) | PASS |
| constraint-trigger | vitest run (individual) | PASS |
| revoke | vitest run (individual) | PASS |
| schema-shape | vitest run (individual) | PASS |
| WR-02 | applyMigrationsToSchema.test.ts | PASS (14/14) |
| Drift gate | check-migration-drift.mjs | exit 0, 10 migrations verified |
| No migration diffs | git diff --name-only migrations/ migrate.ts | empty output |
| Skipped tests | from test output | 0 skipped |

## Files Created/Modified

- `packages/core/tests/helpers/globalSetup.race.test.ts` — RACE-01 (raw race doc) + RACE-02 (fix boundary assertion); RACE-02 was the RED test that failed before Task 2
- `packages/core/tests/globalSetup.ts` — added `import postgres from "postgres"` and role pre-creation block (DO/EXCEPTION duplicate_object for each role, adminSql.end() in finally)

## Decisions Made

- **D-50**: Used PL/pgSQL `EXCEPTION WHEN duplicate_object THEN NULL` instead of `IF NOT EXISTS` for role pre-creation in globalSetup. IF NOT EXISTS is non-atomic across sessions (race window between SELECT and CREATE); EXCEPTION is atomic within a PL/pgSQL block. This is the correct idempotency mechanism for cluster-global DDL.
- **D-51**: RACE-02 uses the shared inject("pgUri") container (not an ephemeral one) because the assertion is specifically about what globalSetup provides to workers. RACE-01 uses a separate ephemeral container to show the raw race without interference from globalSetup pre-creation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Redesigned RACE-01 test — original design incompatible with savepoint handler**

- **Found during:** Task 1 (RED phase)
- **Issue:** The plan specified RACE-01 should assert `errors.length > 0` from concurrent `applyMigrationsToSchema` calls. But plan 02-12 added a savepoint handler that absorbs 23505/42710 on role statements — so `applyMigrationsToSchema` always resolves successfully (no rejections), making `errors.length === 0` always. The original RACE-01 assertion would never work.
- **Fix:** Replaced the original RACE-01 design (concurrent `applyMigrationsToSchema` with `errors.length > 0` assertion) with two complementary tests:
  - RACE-01: Demonstrates the raw race using direct `postgres-js` connections (bypassing the savepoint wrapper) to show 23505 CAN surface from concurrent DO/IF NOT EXISTS CREATE ROLE
  - RACE-02: Asserts the fix boundary — shared container must have both roles pre-created by globalSetup (fails RED, passes GREEN)
- **Files modified:** `packages/core/tests/helpers/globalSetup.race.test.ts`
- **Verification:** RACE-02 failed in RED (roles not pre-created), both RACE-01 and RACE-02 passed in GREEN (roles pre-created)
- **Committed in:** `608f63e` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** The redesign better separates concerns: RACE-01 documents the mechanism, RACE-02 tests the fix boundary. No scope creep. All acceptance criteria met.

## Issues Encountered

- Biome lint/format required multiple fixes: unused imports (removed `applyMigrationsToSchema` import and `MIGRATIONS_FOLDER` const), import ordering, and trailing comma style for `it(..., timeout)` calls. Applied `./node_modules/.bin/biome format --write` and manual fix for inline comment placement.

## Known Stubs

None — no stub values in production code. Test helper uses real PG container connections.

## Threat Flags

No new trust boundaries introduced. globalSetup admin connection is to loopback testcontainers instance (T-02-14-01 accepted). Connection leak prevented by `finally { await adminSql.end() }` (T-02-14-02 mitigated).

## Next Phase Readiness

- Phase 02 is complete: all 14 plans executed, UAT Test 5 gap-2 closed
- Full integration test suite green (10 files, 65 tests, 0 skips)
- Migration drift gate intact
- Phase 03 (API layer / Fastify) can proceed

---
*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-25*

## Self-Check: PASSED

- packages/core/tests/helpers/globalSetup.race.test.ts — FOUND
- packages/core/tests/globalSetup.ts — FOUND
- .planning/phases/02-schema-foundation-db-tooling/02-14-SUMMARY.md — FOUND
- commit 608f63e (test: RED) — FOUND
- commit e52a4a1 (fix: GREEN) — FOUND
