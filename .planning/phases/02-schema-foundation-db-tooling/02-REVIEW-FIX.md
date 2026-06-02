---
phase: 02-schema-foundation-db-tooling
fixed_at: 2026-06-02T13:15:00Z
review_path: .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
iteration: 3
findings_in_scope: 14
fixed: 13
skipped: 1
status: partial
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-06-02T13:15:00Z
**Source review:** .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 14
- Fixed: 13
- Skipped: 1

## Fixed Issues

### CR-01: `post_transaction` validates `amount_cents` AFTER accumulating signed sum

**Files modified:** `packages/core/migrations/0010_fix_validation_order.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0010_snapshot.json`, `packages/core/migrations/migration-hashes.json`, `packages/core/tests/schema/post-transaction.integration.test.ts`
**Commit:** `dccc6b7`
**Applied fix:** Created migration `0010_fix_validation_order.sql` using `CREATE OR REPLACE FUNCTION` that reorders the validation loop — `amount_cents <= 0` check now fires BEFORE the direction branch accumulates `v_signed_sum`. This prevents a CREDIT posting with `amount_cents = BIGINT_MIN` from executing `v_signed_sum - BIGINT_MIN` (which overflows BIGINT) before the guard fires. Added a failing test in `post-transaction.integration.test.ts` (TDD RED) that sends `amount_cents = BIGINT_MIN` as a credit and expects P0001 "must be positive". Migrations 0003 and 0008 are immutable and unchanged.
**Status:** fixed: requires human verification (logic fix — integration tests confirm behavior but require a running container)

---

### CR-02: `migrate.ts` wraps ALL pending migrations in a single outer transaction

**Files modified:** `packages/core/src/db/migrate.ts`
**Commit:** `7511893`
**Applied fix:** Moved schema/table creation for `drizzle.__drizzle_migrations` outside the per-migration loop (committed immediately as autocommit), then restructured so each migration runs inside its own `sql.begin()` transaction. If migration N fails, previously-committed migrations N-1, N-2, ... are NOT rolled back, preventing the retry-against-non-idempotent-DDL loop. Matches the pattern used by `applyMigrationsToSchema.ts`.

---

### CR-03: `reset.ts` environment guard uses deny-list instead of allowlist

**Files modified:** `packages/core/src/db/reset.ts`
**Commit:** `273d84c`
**Applied fix:** Replaced the `if (nodeEnv === "production") throw` deny-list with `const SAFE_ENVS = new Set(["development", "test"]); if (!SAFE_ENVS.has(nodeEnv)) throw`. Now `db:reset` only runs when `NODE_ENV` is explicitly `"development"` or `"test"`. Any other value including `undefined`, `"staging"`, `"ci"`, or `"production"` is rejected with a clear error message identifying the disallowed value and the allowed set.

---

### CR-04: `splitMigrationStatements` dollar-quote parser greedy `indexOf` scan

**Files modified:** `packages/core/tests/helpers/applyMigrationsToSchema.ts`
**Commit:** `b5ea8fb`
**Applied fix:** Replaced the greedy `sql.indexOf("$", i + 1)` with an inline character-by-character scan: walk forward consuming only `[A-Za-z0-9_]` word characters, then require the next character to be `$` to constitute a valid tag. Tags formed this way are correct by construction (satisfy the PostgreSQL dollar-quote rule) without needing the regex guard. `$1` parameter placeholders no longer cause false dollar-quote mode entry because `1` IS a word character but the character after it is not `$` (unless adjacent to another `$`).

---

### WR-02: `outbound_events_audit_trigger` fires on every delivery status update

**Files modified:** `packages/core/migrations/0011_drop_outbound_events_audit_trigger.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0011_snapshot.json`, `packages/core/migrations/migration-hashes.json`
**Commit:** `b24ae5d`
**Applied fix:** Created migration `0011_drop_outbound_events_audit_trigger.sql` that issues `DROP TRIGGER IF EXISTS outbound_events_audit_trigger ON outbound_events`. The `outbound_events_audit` shadow table is retained (not dropped) to avoid data loss for databases that have already accumulated rows. Migration drift gate verified: 12 migrations pass.

---

### WR-03: `check-migration-drift.mjs` does not detect SQL files absent from journal

**Files modified:** `scripts/check-migration-drift.mjs`
**Commit:** `bbe636a`
**Applied fix:** Added a reverse check (step 4) after the forward hash check. Uses `readdirSync(MIGRATIONS_DIR)` to list all `\d{4}_.*\.sql` files on disk, filters to those not in the journal's tag set, and emits `DRIFT: {tag}.sql is on disk but not registered in _journal.json` for each unregistered file. Added `readdirSync` to the `node:fs` import. The forward check was renumbered from step 4 to step 5 in both the algorithm comment and the inline comment.

---

### WR-04: `createTestDb` grants `ALL PRIVILEGES` to `aprumo_migration` in test schemas

**Files modified:** `packages/core/tests/helpers/createTestDb.ts`
**Commit:** `f0906ea`
**Applied fix:** Changed `GRANT ALL PRIVILEGES ON ALL TABLES` to `GRANT SELECT, INSERT ON ALL TABLES` for `aprumo_migration`. Changed `GRANT ALL PRIVILEGES ON ALL SEQUENCES` to `GRANT USAGE, SELECT ON ALL SEQUENCES`. This matches the minimum needed for SECURITY DEFINER functions (e.g. `post_transaction`) and ensures tests accurately reflect the production permission boundary — in particular, that `aprumo_migration` cannot UPDATE or DELETE `postings`/`raw_events` in test schemas either.

---

### WR-05: CI `coverage-gate` job does not declare a dependency on `test`

**Files modified:** `.github/workflows/ci.yml`
**Commit:** `b363f52`
**Applied fix:** Added `test` to the `needs` list of the `coverage-gate` job: `needs: [lint, typecheck, build, test]`. Coverage now only runs after all `test` matrix jobs (Node 22 and Node 24) pass. Added inline comment documenting the WR-05 fix rationale.

---

### WR-06: `seed.ts` uses `sql.unsafe()` without content validation

**Files modified:** `packages/core/src/db/seed.ts`
**Commit:** `fee4a91`
**Applied fix:** Added structural validation before `sql.unsafe()`: checks that `seedContent` matches `/^\s*DO\s+\$\$/` and throws an error with the resolved path if it does not. Added `process.stdout.write` of the resolved seed path for audit purposes.

---

### IN-01: `_journal.json` entries 0007–0009 have anomalous timestamps

**Files modified:** `packages/core/migrations/meta/_journal.json`
**Commit:** `16e2aba`
**Applied fix:** Updated the `when` values for entries 0007, 0008, 0009 to be monotonically increasing after entry 0006 (`1779485643554`): 0007=`1779485703554`, 0008=`1779485763554`, 0009=`1779485823554` (each 60 seconds apart, consistent with the generation cadence). The `migrate.ts` runner stores these as `created_at` in `drizzle.__drizzle_migrations`, so any tooling sorting by `created_at` will now produce correct ordering.

---

### IN-02: `vitest.config.ts` does not configure the coverage provider

**Files modified:** `packages/core/vitest.config.ts`
**Commit:** `d670fb1`
**Applied fix:** Added a `coverage` block with `provider: "v8"`, `reporter: ["text", "json", "json-summary", "lcov"]`, and `thresholds: { lines: 90 }`. The `json-summary` reporter is required by the `davelosert/vitest-coverage-report-action` CI step. `lcov` is required for the `Upload lcov artifact` CI step.

---

### IN-03: Immutability tests have implicit dependency on migration 0007

**Files modified:** `packages/core/tests/schema/post-transaction.integration.test.ts`
**Commit:** `73a2003`
**Applied fix:** Added a `beforeAll` guard that probes `aprumo_app`'s INSERT ability into `postings`. If the INSERT succeeds (migration 0007 not applied), the guard throws a descriptive error: "migration 0007_revoke_insert_append_only has not been applied". If the INSERT fails with any error other than `42501`, the error is re-thrown for diagnosis. Only `42501` (the expected `insufficient_privilege`) passes silently, confirming 0007 is active.

---

### IN-04: `drizzle.config.ts` lacks comment prohibiting `drizzle-kit push`

**Files modified:** `packages/core/drizzle.config.ts`
**Commit:** `ef305c3`
**Applied fix:** Added a prominent JSDoc-style comment block above the `import` documenting: (1) `drizzle-kit push` is PROHIBITED, (2) why (bypasses versioned migration files and drift gate), (3) that `dbCredentials` is intentionally absent to prevent accidental push, and (4) the allowed commands (`generate`, `check`, `studio`).

---

## Skipped Issues

### WR-01: `0002_grants.sql` INSERT privilege gap on postings/raw_events

**File:** `packages/core/migrations/0002_grants.sql:8`
**Reason:** already resolved by existing migration 0007_revoke_insert_append_only.sql. Migration 0007 issues `REVOKE INSERT ON TABLE postings FROM aprumo_app` and `REVOKE INSERT ON TABLE raw_events FROM aprumo_app`, exactly as the WR-01 fix suggests. The gap only exists in databases with 0002-0006 applied but not 0007 — the migration chain is complete and 0007 always runs. Creating an additional migration would be redundant and add noise to the deployment chain. No net change to the deployed state would result.

---

_Fixed: 2026-06-02T13:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
