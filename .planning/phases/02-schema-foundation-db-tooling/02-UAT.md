---
status: complete
phase: 02-schema-foundation-db-tooling
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md, 02-13-SUMMARY.md, 02-14-SUMMARY.md]
started: 2026-05-28T21:56:44Z
updated: 2026-05-29T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean state (`docker compose down -v` then `docker compose up -d postgres`), run `pnpm db:migrate`. All migrations apply, exit code 0, no errors. A primary query (e.g., `psql $DATABASE_URL -c "SELECT 1"`) returns live data.
result: pass

### 2. All 10 Ledger Tables Present
expected: After `pnpm db:migrate`, `psql $DATABASE_URL -c "\dt"` shows the 10 ledger tables: accounts, transactions, postings, raw_events, account_balance, outbound_endpoints, outbound_events, accounts_audit, outbound_endpoints_audit, outbound_events_audit. `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'` returns 10.
result: pass

### 3. pnpm db:reset Works (dev-only, NODE_ENV guard)
expected: `pnpm db:reset` drops and recreates the schema cleanly, re-runs migrations. Exit 0. Running with `NODE_ENV=production pnpm db:reset` aborts with a guard error.
result: pass

### 4. pnpm db:seed Inserts Dev Data
expected: `pnpm --filter @aprumo/core db:seed` runs 0006_seed_dev.sql — creates ≥2 accounts + 1 balanced transaction via `post_transaction` (no direct postings INSERT). `SELECT COUNT(*) FROM accounts` ≥ 2, `SELECT COUNT(*) FROM transactions` ≥ 1, `SELECT COUNT(*) FROM postings` ≥ 2.
result: pass

### 5. pnpm db:migrate Skips Seed Migration
expected: On a fresh DB, `pnpm db:migrate` exits 0 and does NOT run 0006_seed_dev. No rows with `owner_ref='seed-owner'` present in accounts. The 0006_seed_dev entry is absent from drizzle.__drizzle_migrations.
result: pass

### 6. Integration Tests Pass (testcontainers, full suite green)
expected: `pnpm --filter @aprumo/core test` spins up postgres:18-alpine via testcontainers globalSetup (with pre-created roles, no CREATE ROLE race). All 10 files / ~65 tests pass, 0 failures, 0 skips. Exit 0.
result: pass
note: User ran pnpm --filter @aprumo/core test 2026-05-28. Output: 10 files passed, 64 passed, 1 skipped (RACE-01 vacuous per commit ac5abbe), 0 failures, duration 3.98s.

### 7. Migration Drift Check (clean + tamper detection)
expected: `node scripts/check-migration-drift.mjs` on unmodified repo exits 0 with "no drift detected". Modify any character in `packages/core/migrations/0000_init_tables.sql`, re-run → exits 1 with a DRIFT error identifying the file. Revert the change after.
result: pass

### 8. Immutability — aprumo_app Cannot Write postings/raw_events
expected: Connect as aprumo_app (via SET ROLE — roles are NOLOGIN). `UPDATE postings SET amount_cents=0;` → SQLSTATE 42501 (permission denied). Same for `DELETE FROM postings`, `UPDATE raw_events`, `DELETE FROM raw_events`. All four denied.
result: pass

### 9. Double-Entry Trigger Deferrable
expected: `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname='assert_double_entry';` → both `t` (DEFERRABLE INITIALLY DEFERRED). A transaction that bypasses `post_transaction` and INSERTs unbalanced postings raises P0001 with `double_entry_violation:` prefix at COMMIT.
result: pass

### 10. post_transaction Rejects Unbalanced
expected: `SELECT post_transaction(...)` with debits ≠ credits raises P0001 with message containing "do not balance" (or `double_entry_violation:` prefix). Balanced call returns a UUID; transaction row queryable by that UUID.
result: pass

### 11. post_transaction Idempotent
expected: Call `post_transaction` twice with the same `idempotency_key` → both return the identical UUID; `SELECT COUNT(*) FROM transactions WHERE idempotency_key=$1` returns 1. No duplicate postings.
result: pass

### 12. Audit Triggers Populate Shadow Tables
expected: `UPDATE accounts SET metadata='{}' WHERE id=...` → one row appears in `accounts_audit` with operation='UPDATE', old_data populated. `DELETE FROM accounts WHERE id=...` → audit row with operation='DELETE', new_data NULL. `INSERT INTO accounts ...` → accounts_audit count unchanged.
result: pass

### 13. ADRs 0001–0009 Present
expected: `ls docs/adr/` shows 0001-postgres-as-ledger-engine.md through 0009-drizzle-orm-migrations.md plus README.md. Each renders as valid MADR 4.0 (frontmatter: status/date/decision-makers; sections: Context/Drivers/Options/Outcome/Consequences).
result: pass
note: Auto-verified ls — all 9 ADRs (0001 → 0009) + README.md present. Prose conformance accepted by user.

## Summary

total: 13
passed: 13
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
