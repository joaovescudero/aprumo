---
phase: 02-schema-foundation-db-tooling
plan: "01"
subsystem: database
tags: [drizzle-orm, drizzle-kit, postgres, testcontainers, docker-compose, migrations]

requires:
  - phase: 01-monorepo-scaffold-ci-dev-security
    provides: pnpm workspaces, @aprumo/core package stub, Biome lint config, lefthook pre-commit hooks

provides:
  - drizzle-orm + postgres runtime deps in @aprumo/core
  - drizzle-kit + testcontainers + pg devDeps in @aprumo/core
  - packages/core/drizzle.config.ts (dialect=postgresql, schema/migrations paths)
  - packages/core/src/db/migrate.ts (programmatic runner, importable + CLI)
  - packages/core/src/db/reset.ts (dev-only drop+recreate, NODE_ENV production guard)
  - root + @aprumo/core db:migrate/reset/generate/seed scripts
  - docker-compose.yml with postgres:18-alpine, healthcheck, named volume, autovacuum_naptime=10
  - .env.example with DATABASE_URL template (no real secrets)

affects:
  - 02-02 (schema.ts + drizzle-kit generate — consumes drizzle.config.ts)
  - 02-03 (hand-written migrations — consumes migrations/ dir + _journal.json pattern)
  - 02-08 (testcontainers setup — consumes @testcontainers/postgresql installed here)
  - all subsequent phase 2 plans (foundation tooling)

tech-stack:
  added:
    - drizzle-orm@^0.45.2 (runtime)
    - postgres@^3.4.9 (runtime, postgres-js driver)
    - drizzle-kit@^0.31.10 (devDep, CLI + code gen)
    - "@testcontainers/postgresql@^12.0.0" (devDep)
    - testcontainers@^12.0.0 (devDep)
    - pg@^8.21.0 (devDep, node-postgres for test role pools)
    - "@types/pg@^8.20.0" (devDep)
    - tsx@^4.22.3 (devDep, ESM script runner)
  patterns:
    - programmatic Drizzle migrator with max:1 connection requirement
    - NODE_ENV production guard on destructive db:reset
    - postgres-js identifier injection for safe SQL DROP/CREATE DATABASE
    - pnpm --filter @aprumo/core delegation pattern for root db:* scripts
    - ESM isMain detection via import.meta.url vs argv[1] path resolution

key-files:
  created:
    - packages/core/drizzle.config.ts
    - packages/core/src/db/migrate.ts
    - packages/core/src/db/reset.ts
    - docker-compose.yml
    - .env.example
  modified:
    - packages/core/package.json (added deps, scripts, migrations to files[])
    - package.json (replaced placeholder db:migrate, added db:reset/generate/seed)
    - pnpm-lock.yaml (lockfile updated with new deps)

key-decisions:
  - "postgres:18-alpine chosen per D-40 for docker-compose (same image as testcontainers)"
  - "migrate.ts max:1 connection enforced per drizzle-orm/postgres-js/migrator requirement"
  - "reset.ts connects to system 'postgres' DB to DROP/CREATE app DB without needing superuser on app DB"
  - "NODE_ENV=production guard on db:reset prevents accidental production data loss"
  - "ESM isMain pattern (import.meta.url vs argv[1]) used instead of CJS __filename comparison"

patterns-established:
  - "Pattern: root scripts delegate via pnpm --filter @aprumo/core <script>"
  - "Pattern: migrate.ts is both importable (runMigrations()) and CLI-executable"
  - "Pattern: .env.example uses 'changeme' placeholder; gitleaks allowlists .example$ extension"

requirements-completed:
  - FND-12
  - FND-13

duration: 20min
completed: 2026-05-22
---

# Phase 02 Plan 01: DB Tooling Foundation Summary

**drizzle-orm/drizzle-kit/testcontainers installed in @aprumo/core with programmatic migrate.ts, dev-only reset.ts, postgres:18-alpine docker-compose, and root db:* script delegation**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-22T21:30:00Z
- **Completed:** 2026-05-22T21:50:00Z
- **Tasks:** 2 (1 checkpoint approved, 1 auto)
- **Files modified:** 8

## Accomplishments

- Installed all 7 required packages (drizzle-orm, postgres, drizzle-kit, @testcontainers/postgresql, testcontainers, pg, @types/pg, tsx) into @aprumo/core with correct runtime/devDep split
- Created drizzle.config.ts (dialect=postgresql, schema=./src/db/schema.ts, out=./migrations) — foundation for drizzle-kit generate in plan 02-02
- Created programmatic migrate.ts (importable as runMigrations() + CLI via tsx) using max:1 connection as required by migrator internals
- Created reset.ts with NODE_ENV=production guard and postgres-js identifier injection for safe DROP/CREATE DATABASE
- Created docker-compose.yml (postgres:18-alpine, healthcheck, named pgdata volume, autovacuum_naptime=10 for pg-boss FND-12)
- Created .env.example with DATABASE_URL + POSTGRES_PASSWORD placeholders (no real secrets; gitleaks .example$ allowlist confirmed)
- Wired db:migrate, db:reset, db:generate, db:seed to root package.json (replacing placeholder) and @aprumo/core package.json
- Updated packages/core files[] to include "migrations" for npm tarball publication

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify package legitimacy before install** — human checkpoint approved ("packages approved")
2. **Task 2: Install dependencies and wire drizzle.config.ts + root scripts** — `cbb131f` (chore)

**Plan metadata:** (committed with SUMMARY.md below)

## Files Created/Modified

- `packages/core/drizzle.config.ts` — Drizzle config: dialect=postgresql, schema/migrations paths
- `packages/core/src/db/migrate.ts` — Programmatic migration runner (importable + CLI, max:1 connection)
- `packages/core/src/db/reset.ts` — Dev-only DB drop+recreate with production guard
- `docker-compose.yml` — postgres:18-alpine service with healthcheck + named volume
- `.env.example` — DATABASE_URL + POSTGRES_PASSWORD template (no real secrets)
- `packages/core/package.json` — Added deps, scripts (db:migrate/reset/generate/seed), migrations in files[]
- `package.json` — Replaced placeholder db:migrate; added db:reset, db:generate, db:seed as filter delegates
- `pnpm-lock.yaml` — Updated with all new dependencies

## Decisions Made

- postgres:18-alpine per D-40 (same image for docker-compose and testcontainers — reproducibility)
- max:1 connection in migrate.ts per drizzle-orm/postgres-js/migrator requirement (verified in RESEARCH.md anti-patterns)
- reset.ts connects to system "postgres" DB to DROP/CREATE target, avoiding need for superuser on app DB
- isMain detection uses ESM pattern (import.meta.url resolved against process.argv[1]) — compatible with tsx runner

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting + lint errors in migrate.ts, reset.ts, drizzle.config.ts**
- **Found during:** Task 2 — pre-commit hook caught issues
- **Issue:** Single-quote strings instead of double-quotes, bracket-notation env access (process.env['KEY'] vs process.env.KEY), multi-line isMain expression that Biome collapsed to one line, tab indentation instead of 2-space
- **Fix:** Rewrote all three files with correct Biome formatting (double-quotes, literal key access, 2-space indent, single-line isMain)
- **Files modified:** packages/core/drizzle.config.ts, packages/core/src/db/migrate.ts, packages/core/src/db/reset.ts
- **Verification:** `./node_modules/.bin/biome check` reported 0 errors on all 3 files
- **Committed in:** cbb131f (same task commit after fix)

---

**Total deviations:** 1 auto-fixed (Rule 1 — formatting/lint)
**Impact on plan:** Fix necessary to pass pre-commit hooks; no scope change.

## Issues Encountered

- First commit attempt rejected by lefthook/biome pre-commit hook due to formatting issues. Fixed inline per Rule 1 and committed successfully on second attempt.

## User Setup Required

None — no external service configuration required beyond what's documented in .env.example.

## Next Phase Readiness

- drizzle.config.ts ready for `pnpm db:generate` once schema.ts exists (Plan 02-02)
- testcontainers packages installed; globalSetup pattern ready for Plan 02-08
- docker-compose.yml ready: `docker compose up -d postgres` can be run immediately
- All root db:* scripts wired; `pnpm db:migrate` will work after migrations/ directory is populated

## Self-Check: PASSED

All 5 created files verified on disk. Commit cbb131f found in git history.

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
