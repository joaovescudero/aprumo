---
status: complete
phase: 02-schema-foundation-db-tooling
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md]
started: 2026-05-23T02:30:44Z
updated: 2026-05-23T03:07:40Z
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
reported: "6 test suites FAIL, 42 tests SKIPPED. Drizzle migrate raises PostgresError 42P01 'relation \"public.accounts\" does not exist' on ALTER TABLE account_balance ADD CONSTRAINT account_balance_account_id_accounts_id_fk FOREIGN KEY (account_id) REFERENCES public.accounts(id). Failed suites: e2e/migration-e2e, schema/audit-triggers, schema/constraint-trigger, schema/post-transaction, schema/revoke, schema/schema-shape. Each also throws TypeError 'Cannot read properties of undefined (reading cleanup)' in afterAll because createTestDb never returned."
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

## Gaps

- truth: "pnpm --filter @aprumo/core test passes via testcontainers globalSetup with all integration suites green"
  status: failed
  reason: "User reported: 6 test suites FAIL, 42 tests SKIPPED. Drizzle migrate raises PostgresError 42P01 'relation public.accounts does not exist' when adding FK on account_balance. Migration 0000_init_tables.sql hardcodes REFERENCES public.accounts but createTestDb migrates into per-file isolated schema (test_xxx). FK target schema mismatch — public.accounts never created in test pool's search_path. Cascading: each suite's afterAll then throws TypeError 'Cannot read properties of undefined (reading cleanup)' because db handle never returned from createTestDb."
  severity: blocker
  test: 5
  artifacts:
    - path: "packages/core/migrations/0000_init_tables.sql"
      issue: "FK on account_balance references public.accounts — incompatible with per-schema test isolation"
    - path: "packages/core/tests/helpers/createTestDb.ts"
      issue: "Uses migrate() with migrationsSchema=schema but migration DDL hardcodes public schema in FK target"
  missing:
    - "Either: regenerate 0000_init_tables.sql so FK uses schema-relative table name (drizzle-kit pgSchema), OR rewrite createTestDb to set search_path before migrate AND strip the explicit public. qualifier from generated FK DDL, OR migrate into public schema and use per-database isolation instead of per-schema"
  root_cause: |
    drizzle-kit generates FK DDL with literal `"public"."tablename"` qualifier in REFERENCES clauses (see 0000_init_tables.sql:113-117). CREATE TABLE statements have no schema qualifier — search_path resolves them into test_xxx schema correctly. But FK ALTER TABLE tries to bind to literal public.accounts which never exists in the test pool (only test_xxx.accounts does). createTestDb.ts:66 calls drizzle's stock migrate() which applies SQL verbatim — migrationsSchema option only isolates __drizzle_migrations tracking table, it does NOT rewrite migration text. Cascade error: when migrate() throws, the function exits before returning the {app, migration, schema, cleanup} handle, so afterAll's `await db.cleanup()` fails with "Cannot read properties of undefined (reading cleanup)".
  recommended_fix: |
    Replace drizzle's stock migrate() in createTestDb.ts with a custom apply loop that string-replaces `"public".` → `"${schema}".` before executing each statement. Migration file content stays unchanged (preserves migration-hashes.json drift gate from Plan 09). Production path (src/db/migrate.ts runMigrations) is unaffected because it runs against the real public schema where the FK target legitimately exists. Steps:
      1. In packages/core/tests/helpers/createTestDb.ts, drop the `import { migrate } from "drizzle-orm/postgres-js/migrator"` and the `drizzle(migrationSql)` wrapper.
      2. Replicate the readNonSeedMigrations() logic from src/db/migrate.ts (or export it from there and import).
      3. For each migration, read SQL → run `.replaceAll('"public".', `"${schema}".`)` → split on `--> statement-breakpoint` → execute each via migrationSql.unsafe(trimmed).
      4. Track applied hashes in `${schema}.__drizzle_migrations` (not drizzle schema — keep tracker scoped per-test).
      5. Re-run `pnpm --filter @aprumo/core test` — all 42 currently-skipped tests should execute.
    Alternative (heavier, cleaner long-term): switch from per-schema to per-database isolation — CREATE DATABASE per test file, run unmodified migrations into its public schema. Trade-off: ~200ms slower startup per file, but zero migration text coupling.
  debug_session: "inline-diagnosis-2026-05-23"
