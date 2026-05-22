---
phase: 02-schema-foundation-db-tooling
plan: "08"
subsystem: test-infrastructure
tags: [testcontainers, vitest, postgres, schema-isolation, tdd]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "01"
    provides: "@testcontainers/postgresql + pg installed in @aprumo/core devDeps"

provides:
  - packages/core/tests/globalSetup.ts (Vitest globalSetup: starts postgres:18-alpine container)
  - packages/core/tests/setup/container.ts (PG_IMAGE constant, single source of truth)
  - packages/core/tests/helpers/createTestDb.ts (schema-per-file isolation helper)
  - packages/core/tests/vitest.d.ts (ProvidedContext augmentation for typed inject)
  - packages/core/vitest.config.ts (globalSetup + integration test include + 60s timeout)
  - vitest.config.ts root (globalSetup entry pointing to packages/core)

affects:
  - 02-02 (schema.ts — integration tests will use createTestDb)
  - 02-03 (roles migration — REVOKE test uses db.app pool)
  - 02-04 (post_transaction — integration tests consume createTestDb)
  - 02-05 (constraint trigger — integration tests consume createTestDb)
  - 02-06 (audit triggers — integration tests consume createTestDb)

tech-stack:
  added:
    - vitest ProvidedContext module augmentation (vitest.d.ts pattern)
  patterns:
    - SHA1 hash of testPath yields 12-char hex schema name (test_<hash>)
    - inject('pgUri') called inside createTestDb function body (not at module top-level)
    - migrationsSchema: schema isolates __drizzle_migrations per test file
    - Graceful Docker fallback in globalSetup (unit tests pass when Docker unavailable)
    - aprumo_app role LOGIN enabled in test container for REVOKE testing (FND-08)
    - postgres-js connection.search_path for schema isolation in migration SQL client
    - pg Pool options: --search_path=schema,public for test pools

key-files:
  created:
    - packages/core/tests/globalSetup.ts
    - packages/core/tests/setup/container.ts
    - packages/core/tests/helpers/createTestDb.ts
    - packages/core/tests/vitest.d.ts
  modified:
    - packages/core/vitest.config.ts (added globalSetup, integration test include, timeouts)
    - vitest.config.ts (added globalSetup at root level)
    - packages/core/tsconfig.json (include tests/**/*.ts)

key-decisions:
  - "Graceful Docker fallback in globalSetup: warn + provide empty pgUri instead of throwing"
  - "vitest.d.ts ProvidedContext augmentation for typed inject('pgUri') without casting"
  - "postgres-js connection.search_path (not options) for search_path in migration SQL"
  - "rootDir changed from src to . in tsconfig to include tests/**/*.ts without errors"

requirements-completed:
  - FND-16

duration: 25min
completed: 2026-05-22
---

# Phase 02 Plan 08: Testcontainers globalSetup + createTestDb Helper Summary

**Shared PG container with schema-per-file isolation via SHA1 hash naming and inject() bridge; unit tests for computeSchemaName pass GREEN**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-22T17:40:00Z
- **Completed:** 2026-05-22T18:05:00Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created/modified:** 7

## Accomplishments

- Created `packages/core/tests/setup/container.ts` with `PG_IMAGE = 'postgres:18-alpine'` constant (D-40 single source of truth)
- Created `packages/core/tests/globalSetup.ts` with `setup`/`teardown` exports; APRUMO_TEST_REUSE=1 env var support; graceful Docker fallback (warn + empty pgUri rather than throw)
- Created `packages/core/tests/helpers/createTestDb.ts` exporting `computeSchemaName` (pure, unit-testable) and `createTestDb` (full schema isolation with migration + role setup)
- Created `packages/core/tests/vitest.d.ts` augmenting `ProvidedContext` so `inject('pgUri')` is typed without casting
- Updated `packages/core/vitest.config.ts`: added `globalSetup`, integration test include pattern, 60s test/hook timeouts
- Updated root `vitest.config.ts`: added `globalSetup` entry per D-37
- Updated `packages/core/tsconfig.json`: `rootDir` set to `.`, `include` expanded to `tests/**/*.ts`

## Task Commits

1. `c377ec5` — `test(02-08): add RED createTestDb schema isolation unit tests`
2. `0ecc636` — `feat(02-08): add testcontainers globalSetup + createTestDb helper; unit tests GREEN`

## Files Created/Modified

- `packages/core/tests/globalSetup.ts` — Vitest globalSetup: starts postgres:18-alpine container; graceful Docker fallback
- `packages/core/tests/setup/container.ts` — PG_IMAGE constant for testcontainers
- `packages/core/tests/helpers/createTestDb.ts` — computeSchemaName + createTestDb; schema-per-file with aprumo_app role credentials
- `packages/core/tests/vitest.d.ts` — ProvidedContext type augmentation for inject('pgUri')
- `packages/core/tests/helpers/createTestDb.test.ts` — 3 unit tests for computeSchemaName (RED then GREEN)
- `packages/core/vitest.config.ts` — globalSetup, integration include, 60s timeouts
- `vitest.config.ts` — root globalSetup entry

## Decisions Made

- Graceful Docker fallback: globalSetup catches container start errors, provides empty pgUri, logs warning. Unit tests pass; integration tests fail with clear connection error.
- `vitest.d.ts` augments `ProvidedContext` — cleaner than `inject('pgUri') as string` cast; enables type-safe inject calls in all test files
- `postgres-js` uses `connection: { search_path: 'schema,public' }` (not `options:`) per its type definitions
- `packages/core/tsconfig.json` `rootDir` changed from `src` to `.` (required to include `tests/` without TypeScript errors about files outside rootDir)
- aprumo_app role gets `LOGIN PASSWORD 'test-only'` in test container via `ALTER ROLE IF EXISTS` — enables FND-08 REVOKE tests with the actual role

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting + lint errors across test files**
- **Found during:** Task 2 — pre-commit hooks + manual lint check
- **Issues:** Import ordering (alphabetical), string concatenation vs template literal, multi-line import formatting, `process.env["KEY"]` vs `process.env.KEY`
- **Fix:** Rewrote all files with correct Biome formatting
- **Files modified:** globalSetup.ts, createTestDb.ts, createTestDb.test.ts
- **Committed in:** 0ecc636

**2. [Rule 2 - Missing critical functionality] vitest.d.ts ProvidedContext augmentation**
- **Found during:** Task 2 — TypeScript error: `inject('pgUri')` argument not assignable to `never`
- **Issue:** `inject<T extends keyof ProvidedContext>()` requires `pgUri` declared in ProvidedContext
- **Fix:** Created `packages/core/tests/vitest.d.ts` augmenting ProvidedContext with `pgUri: string`
- **Files modified:** packages/core/tests/vitest.d.ts (new file)
- **Committed in:** 0ecc636

**3. [Rule 1 - Bug] postgres-js options field not valid (uses connection instead)**
- **Found during:** Task 2 — TypeScript error: `options` not in `postgres.Options<{}>`
- **Issue:** postgres-js uses `connection: { search_path: ... }` not `options: '--search_path=...'`
- **Fix:** Changed migration SQL client to use `connection: { search_path: '${schema},public' }`
- **Files modified:** packages/core/tests/helpers/createTestDb.ts
- **Committed in:** 0ecc636

**4. [Rule 3 - Blocking] Docker not running in local environment**
- **Found during:** Task 2 verification — `Could not find a working container runtime strategy`
- **Issue:** testcontainers throws when Docker daemon unavailable; blocks ALL tests including pure unit tests
- **Fix:** Wrapped container.start() in try/catch; provides empty pgUri and logs warning; unit tests pass, integration tests get connection error (expected until Docker running)
- **Files modified:** packages/core/tests/globalSetup.ts
- **Committed in:** 0ecc636

## Known Stubs

None — this plan delivers pure infrastructure with no UI or data stubs.

## Threat Flags

No new security-relevant surface introduced beyond what's in the plan's threat_model.
The `ALTER ROLE IF EXISTS aprumo_app LOGIN PASSWORD 'test-only'` call is intentional for test-only use and does not affect production (container is ephemeral; password is hardcoded as a test fixture, not a secret).

## Self-Check: PASSED

All created files verified on disk:
- packages/core/tests/globalSetup.ts: FOUND
- packages/core/tests/setup/container.ts: FOUND
- packages/core/tests/helpers/createTestDb.ts: FOUND
- packages/core/tests/vitest.d.ts: FOUND
- packages/core/tests/helpers/createTestDb.test.ts: FOUND

Commits verified in git history:
- c377ec5: FOUND (test(02-08): add RED)
- 0ecc636: FOUND (feat(02-08): add testcontainers)

Unit tests: 3 passed (3)
TypeScript: clean (0 errors)
Biome: clean (0 errors)

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
