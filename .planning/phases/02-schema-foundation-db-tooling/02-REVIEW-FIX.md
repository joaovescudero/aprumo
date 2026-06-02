---
phase: 02-schema-foundation-db-tooling
fixed_at: 2026-06-02T17:45:00Z
review_path: .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-06-02T17:45:00Z
**Source review:** .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01, CR-02, WR-01, WR-02, WR-03)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: seed.ts has no NODE_ENV guard — runnable in production

**Files modified:** `packages/core/src/db/seed.ts`
**Commit:** `7469134`
**Applied fix:** Added a `SAFE_ENVS = new Set(["development", "test"])` allowlist guard at the top of `runSeed()`, mirroring the pattern in `reset.ts`. The guard throws with a descriptive message identifying the disallowed `NODE_ENV` value and the allowed set. Placed before the `DATABASE_URL` check and before any SQL execution, so production invocations are rejected before any connection is opened.

---

### CR-02: beforeAll guard in post-transaction test silently swallows its own diagnostic error

**Files modified:** `packages/core/tests/schema/post-transaction.integration.test.ts`
**Commit:** `bd2e4b7`
**Applied fix:** Restructured the `catch` block to extract `code` unconditionally first (`code = "code" in err ? err.code : undefined`), then re-throw if `code !== "42501"`. The previous logic (`"code" in err && code !== "42501"`) short-circuited to `false` for the sentinel `Error` (which has no `.code` property), silently swallowing the guard failure. The new logic re-throws for any error that is not the expected 42501, including our sentinel Error (code=undefined) and connection failures. Uses fall-through (not `return`) in the 42501 path to avoid a biome `noUnreachable` lint error on the account-seeding code that follows.
**Status:** fixed: requires human verification (logic fix — integration tests require a running container to confirm)

---

### WR-01: Savepoint handler in applyMigrationsToSchema absorbs 23505/42710 for ALL DO blocks

**Files modified:** `packages/core/tests/helpers/applyMigrationsToSchema.ts`
**Commit:** `8e696f1`
**Applied fix:** Replaced `firstToken.startsWith("DO ")` with a compound check: a `DO ` prefix is only tolerated for 23505/42710 when the full SQL content also matches `/CREATE\s+ROLE\s+aprumo_/i`. Future data-migration `DO` blocks (conditional index creation, data backfills, etc.) will now propagate duplicate-object errors rather than having them silently swallowed, which would leave the schema in a partially-applied state.

---

### WR-02: post_transaction v_signed_sum accumulator can BIGINT-overflow with multiple large-but-individually-valid postings

**Files modified:** `packages/core/migrations/0012_numeric_accumulator_post_transaction.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0012_snapshot.json`, `packages/core/migrations/migration-hashes.json`, `packages/core/tests/schema/post-transaction.integration.test.ts`
**Commit:** `25c3bb5`
**Applied fix:** Created migration `0012_numeric_accumulator_post_transaction.sql` using `CREATE OR REPLACE FUNCTION` that changes `v_signed_sum` from `bigint` to `numeric`. NUMERIC has no fixed overflow limit so two large-but-individually-valid postings (e.g. two debits of BIGINT_MAX/2+1 cents each) no longer raise SQLSTATE 22003 before reaching the balance check. The per-posting amount validation still uses BIGINT comparisons; only the intermediate accumulator is NUMERIC. The final balance check remains `v_signed_sum <> 0` (zero is representable in both types). Added a TDD test case for the overflow scenario that expects P0001 'do not balance'. Note: migration 0010 is immutable and unchanged; 0012 supersedes it via `CREATE OR REPLACE FUNCTION`.
**Status:** fixed: requires human verification (logic fix — integration tests require a running container to confirm)

---

### WR-03: EXECUTE ON ALL FUNCTIONS grant pre-authorises future SECURITY DEFINER functions for aprumo_app

**Files modified:** `packages/core/migrations/0013_revoke_execute_all_functions.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0013_snapshot.json`, `packages/core/migrations/migration-hashes.json`
**Commit:** `bd7ed4f`
**Applied fix:** Created migration `0013_revoke_execute_all_functions.sql` that issues `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM aprumo_app` and `ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM aprumo_app`. Future functions created by any migration will not be automatically callable by `aprumo_app`; each function's migration must issue an explicit `GRANT EXECUTE`. Re-asserts the explicit grant on `post_transaction` (belt-and-suspenders to ensure the broad REVOKE did not remove the function-level grant that 0003/0010/0012 issued). Note: `0002_grants.sql` is immutable and not modified.

---

_Fixed: 2026-06-02T17:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
