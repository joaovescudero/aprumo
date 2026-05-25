---
status: diagnosed
phase: 02-schema-foundation-db-tooling
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md, 02-13-SUMMARY.md]
started: 2026-05-23T02:30:44Z
updated: 2026-05-25T09:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean state (`docker compose down -v` then `docker compose up -d postgres`), `pnpm db:migrate` runs to completion. All 7 migrations apply, exit code 0, no errors.
result: pass

### 2. All 10 Ledger Tables Present
expected: After migrate, `psql $DATABASE_URL -c "\dt"` shows: accounts, transactions, postings, raw_events, account_balance, outbound_endpoints, outbound_events, accounts_audit, outbound_endpoints_audit, outbound_events_audit.
result: pass

### 3. pnpm db:reset Works
expected: `pnpm db:reset` drops and recreates schema cleanly (dev-only, NODE_ENV guard). Re-runs migrations afterward. Exit 0.
result: pass

### 4. pnpm db:seed Inserts Dev Data
expected: `pnpm db:seed` runs 0006_seed_dev.sql — creates 2 accounts + 1 balanced transaction via `post_transaction` (no direct postings INSERT). `SELECT count(*) FROM transactions;` returns 1.
result: pass

### 5. Integration Tests Pass (testcontainers)
expected: `pnpm --filter @aprumo/core test` spins up postgres:18-alpine via testcontainers globalSetup, all integration tests pass (schema-shape, revoke, post-transaction, constraint-trigger, audit-triggers, migration-drift).
result: issue
reported: "Re-tested 2026-05-25 after 02-12 (FK schema rewrite) merged. First gap CLOSED — applyMigrationsToSchema rewrites public. qualifier per schema. NEW failure surfaced: 4 suites FAIL with PostgresError 'duplicate key value violates unique constraint pg_authid_rolname_index' on CREATE ROLE in 0001_roles.sql. Cascade error: db.cleanup undefined in afterAll. Failed suites: tests/schema/audit-triggers, tests/schema/constraint-trigger, tests/schema/revoke, tests/schema/schema-shape. Tests passed: 32, skipped: 31."
severity: blocker

### 6. Migration Drift Check Passes Clean
expected: `node scripts/check-migration-drift.mjs` on unmodified repo exits 0 — SHA-256 of all 7 migrations matches `migration-hashes.json`.
result: pass

### 7. Immutability — aprumo_app Cannot UPDATE postings
expected: Connect as `aprumo_app` (via SET ROLE — roles are NOLOGIN) and run `UPDATE postings SET amount_cents=0;` → fails with SQLSTATE 42501 (insufficient_privilege).
result: pass
note: User confirmed "permission denied for table postings" — Postgres message for 42501.

### 8. Double-Entry Trigger Deferrable
expected: `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname='assert_double_entry';` → both `t` (DEFERRABLE INITIALLY DEFERRED).
result: pass

### 9. post_transaction Rejects Unbalanced
expected: Call `post_transaction` with postings whose signed sum ≠ 0 → raises P0001 with `double_entry_violation:` prefix.
result: pass

### 10. post_transaction Idempotent
expected: Call `post_transaction` twice with same `idempotency_key` → both return the same `transaction_id`, no duplicate row created.
result: pass

### 11. Audit Triggers Populate Shadow Tables
expected: `UPDATE accounts SET metadata='{}' WHERE id=...` → corresponding row appears in `accounts_audit` (op=UPDATE). DELETE also logs. INSERT does NOT log.
result: pass

### 12. ADRs 0001–0009 Present
expected: `ls docs/adr/` shows 0001-postgres-as-ledger-engine.md through 0009-drizzle-orm-migrations.md + README.md. Each renders as valid MADR 4.0.
result: pass
note: Auto-verified via ls — all 9 ADRs (0001-postgres-as-ledger-engine.md → 0009-drizzle-orm-migrations.md) + README.md present.

## Summary

total: 12
passed: 11
issues: 1
pending: 0
skipped: 0
blocked: 0
note: "Test 5 retested 2026-05-25. Gap-1 (FK schema) closed by 02-12. Gap-2 (CREATE ROLE race) new blocker."

## Gaps

- truth: "pnpm --filter @aprumo/core test passes via testcontainers globalSetup with all integration suites green (FK schema gap, closed by 02-12)"
  status: closed
  resolved_by: "02-12-PLAN.md commits 45c0cd8 (RED) → 79fd21e (GREEN) → fec9936 (docs). applyMigrationsToSchema rewrites public. qualifier per test schema before exec. Verified 2026-05-25 — FK error gone."
  reason: "User reported: 6 test suites FAIL, 42 tests SKIPPED. Drizzle migrate raises PostgresError 42P01 'relation public.accounts does not exist' when adding FK on account_balance."
  severity: blocker
  test: 5
  debug_session: "inline-diagnosis-2026-05-23"

- truth: "pnpm --filter @aprumo/core test passes via testcontainers globalSetup with all integration suites green (CREATE ROLE race)"
  status: failed
  reason: "Re-tested 2026-05-25 after 02-12 merged. 4 suites still FAIL — new root cause surfaced: parallel test files race on CREATE ROLE in 0001_roles.sql. pg_authid is cluster-global; IF NOT EXISTS guard is non-atomic across sessions. Failed: tests/schema/audit-triggers, constraint-trigger, revoke, schema-shape. Tests/helpers/applyMigrationsToSchema WR-02 also affected. 32 pass, 31 skipped."
  severity: blocker
  test: 5
  artifacts:
    - path: "packages/core/migrations/0001_roles.sql"
      issue: "DO block with IF NOT EXISTS check then CREATE ROLE — non-atomic across parallel sessions"
    - path: "packages/core/tests/globalSetup.ts"
      issue: "Starts container once but does not pre-create cluster-global roles; per-file applyMigrationsToSchema races on first run"
    - path: "packages/core/tests/helpers/applyMigrationsToSchema.ts"
      issue: "No exclusion or short-circuit for cluster-global DDL (CREATE ROLE) — applies 0001_roles.sql per schema in parallel"
  missing:
    - "Pre-create aprumo_app + aprumo_migration roles in globalSetup before any worker fork starts"
  root_cause: |
    Migration 0001_roles.sql uses `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aprumo_app') THEN CREATE ROLE aprumo_app … END IF; END $$`. The check and the CREATE are separate statements within the DO block; Postgres does not hold an exclusive lock on pg_authid across them. When N test files run applyMigrationsToSchema in parallel against an empty cluster, multiple sessions observe rolname missing, then both attempt CREATE ROLE → second one hits unique violation on pg_authid_rolname_index (SQLSTATE 23505). The cascade `TypeError: Cannot read properties of undefined (reading 'cleanup')` is the same pattern as gap-1: when applyMigrationsToSchema throws, createTestDb returns before the handle is built, so afterAll's `db.cleanup()` blows up.
  recommended_fix: |
    Pre-create cluster-global roles once in globalSetup, immediately after container.start() resolves. globalSetup runs before any worker fork — by the time per-file applyMigrationsToSchema reaches 0001_roles.sql, the IF NOT EXISTS check short-circuits, no CREATE attempted, no race. Steps:
      1. In packages/core/tests/globalSetup.ts, after `container = await builder.start();`, open a single admin connection and exec:
           CREATE ROLE aprumo_app NOLOGIN NOSUPERUSER;
           CREATE ROLE aprumo_migration NOLOGIN NOSUPERUSER CREATEDB;
         Wrap each in DO/EXCEPTION duplicate_object so reuse-mode (.withReuse) doesn't fail on second start.
      2. Close admin connection. Provide pgUri to workers as today.
      3. No change to migration files (hash gate intact). No change to applyMigrationsToSchema. No change to production migrate path.
      4. Add a failing test FIRST in tests/globalSetup.test.ts (or extend applyMigrationsToSchema.test.ts WR-02) that exercises parallel apply against a fresh container WITHOUT pre-creation — assert it currently throws 23505 (RED). Implement fix (GREEN). Re-assert.
      5. Run `pnpm --filter @aprumo/core test` — expect all 9 suites green, 31 currently-skipped tests execute.
  debug_session: "inline-diagnosis-2026-05-25"
