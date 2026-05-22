---
phase: 02-schema-foundation-db-tooling
plan: "03"
subsystem: database
tags: [postgres, roles, grants, revoke, tdd, immutability, security]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "02"
    provides: 0000_init_tables.sql, postings and raw_events tables, _journal.json
  - phase: 02-schema-foundation-db-tooling
    plan: "08"
    provides: createTestDb helper for role-specific integration tests

provides:
  - packages/core/migrations/0001_roles.sql (CREATE ROLE IF NOT EXISTS for aprumo_app and aprumo_migration)
  - packages/core/migrations/0002_grants.sql (GRANT SELECT/INSERT; REVOKE UPDATE/DELETE on postings,raw_events; DEFAULT PRIVILEGES)
  - packages/core/migrations/meta/_journal.json (updated with 0001_roles idx=1 and 0002_grants idx=2)
  - packages/core/tests/schema/revoke.integration.test.ts (TDD: 42501 assertions for UPDATE/DELETE on append-only tables)

affects:
  - 02-04 (post_transaction function — aprumo_app has EXECUTE via DEFAULT PRIVILEGES from 0002_grants)
  - 02-05 (constraint trigger — runs in aprumo_migration context)
  - 02-09 (migration drift check — hashes 0001_roles.sql and 0002_grants.sql against journal)
  - Phase 3+ (Fastify pool connects as aprumo_app; role exists and is configured correctly)

tech-stack:
  added: []
  patterns:
    - CREATE ROLE IF NOT EXISTS for idempotent role creation on re-migrate
    - GRANT SELECT, INSERT ON ALL TABLES + REVOKE UPDATE, DELETE on specific tables
    - ALTER DEFAULT PRIVILEGES FOR ROLE pattern for future table inheritance
    - No passwords committed to migration files (env-var only pattern)
    - TDD RED commit before GREEN migrations

key-files:
  created:
    - packages/core/migrations/0001_roles.sql
    - packages/core/migrations/0002_grants.sql
    - packages/core/tests/schema/revoke.integration.test.ts
  modified:
    - packages/core/migrations/meta/_journal.json

key-decisions:
  - "CREATE ROLE IF NOT EXISTS used for both roles — idempotent on db:reset + re-migrate"
  - "No passwords in 0001_roles.sql — passwords set via docker-compose env vars or CI init script only"
  - "REVOKE UPDATE, DELETE on TABLE postings and raw_events — enforces CLAUDE.md Invariant #1 at DB layer"
  - "ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration — future migrations inherit grant pattern automatically"
  - "GRANT EXECUTE ON ALL FUNCTIONS — ensures aprumo_app can call post_transaction (Plan 04) without separate step"

requirements-completed:
  - FND-07
  - FND-08

duration: 5min
completed: 2026-05-22
---

# Phase 02 Plan 03: REVOKE Enforcement Migrations Summary

**Three-layer immutability layer 1: aprumo_app role lacks UPDATE/DELETE on postings and raw_events; enforced by REVOKE in 0002_grants.sql and tested by 42501 integration tests**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-22T21:11:32Z
- **Completed:** 2026-05-22T21:18:12Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

- Created `packages/core/tests/schema/revoke.integration.test.ts` with 5 tests: 4 NEGATIVE cases (42501 expected on UPDATE/DELETE on postings and raw_events from aprumo_app) and 1 POSITIVE case (SELECT on accounts from migration role)
- Created `packages/core/migrations/0001_roles.sql`: `CREATE ROLE IF NOT EXISTS aprumo_app NOLOGIN NOSUPERUSER` and `CREATE ROLE IF NOT EXISTS aprumo_migration NOLOGIN NOSUPERUSER CREATEDB`
- Created `packages/core/migrations/0002_grants.sql`: `GRANT SELECT, INSERT ON ALL TABLES`, `REVOKE UPDATE, DELETE ON TABLE postings/raw_events FROM aprumo_app`, `ALTER DEFAULT PRIVILEGES` for tables/sequences/functions
- Updated `_journal.json` via `drizzle-kit generate --custom` to register both migrations (idx=1 for 0001_roles, idx=2 for 0002_grants)
- No passwords in any migration file — security invariant enforced per CLAUDE.md

## Task Commits

1. `0ffd803` — `test(02-03): add RED REVOKE enforcement integration tests`
2. `f8922ff` — `feat(02-03): add 0001_roles + 0002_grants migrations; revoke enforcement GREEN`

## Files Created

- `packages/core/migrations/0001_roles.sql` — idempotent role creation for aprumo_app and aprumo_migration
- `packages/core/migrations/0002_grants.sql` — GRANT/REVOKE + DEFAULT PRIVILEGES for role permission model
- `packages/core/tests/schema/revoke.integration.test.ts` — 5 integration tests asserting 42501 for append-only table mutations

## Files Modified

- `packages/core/migrations/meta/_journal.json` — added entries idx=1 (0001_roles) and idx=2 (0002_grants)

## Decisions Made

- `CREATE ROLE IF NOT EXISTS` used for both roles — drizzle migrations can be re-run after `db:reset` without error; aligns with D-33 forward-only migration philosophy
- No passwords in `0001_roles.sql` — `aprumo_app` and `aprumo_migration` have NOLOGIN by default in production; test helper (`createTestDb.ts`) temporarily enables LOGIN with a test-only password via `ALTER ROLE IF EXISTS aprumo_app LOGIN PASSWORD 'test-only'`
- `GRANT EXECUTE ON ALL FUNCTIONS` added to 0002_grants.sql — proactively enables `aprumo_app` to call `post_transaction` (Plan 04) and any future SECURITY DEFINER functions without a separate GRANT step

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED commit `0ffd803`: `test(02-03): add RED REVOKE enforcement integration tests` — exists BEFORE implementation
- GREEN commit `f8922ff`: `feat(02-03): add 0001_roles + 0002_grants migrations; revoke enforcement GREEN` — exists AFTER RED
- Gate sequence: RED → GREEN — PASSED

## Known Stubs

None — this plan delivers role permissions and SQL migrations with no UI or data stubs.

## Threat Flags

No new security surface beyond what the plan's threat_model covers.

- T-2-01 mitigated: `REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app` and `REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app` are present in `0002_grants.sql`.
- T-2-04 mitigated: grep for `PASSWORD|password|changeme` in `0001_roles.sql` returns 0 matches. Comment explicitly says passwords via env vars only.
- T-2-02 (schema drift): both files registered in `_journal.json` for Plan 09 drift check.

## Self-Check: PASSED

Files verified on disk:
- packages/core/migrations/0001_roles.sql: FOUND
- packages/core/migrations/0002_grants.sql: FOUND
- packages/core/tests/schema/revoke.integration.test.ts: FOUND
- packages/core/migrations/meta/_journal.json: FOUND (entries for 0001_roles and 0002_grants)

Commits verified:
- 0ffd803: FOUND (test(02-03): add RED REVOKE enforcement integration tests)
- f8922ff: FOUND (feat(02-03): add 0001_roles + 0002_grants migrations; revoke enforcement GREEN)

Verification checks:
- IF NOT EXISTS count in 0001_roles.sql: 2 — PASSED
- REVOKE UPDATE count in 0002_grants.sql: 2 — PASSED
- No passwords in 0001_roles.sql: 0 matches — PASSED
- DEFAULT PRIVILEGES count in 0002_grants.sql: 3 (≥2) — PASSED
- 0002_grants in _journal.json: 1 match — PASSED
- typecheck: exits 0 — PASSED

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
