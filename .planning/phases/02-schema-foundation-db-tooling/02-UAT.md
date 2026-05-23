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
  root_cause: ""
  debug_session: ""
