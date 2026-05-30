---
phase: 02-schema-foundation-db-tooling
plan: "09"
subsystem: infra
tags: [sha256, migration-drift, ci, github-actions, vitest, node]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "07"
    provides: 0006_seed_dev.sql + _journal.json (idx=6) — all 7 migrations in place for hashing

provides:
  - scripts/check-migration-drift.mjs (FND-15 hard gate: SHA-256 drift check, exits 1 on tamper)
  - scripts/generate-migration-hashes.mjs (dev helper: regenerate hashes when adding new migration)
  - packages/core/migrations/migration-hashes.json (committed SHA-256 of all 7 migrations 0000–0006)
  - packages/core/tests/infra/migration-drift.test.ts (3 TDD tests: clean/tamper/missing)
  - .github/workflows/ci.yml: migration-integrity job that fails CI on any committed migration edit

affects:
  - All future plans that add new migration files (must run generate-migration-hashes.mjs)
  - Phase 3+ deployment (drift gate runs on every PR/push to main)

tech-stack:
  added: []
  patterns:
    - "Committed hash file (migration-hashes.json) vs re-computed SHA-256 per CI run"
    - "Script-level Vitest test using spawnSync — no DB container required"
    - "Separate generator script (generate-migration-hashes.mjs) for intentional hash updates"

key-files:
  created:
    - scripts/check-migration-drift.mjs
    - scripts/generate-migration-hashes.mjs
    - packages/core/migrations/migration-hashes.json
    - packages/core/tests/infra/migration-drift.test.ts
  modified:
    - .github/workflows/ci.yml

key-decisions:
  - "Drift check is a hash file comparison (not _journal.json byte-diff) — D-35: sub-second, zero DB dependency"
  - "Separate migration-integrity CI job (not added to lint job) so it has its own status check in PRs"
  - "generate-migration-hashes.mjs as dev helper instead of npm script — ESM, no build required"
  - "Seed migration (0006_seed_dev) included in hash file — consistent with it being in journal"

requirements-completed:
  - FND-15

duration: 8min
completed: 2026-05-22
---

# Phase 02 Plan 09: Migration Drift Check Summary

**SHA-256 drift gate (FND-15): check-migration-drift.mjs compares re-hashed .sql files against committed migration-hashes.json — CI fails immediately if any committed migration is edited**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-22T21:37:00Z
- **Completed:** 2026-05-22T21:45:05Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files created:** 4
- **Files modified:** 1

## Accomplishments

- Created `packages/core/tests/infra/migration-drift.test.ts` with 3 failing RED tests (clean state, tampered, missing migration) using `spawnSync` against scripts/check-migration-drift.mjs — committed before implementation
- Created `scripts/check-migration-drift.mjs`: ESM Node.js script reads `_journal.json`, SHA-256 hashes each .sql file, compares against `migration-hashes.json`; exits 1 with DRIFT: error messages if any hash differs or file is missing; exits 0 with success message
- Created `scripts/generate-migration-hashes.mjs`: dev helper to regenerate `migration-hashes.json` when a new migration is added; documents immutability invariant in header comment
- Generated `packages/core/migrations/migration-hashes.json` with SHA-256 hashes for all 7 migrations (0000_init_tables through 0006_seed_dev); committed as ground truth
- Added `migration-integrity` job to `.github/workflows/ci.yml` — runs `node scripts/check-migration-drift.mjs` on every push/PR; fails CI if any migration file was edited after hash commit
- Verified tamper simulation: `echo " --tampered" >> 0000_init_tables.sql && node check-migration-drift.mjs` exits 1 with correct DRIFT error

## Task Commits

1. **Task 1 [RED]: Migration drift detection tests** — `9c8e9a7` (test)
2. **Task 2 [GREEN]: Drift check script + hash file + CI step** — `3d3d390` (feat)

## TDD Gate Compliance

- RED commit `9c8e9a7`: `test(02-09): add RED migration drift detection tests` — gate PASSED
- GREEN commit `3d3d390`: `feat(02-09): add migration drift check script + CI step; drift tests GREEN` — gate PASSED
- All 3 tests GREEN after implementation (PASS: 3, FAIL: 0)

## Files Created

- `scripts/check-migration-drift.mjs` — FND-15 hard gate: reads `_journal.json`, SHA-256 hashes each .sql, compares stored hashes; exits 1 on drift; exits 0 on clean
- `scripts/generate-migration-hashes.mjs` — dev helper: regenerate `migration-hashes.json` after adding a new migration; documents that editing existing migrations is forbidden
- `packages/core/migrations/migration-hashes.json` — 7 committed SHA-256 hashes: 0000_init_tables through 0006_seed_dev
- `packages/core/tests/infra/migration-drift.test.ts` — 3 Vitest tests using spawnSync; no DB container; TDD RED→GREEN

## Files Modified

- `.github/workflows/ci.yml` — added `migration-integrity` job (new, after lint) with `node scripts/check-migration-drift.mjs` step

## Decisions Made

- **Separate CI job vs step in lint job:** Added `migration-integrity` as its own top-level job so it appears as a distinct status check in GitHub PR reviews. This makes the FND-15 gate visible and blockable independently without expanding the lint job.
- **generate-migration-hashes.mjs as dev helper (not npm script):** Adding it as a script in package.json would imply it's a routine operation. Keeping it in `scripts/` with a strong header comment reinforces that running it to cover up mutation is a process violation. Developers run it consciously only when adding new migrations.
- **Seed (0006_seed_dev) included in hash file:** Although the migrate runner skips seeds, they are still committed SQL files that must not be edited. Including them in the hash file is consistent with D-35 ("any edit in migration applied fails CI"). The seed file is immutable like any other migration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome lint failures on initial test and script files**
- **Found during:** Task 1 (RED commit attempt) and Task 2 (GREEN commit attempt)
- **Issue:** Biome flagged: import ordering (node: imports not sorted alphabetically), unused `unlinkSync` import in test file, string concatenation instead of template literal, and multi-line process.stderr.write that could be single-line
- **Fix:** Reordered imports alphabetically (`node:child_process`, `node:fs`, `node:path` order); removed unused `unlinkSync`; converted `originalContent + "\n-- tampered"` to template literal; collapsed `process.stderr.write(...)` call
- **Files modified:** `packages/core/tests/infra/migration-drift.test.ts`, `scripts/check-migration-drift.mjs`, `scripts/generate-migration-hashes.mjs`
- **Verification:** `biome check` exits 0 on all three files after fix
- **Committed in:** `9c8e9a7` (RED), `3d3d390` (GREEN)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Biome formatting/linting)
**Impact on plan:** Trivial style fixes; no logic changes. Plan executed exactly as designed.

## Known Stubs

None — this plan delivers a fully functional drift check script and committed hash file with no stubs or placeholder values.

## Threat Flags

No new security surface beyond what the plan's threat_model covers. The drift check reads only local files and exits — no network access, no DB, no credentials.

- T-2-01 mitigated: check-migration-drift.mjs exits 1 on any tamper; CI job added to enforce on every PR/push
- T-2-04 mitigated: script checks every `_journal.json` entry for a stored hash — if missing, exits 1 with "no stored hash" DRIFT error

## Self-Check: PASSED

Files verified on disk:
- scripts/check-migration-drift.mjs: FOUND
- scripts/generate-migration-hashes.mjs: FOUND
- packages/core/migrations/migration-hashes.json: FOUND (7 entries)
- packages/core/tests/infra/migration-drift.test.ts: FOUND (3 test cases)
- .github/workflows/ci.yml: FOUND (contains `check-migration-drift` — 1 match)

Commits verified:
- 9c8e9a7: FOUND (test(02-09): add RED migration drift detection tests)
- 3d3d390: FOUND (feat(02-09): add migration drift check script + CI step; drift tests GREEN)

Verification checks:
- `node scripts/check-migration-drift.mjs` exits 0: PASSED
- Tamper simulation exits 1 with DRIFT message: PASSED
- `grep "check-migration-drift" .github/workflows/ci.yml`: 1 match — PASSED
- Hash count in migration-hashes.json: 7 — PASSED
- All 3 drift tests green (PASS: 3, FAIL: 0): PASSED

## Next Phase Readiness

- FND-15 hard gate is live: any future migration edit will fail CI immediately
- When adding a new migration, developers must run `node scripts/generate-migration-hashes.mjs && git add packages/core/migrations/migration-hashes.json` before committing
- Phase 3 (Core Ledger API) can proceed with full confidence in migration integrity enforcement

---
*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
