---
phase: 02-schema-foundation-db-tooling
plan: 15
subsystem: core/db
tags: [seed, security, tdd, wr-06, gap-closure]
dependency_graph:
  requires: []
  provides: [assertSeedStructure-pure-fn, seed-guard-tests]
  affects: [packages/core/src/db/seed.ts, packages/core/tests/infra/seed-guard.test.ts]
tech_stack:
  added: []
  patterns: [pure-function-extraction, sql-comment-stripping, red-green-tdd]
key_files:
  created: [packages/core/tests/infra/seed-guard.test.ts]
  modified: [packages/core/src/db/seed.ts]
decisions:
  - "assertSeedStructure strips '--' comment lines and blank lines before DO $$ check, preserving WR-06 security intent while tolerating legitimate SQL file headers"
  - "Optional label parameter added to error message for traceability (runSeed passes SEED_SQL_PATH)"
  - "Import path in test: ../../src/db/seed.js (2 levels up from tests/infra/, not 3)"
metrics:
  duration: 249s
  completed: 2026-06-02
  tasks_completed: 2
  files_changed: 2
---

# Phase 02 Plan 15: WR-06 Seed Guard Fix Summary

**One-liner:** Extract `assertSeedStructure` pure function that strips SQL line-comments before DO $$ check, restoring `db:seed` without weakening WR-06 security invariant.

## What Was Built

- `assertSeedStructure(content: string, label?: string): void` — pure exported function in `packages/core/src/db/seed.ts` that:
  1. Splits content into lines
  2. Skips blank lines and `--` comment lines
  3. Verifies the first non-skipped line matches `/^\s*DO\s+\$\$/`
  4. Throws with a descriptive error on failure (includes optional label for path traceability)
- `packages/core/tests/infra/seed-guard.test.ts` — 10 unit tests (4 acceptance + 6 rejection), no DB required
- `runSeed()` updated: inline regex guard replaced by `assertSeedStructure(seedContent, SEED_SQL_PATH)` call

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for assertSeedStructure | 536e217 | tests/infra/seed-guard.test.ts |
| 2 (GREEN) | Extract assertSeedStructure + fix import | 105a0f0 | src/db/seed.ts, tests/infra/seed-guard.test.ts |

## Verification Results

- `pnpm --filter @aprumo/core test`: 11 test files passed, 75 tests passed (1 skipped), 0 failures
- `pnpm --filter @aprumo/core db:seed`: exits 0, prints "Seed applied."
- Post-seed counts: accounts=2 (>= 2), transactions=2 (>= 1), postings=4 (>= 2)
- `node scripts/check-migration-drift.mjs`: exits 0 — "no drift detected (12 migrations verified)"
- `grep -c "export function assertSeedStructure" packages/core/src/db/seed.ts`: 1

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import path depth in seed-guard.test.ts**
- **Found during:** Task 2 (GREEN) verification — test still failing after implementation
- **Issue:** Plan specified `"../../../src/db/seed.js"` (3 levels up) which resolves to `packages/src/db/seed.js` (nonexistent). Correct path is `"../../src/db/seed.js"` (2 levels up from `tests/infra/`) which resolves to `packages/core/src/db/seed.js`.
- **Fix:** Changed import from `"../../../src/db/seed.js"` to `"../../src/db/seed.js"` in seed-guard.test.ts
- **Files modified:** packages/core/tests/infra/seed-guard.test.ts
- **Commit:** 105a0f0

## TDD Gate Compliance

- RED gate: `test(02-15): add failing tests for WR-06 assertSeedStructure guard` (536e217) — import error confirmed before fix
- GREEN gate: `feat(02-15): extract assertSeedStructure — fix WR-06 guard for comment headers` (105a0f0) — all 10 tests pass

## Known Stubs

None — all test cases exercise real logic; db:seed runs against a live DB.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The fix is internal to `seed.ts` and does not change the trust boundary (filesystem → seed runner). T-02-15-01 and T-02-15-02 mitigations verified intact.

## Self-Check: PASSED

- packages/core/tests/infra/seed-guard.test.ts: FOUND
- packages/core/src/db/seed.ts: FOUND (contains `export function assertSeedStructure`)
- Commits 536e217 and 105a0f0: verified in git log
