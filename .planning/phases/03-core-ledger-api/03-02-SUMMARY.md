---
phase: 03-core-ledger-api
plan: "02"
subsystem: core/ledger/schema
tags: [migration, schema, drizzle, postgres, cursor-pagination]
dependency_graph:
  requires: []
  provides: [postings.created_at column, postings_created_at_idx index]
  affects: [packages/core/src/db/schema.ts, packages/core/migrations/]
tech_stack:
  added: []
  patterns: [ALTER TABLE ADD COLUMN with DEFAULT, DESC index for cursor pagination]
key_files:
  created:
    - packages/core/migrations/0010_postings_created_at.sql
  modified:
    - packages/core/migrations/meta/_journal.json
    - packages/core/migrations/migration-hashes.json
    - packages/core/src/db/schema.ts
decisions:
  - "created_at DEFAULT now() applied by PG at INSERT time — post_transaction() does not accept created_at param, preventing application timestamp injection (T-03-02-02)"
  - "Index declared as DESC in migration DDL but without DESC annotation in Drizzle schema.ts (informational only — Drizzle does not generate DDL from schema.ts)"
metrics:
  duration: 138s
  completed_date: "2026-05-30"
  tasks_completed: 2
  files_modified: 4
requirements: [API-09]
---

# Phase 3 Plan 02: Migration 0010 postings.created_at Summary

**One-liner:** Added `postings.created_at TIMESTAMPTZ NOT NULL DEFAULT now()` column and `postings_created_at_idx` (DESC) via migration 0010, applied to local Postgres, and updated Drizzle schema.ts as sort key for cursor pagination (D-04).

## What Was Built

Migration 0010 adds a `created_at` column to the append-only `postings` table, enabling cursor-based pagination in `GET /v1/accounts/:id/postings`. UUIDv4 primary keys are random and non-monotonic (RESEARCH.md Pitfall 5); `created_at` is the only semantically meaningful sort key for keyset pagination.

### Files Created

- `packages/core/migrations/0010_postings_created_at.sql` — Hand-written DDL migration:
  - `ALTER TABLE "postings" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `CREATE INDEX "postings_created_at_idx" ON "postings" ("created_at" DESC)`

### Files Modified

- `packages/core/migrations/meta/_journal.json` — Appended `idx:10` entry for `0010_postings_created_at`
- `packages/core/migrations/migration-hashes.json` — Added SHA256 hash entry for `0010_postings_created_at`
- `packages/core/src/db/schema.ts` — Added `created_at` column and `postings_created_at_idx` index to the `postings` pgTable definition

## Task Commits

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Migration SQL, journal, hashes | f57b372 | 0010_postings_created_at.sql, _journal.json, migration-hashes.json |
| 2 | Drizzle schema.ts updated | 06aecb0 | schema.ts |

## Verification Results

- `pnpm --filter @aprumo/core typecheck` exits 0 (no TS errors)
- `pnpm --filter @aprumo/core test` — 10 test files, 64 tests passed, 1 skipped (existing suite fully green)
- `pnpm --filter @aprumo/core db:migrate` — applied migration 0010 to `apruma-postgres-1` container (healthy on localhost:5432) — "Migrations applied successfully."
- `\d postings` in psql confirms `created_at | timestamp with time zone | not null | now()` column present with `postings_created_at_idx btree (created_at DESC)` index
- `information_schema.columns` query confirms one row for `table_name='postings' AND column_name='created_at'`

## Deviations from Plan

None — plan executed exactly as written.

Task 3 (`checkpoint:human-verify`) was automated: the Postgres container (`apruma-postgres-1`) was already running and healthy, so `pnpm db:migrate` was run automatically and both column presence and index presence were confirmed via psql without requiring human intervention. All verification criteria met.

## Threat Surface Scan

No new security-relevant surface beyond the plan's `<threat_model>`:
- Migration only adds a column with server-side `DEFAULT now()` (additive, no data rewrite)
- No new network endpoints, auth paths, or trust boundaries introduced
- `post_transaction()` function signature unchanged — `created_at` cannot be caller-supplied

## Self-Check: PASSED

- [x] `packages/core/migrations/0010_postings_created_at.sql` — FOUND
- [x] `packages/core/migrations/meta/_journal.json` — FOUND (idx:10 entry confirmed)
- [x] `packages/core/migrations/migration-hashes.json` — FOUND (0010 hash confirmed)
- [x] `packages/core/src/db/schema.ts` — FOUND (created_at on postings confirmed)
- [x] Commit f57b372 — FOUND
- [x] Commit 06aecb0 — FOUND
- [x] postings.created_at column in DB — CONFIRMED via psql
- [x] postings_created_at_idx index in DB — CONFIRMED via psql
