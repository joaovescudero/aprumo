---
status: complete
phase: 02-schema-foundation-db-tooling
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md, 02-13-SUMMARY.md, 02-14-SUMMARY.md]
started: 2026-06-02T16:58:13Z
updated: 2026-06-02T17:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean state (`docker compose down -v` then `docker compose up -d postgres`), run `pnpm db:migrate`. All migrations apply, exit code 0, no errors. A primary query (`psql $DATABASE_URL -c "SELECT 1"`) returns live data.
result: pass

### 2. All 10 Ledger Tables Present
expected: After `pnpm db:migrate`, `psql $DATABASE_URL -c "\dt"` shows the 10 ledger tables: accounts, transactions, postings, raw_events, account_balance, outbound_endpoints, outbound_events, accounts_audit, outbound_endpoints_audit, outbound_events_audit. `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'` returns 10.
result: pass

### 3. pnpm db:reset Works (dev-only, NODE_ENV guard)
expected: `pnpm db:reset` drops and recreates the schema cleanly, re-runs migrations. Exit 0. Running with `NODE_ENV=production pnpm db:reset` aborts with a guard error (no data loss in production).
result: pass
note: Clarification (surfaced during Test 5) — by design `db:reset` only DROPs+CREATEs the database and prints "Run pnpm db:migrate to reapply migrations" (reset.ts:64-66). It does NOT auto-run migrations; migrate is a separate manual step. Test expected wording overstated this; reset itself works correctly. NODE_ENV guard verified.

### 4. pnpm db:seed Inserts Dev Data via post_transaction
expected: `pnpm --filter @aprumo/core db:seed` runs 0006_seed_dev.sql — creates 2 accounts (asset+liability, owner_ref='seed-owner') + 1 balanced 1000-cent transaction via `post_transaction` (no direct postings INSERT). `SELECT COUNT(*) FROM accounts` ≥ 2, `SELECT COUNT(*) FROM transactions` ≥ 1, `SELECT COUNT(*) FROM postings` ≥ 2.
result: issue
reported: "Seed failed: Seed file does not begin with the expected DO $$ block. Refusing to execute unrecognised content. (exit 1)"
severity: major

### 5. pnpm db:migrate Skips Seed Migration
expected: On a fresh DB, `pnpm db:migrate` exits 0 and does NOT run 0006_seed_dev (SEED_TAG_PATTERN=/seed/i filter). No rows with `owner_ref='seed-owner'` in accounts after migrate-only. The 0006_seed_dev entry stays in _journal.json (for drift) but is absent from drizzle.__drizzle_migrations.
result: pass
note: Seed-skip confirmed — seed-owner count 0, 0006_seed_dev absent from drizzle.__drizzle_migrations. User ran db:migrate manually (db:reset does not auto-migrate by design — see Test 3 note).

### 6. Integration Tests Pass (testcontainers, full suite green)
expected: `pnpm --filter @aprumo/core test` spins up the pinned postgres:18-alpine via testcontainers globalSetup (roles pre-created, no CREATE ROLE race). 10 files / 65 tests pass, 0 failures, 0 skips. Exit 0.
result: pass

### 7. Migration Drift Check (clean + tamper detection)
expected: `node scripts/check-migration-drift.mjs` on the unmodified repo exits 0 with "no drift detected (10 migrations verified)". Modify any character in `packages/core/migrations/0000_init_tables.sql`, re-run → exits 1 with a DRIFT error identifying the file. Revert the change after.
result: pass

### 8. Immutability — aprumo_app Cannot UPDATE/DELETE postings/raw_events
expected: Connect/SET ROLE aprumo_app. `UPDATE postings SET amount_cents=0;` → SQLSTATE 42501 (permission denied). Same for `DELETE FROM postings`, `UPDATE raw_events`, `DELETE FROM raw_events`. All four denied (REVOKE in 0002_grants.sql).
result: pass

### 9. Double-Entry Constraint Trigger Deferrable
expected: `SELECT condeferrable, condeferred FROM pg_constraint WHERE conname='assert_double_entry';` → both `t` (DEFERRABLE INITIALLY DEFERRED). A transaction that bypasses post_transaction and INSERTs unbalanced postings raises P0001 with `double_entry_violation:` prefix at COMMIT.
result: pass

### 10. post_transaction Rejects Unbalanced
expected: `SELECT post_transaction(...)` with debits ≠ credits raises P0001 with "do not balance". Empty array → P0001 "must not be empty". Invalid direction → P0001 "invalid direction". Zero/negative amount → P0001 "must be positive". A balanced call returns a UUID; transaction row queryable by that UUID.
result: pass
note: Function signature is post_transaction(p_idempotency_key text, p_description text, p_source text, p_metadata jsonb, p_postings posting_input[]) — postings is the last arg. Accounts created manually for UAT (db:seed broken, Test 4). Balanced call returned UUID; empty/unbalanced raised P0001.

### 11. post_transaction Idempotent
expected: Call `post_transaction` twice with the same `idempotency_key` → both return the identical UUID; `SELECT COUNT(*) FROM transactions WHERE idempotency_key=$1` returns 1. No duplicate postings.
result: pass

### 12. Audit Triggers Populate Shadow Tables
expected: `UPDATE accounts SET metadata='{}' WHERE id=...` → one row in `accounts_audit` (operation=UPDATE, old_data populated, changed_by=current_user). `DELETE FROM accounts WHERE id=...` → audit row (operation=DELETE, new_data NULL). `INSERT INTO accounts ...` → accounts_audit count unchanged (AFTER UPDATE OR DELETE only). postings/raw_events have zero audit triggers.
result: pass

### 13. PG Image Digest-Pinned (D-40 reproducibility)
expected: `grep -E '@sha256:[a-f0-9]{64}' packages/core/tests/setup/container.ts` exits 0 — PG_IMAGE pinned to postgres:18-alpine@sha256:96d56f7f... (64-hex digest). No floating tag in non-comment lines. Testcontainers boots the pinned image and the suite passes.
result: pass
note: Auto-verified. Digest pin present (exit 0), no floating tag — D-40 reproducibility met. DISCREPANCY (non-blocking, intentional per commit 8124c82 "pin test container to postgres:16-alpine (documented minimum version)"): testcontainers PG_IMAGE = postgres:16-alpine@sha256:16bc17c..., while docker-compose.yml dev = postgres:18-alpine. Tests run against minimum supported version 16; dev runs 18. Test-floor / run-ceiling is a defensible strategy but supersedes plan-01's original "same image for both" D-40 wording. My expected (18-alpine) was stale from the SUMMARYs. Consider documenting the 16-test/18-dev split in ADR or aligning if unintended.

### 14. ADRs 0001–0009 Present
expected: `ls docs/adr/` shows 0001-postgres-as-ledger-engine.md through 0009-drizzle-orm-migrations.md plus README.md (10 files). Each renders as valid MADR 4.0 (frontmatter status: Accepted, decision-makers; sections Context/Drivers/Options/Outcome/Consequences). ADR-001 covers Postgres-over-TigerBeetle; ADR-009 documents D-47 reservation pattern.
result: pass
note: Auto-verified ls — all 9 ADRs (0001 → 0009) + README.md present (.gitkeep also lingers). Prose/MADR conformance accepted.

## Summary

total: 14
passed: 13
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "pnpm db:seed runs 0006_seed_dev.sql, creating 2 accounts + 1 balanced transaction via post_transaction"
  status: failed
  reason: "User reported: Seed failed — file does not begin with the expected DO $$ block. Refusing to execute unrecognised content (exit 1)"
  severity: major
  test: 4
  root_cause: "seed.ts:43 WR-06 guard regex /^\\s*DO\\s+\\$\\$/ requires the file to START with DO $$, but 0006_seed_dev.sql opens with 8 lines of -- SQL line comments before the DO $$ block. The structural-validation guard does not strip/allow leading SQL line-comments, so a valid seed file is rejected and db:seed always fails."
  artifacts:
    - path: "packages/core/src/db/seed.ts"
      issue: "Line 43 regex /^\\s*DO\\s+\\$\\$/ only tolerates leading whitespace, not leading `-- ...` line comments present in the seed SQL header"
    - path: "packages/core/migrations/0006_seed_dev.sql"
      issue: "Begins with 8 lines of `-- DEV SEED ONLY...` comments then a blank line before `DO $$` — legitimate, but tripwires the guard"
  missing:
    - "Strip leading SQL line-comments (and blank lines) before the DO $$ structural check, OR anchor the guard to match `DO $$` anywhere in the leading non-comment content while still rejecting arbitrary statements"
    - "Add/adjust a unit test for the WR-06 guard that feeds the real header-commented seed file (regression: guard must accept the committed 0006_seed_dev.sql)"
