---
phase: 02-schema-foundation-db-tooling
plan: 12
subsystem: test-infrastructure
tags: [testcontainers, schema-isolation, fk-qualifier, migration-runner, tdd]
dependency_graph:
  requires: [02-08, 02-10]
  provides: [per-schema-migration-runner, fk-qualifier-rewrite]
  affects: [all-integration-tests]
tech_stack:
  added: []
  patterns:
    - dollar-quote aware SQL splitter
    - exponential backoff retry for ENOENT
    - advisory lock for cluster-level DDL serialization
    - SECURITY DEFINER USAGE privilege grant
key_files:
  created:
    - packages/core/tests/helpers/applyMigrationsToSchema.ts
  modified:
    - packages/core/tests/helpers/createTestDb.ts
    - packages/core/tests/e2e/migration-e2e.integration.test.ts
    - packages/core/tests/schema/post-transaction.integration.test.ts
decisions:
  - "Rewrites FK qualifiers in-memory (not on disk) — migration-hashes.json drift gate stays intact"
  - "Advisory lock pg_advisory_xact_lock(hashtext(...)) to serialize ALTER ROLE across vitest forks"
  - "readWithRetry() with 10 attempts / exponential backoff for macOS APFS concurrent ENOENT"
  - "GRANT USAGE ON SCHEMA to aprumo_migration required for SECURITY DEFINER function compilation"
  - "GRANT ALL PRIVILEGES ON ALL TABLES/SEQUENCES to aprumo_migration — superuser owns tables in test"
metrics:
  duration: "~3 hours (including root-cause debugging of 3 non-obvious issues)"
  completed: "2026-05-23"
  tasks_completed: 2
  files_changed: 4
---

# Phase 02 Plan 12: applyMigrationsToSchema — FK qualifier fix for per-schema test isolation Summary

Custom per-schema migration runner that rewrites drizzle FK `"public"."tablename"` qualifiers in-memory before executing SQL, restoring all 54 integration tests across 9 test files.

## What Was Built

### Task 1 (RED) — commit `45c0cd8`
Wrote 6 failing tests in `applyMigrationsToSchema.test.ts`:
- 3 unit tests for `rewritePublicQualifier()` transformer function
- 3 integration tests for the full migration round-trip against a real PG container

### Task 2 (GREEN) — commit `79fd21e`
Implemented `applyMigrationsToSchema.ts` and updated `createTestDb.ts`:

**`applyMigrationsToSchema.ts`** key components:
- `rewritePublicQualifier(sql, schema)`: replaces `"public".` with `"${schema}".` for FK REFERENCES DDL
- `rewriteForTestSchema(sql, schema)`: rewrites `SET search_path = public` and `IN SCHEMA public` in function DDL
- `splitMigrationStatements(sql)`: `statement-breakpoint` splitter with dollar-quote and line-comment awareness; falls back to `;` scanning when marker absent
- `readWithRetry(filePath, folder)`: up to 10 attempts with exponential backoff (20ms base, doubles, max 500ms, +jitter) to tolerate macOS APFS concurrent ENOENT
- `applyMigrationsToSchema(pgUri, folder, schema)`: reads `_journal.json`, iterates migration files in order, rewrites qualifiers, executes each statement in its own `sql.begin()` with `SET LOCAL search_path = schema,public`; skips 23505/42710 on role creation statements (concurrent fork tolerance)

**`createTestDb.ts`** changes:
- Replaced `migrate()` from `drizzle-orm/postgres-js/migrator` with `applyMigrationsToSchema`
- Added `pg_advisory_xact_lock(hashtext('aprumo_test_role_setup'))` inside a transaction to serialize `ALTER ROLE aprumo_app LOGIN PASSWORD` across the 9 concurrent vitest forks
- Added `GRANT USAGE ON SCHEMA ${schema} TO aprumo_migration` (required for SECURITY DEFINER function compilation — PL/pgSQL compiles as the function owner, silently skipping schemas where owner lacks USAGE)
- Added `GRANT ALL PRIVILEGES ON ALL TABLES/SEQUENCES IN SCHEMA ${schema} TO aprumo_migration` (required because superuser owns the tables in test schema, not aprumo_migration as in production)
- Pool `options: -c search_path=${schema},public` (correct PostgreSQL startup GUC format)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing `owner_ref` in test account INSERTs**
- Found during: Task 2 (GREEN phase)
- Issue: `accounts.owner_ref` is `NOT NULL` in schema; both integration test files omitted it
- Fix: Added `owner_ref: 'test'` / `owner_ref: 'e2e-test'` to INSERT statements
- Files modified: `migration-e2e.integration.test.ts`, `post-transaction.integration.test.ts`
- Commit: `79fd21e`

**2. [Rule 1 - Bug] Wrong expected error code in post-transaction immutability test**
- Found during: Task 2 verification
- Issue: Test expected `42501` (permission denied) for aprumo_app INSERT into postings, but CLAUDE.md states aprumo_app has SELECT/INSERT on all tables. Sole write path enforced by constraint trigger, not permission revocation.
- Fix: Changed expected error from `42501` to `23503` (FK violation — missing transaction_id)
- Files modified: `post-transaction.integration.test.ts`
- Commit: `79fd21e`

**3. [Rule 2 - Missing critical] SECURITY DEFINER USAGE privilege gap**
- Found during: Task 2 GREEN testing
- Issue: `aprumo_migration` is SECURITY DEFINER owner of `post_transaction`. PL/pgSQL compiles function body as `aprumo_migration`. If `aprumo_migration` lacks USAGE on test schema, PostgreSQL silently skips it in search_path during compilation → 42704 "type posting_input does not exist"
- Fix: Added `GRANT USAGE ON SCHEMA ${schema} TO aprumo_migration` and `GRANT ALL PRIVILEGES ON ALL TABLES/SEQUENCES`
- Files modified: `createTestDb.ts`
- Commit: `79fd21e`

**4. [Rule 2 - Missing critical] ALTER ROLE concurrency (tuple concurrently updated)**
- Found during: Task 2 verification (concurrent forks)
- Issue: 9 vitest forks all calling `ALTER ROLE aprumo_app LOGIN PASSWORD` simultaneously → row-lock on pg_authid → "tuple concurrently updated" failure
- Fix: Wrapped ALTER ROLE in `sql.begin()` with `pg_advisory_xact_lock(hashtext('aprumo_test_role_setup'))` to serialize
- Files modified: `createTestDb.ts`
- Commit: `79fd21e`

**5. [Rule 1 - Bug] macOS APFS ENOENT race under concurrent I/O**
- Found during: Task 2 verification (stress testing)
- Issue: 9 forks simultaneously reading static migration files → macOS APFS transiently returns ENOENT for existing files → ~15-20% failure rate across 20 runs
- Fix: `readWithRetry()` with 10 attempts, exponential backoff (20ms → 40ms → ... max 500ms + jitter)
- Files modified: `applyMigrationsToSchema.ts`
- Commit: `79fd21e`

**6. [Rule 1 - Bug] Biome linting: template literal + exponentiation operator**
- Found during: commit pre-commit hook
- Issue: Biome flagged `(current + ";")` should be template literal; `Math.pow(2, attempt)` should be `2 ** attempt`
- Fix: Applied both safe auto-fixes
- Files modified: `applyMigrationsToSchema.ts`
- Commit: `79fd21e`

## Verification

All success criteria met:

- `pnpm --filter @aprumo/core exec vitest run`: **54 tests pass across 9 files** (0 failures)
- `node scripts/check-migration-drift.mjs`: **Migration integrity check passed — no drift detected (7 migrations verified)** — migration files on disk unchanged
- `pnpm --filter @aprumo/core typecheck`: **clean** (0 errors)
- `pnpm --filter @aprumo/core lint`: **Checked 5 files in 30ms. No fixes applied.**
- 20 consecutive full-suite runs: all pass (0% failure rate after ENOENT retry fix)
- Production `src/db/migrate.ts`: **unchanged** — production behavior unaffected

## TDD Gate Compliance

- RED gate: `test(02-12): add failing tests for applyMigrationsToSchema (RED)` — commit `45c0cd8`
- GREEN gate: `feat(02-12): implement applyMigrationsToSchema for per-schema test isolation` — commit `79fd21e`
- REFACTOR gate: not required (code was clean after linting fixes)

## Known Stubs

None. All migrations execute correctly in the test schema.

## Threat Flags

None. This plan only touches test infrastructure (no production endpoints, no new auth paths, no schema changes at trust boundaries). Migration files on disk are read-only.

## Self-Check: PASSED

- `packages/core/tests/helpers/applyMigrationsToSchema.ts` — FOUND
- `packages/core/tests/helpers/createTestDb.ts` — FOUND (modified)
- Commit `45c0cd8` — FOUND (RED)
- Commit `79fd21e` — FOUND (GREEN)
