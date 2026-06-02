---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - .github/workflows/ci.yml
  - docs/adr/0001-postgres-as-ledger-engine.md
  - docs/adr/0002-fastify-http-framework.md
  - docs/adr/0003-pg-boss-workflow.md
  - docs/adr/0004-incremental-balance-worker.md
  - docs/adr/0005-accounting-split-async-settlement.md
  - docs/adr/0006-versioning-v01-v05.md
  - docs/adr/0007-smart-routing-as-logical-failover.md
  - docs/adr/0008-mit-core-enterprise-edition.md
  - docs/adr/0009-drizzle-orm-migrations.md
  - docs/adr/README.md
  - packages/core/drizzle.config.ts
  - packages/core/migrations/0000_init_tables.sql
  - packages/core/migrations/0001_roles.sql
  - packages/core/migrations/0002_grants.sql
  - packages/core/migrations/0003_post_transaction.sql
  - packages/core/migrations/0004_audit_triggers.sql
  - packages/core/migrations/0005_double_entry_trigger.sql
  - packages/core/migrations/0006_seed_dev.sql
  - packages/core/migrations/migration-hashes.json
  - packages/core/migrations/0007_revoke_insert_append_only.sql
  - packages/core/migrations/0008_post_transaction_idempotency_race.sql
  - packages/core/migrations/0009_account_balance_last_posting_fk.sql
  - packages/core/migrations/0010_fix_validation_order.sql
  - packages/core/migrations/0011_drop_outbound_events_audit_trigger.sql
  - packages/core/package.json
  - packages/core/src/db/migrate.ts
  - packages/core/src/db/reset.ts
  - packages/core/src/db/schema.ts
  - packages/core/src/db/seed.ts
  - packages/core/tests/e2e/migration-e2e.integration.test.ts
  - packages/core/tests/globalSetup.ts
  - packages/core/tests/helpers/applyMigrationsToSchema.ts
  - packages/core/tests/helpers/createTestDb.ts
  - packages/core/tests/helpers/globalSetup.race.test.ts
  - packages/core/tests/infra/migration-drift.test.ts
  - packages/core/tests/schema/audit-triggers.integration.test.ts
  - packages/core/tests/schema/constraint-trigger.integration.test.ts
  - packages/core/tests/schema/post-transaction.integration.test.ts
  - packages/core/tests/schema/revoke.integration.test.ts
  - packages/core/tests/schema/schema-shape.integration.test.ts
  - packages/core/tests/setup/container.ts
  - packages/core/tests/vitest.d.ts
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - scripts/check-migration-drift.mjs
  - scripts/generate-migration-hashes.mjs
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 38
**Status:** issues_found

## Summary

This phase implements the Postgres schema foundation, migration pipeline, DB tooling (migrate/reset/seed), and the integration test harness (testcontainers + schema isolation). The core invariants from CLAUDE.md — append-only tables, double-entry balance, idempotency, and role-based access control — are structurally sound and well-implemented across the migration chain.

The migration sequence is coherent: 0000 creates tables, 0001–0002 establish roles and grants, 0003 creates `post_transaction`, 0004–0005 add audit and double-entry triggers, 0007 revokes direct INSERT on append-only tables, 0008 fixes the idempotency race, 0010 fixes validation order for BIGINT_MIN, and 0011 drops the high-frequency audit trigger. The hash-based drift gate and the test helper's schema-isolation machinery are well-designed.

Two blockers were identified: a missing production guard in `seed.ts` and a logic error in a test guard that silently swallows the diagnostic error it was designed to surface. Three warnings cover a broad `DO`-statement error-swallowing pattern in the test helper, the absence of per-posting `amount_cents` overflow protection for the accumulator, and an over-broad `EXECUTE ON ALL FUNCTIONS` grant that pre-authorises future SECURITY DEFINER functions for `aprumo_app` without explicit review.

## Critical Issues

### CR-01: seed.ts has no NODE_ENV guard — runnable in production

**File:** `packages/core/src/db/seed.ts:56`
**Issue:** `runSeed()` (and its CLI entry point) has no `NODE_ENV` allowlist guard. `reset.ts` correctly refuses to run unless `NODE_ENV` is `development` or `test`. `seed.ts` does not apply the same guard. Running `pnpm db:seed` against a production database would INSERT two `accounts` rows on every invocation (no unique constraint on `owner_ref` prevents this from accumulating) and attempt `post_transaction('seed-tx-001', ...)` — the transaction is idempotent due to the UNIQUE constraint on `idempotency_key`, but accounts accumulate. More importantly, the seed executes arbitrary SQL (the `DO $$` block) as the migration role via `sql.unsafe()`, making accidental production execution a data-corruption risk.

**Fix:** Mirror the guard from `reset.ts` at the top of `runSeed()`:

```typescript
export async function runSeed(databaseUrl?: string): Promise<void> {
  const SAFE_ENVS = new Set(["development", "test"]);
  const nodeEnv = process.env.NODE_ENV ?? "";
  if (!SAFE_ENVS.has(nodeEnv)) {
    throw new Error(
      `db:seed refused: NODE_ENV="${nodeEnv}" is not a permitted environment. ` +
        `Allowed values: development, test.`,
    );
  }
  // ... rest of function
}
```

---

### CR-02: beforeAll guard in post-transaction test silently swallows its own diagnostic error

**File:** `packages/core/tests/schema/post-transaction.integration.test.ts:29-50`
**Issue:** The `beforeAll` guard is intended to detect when migration `0007_revoke_insert_append_only` has not been applied and abort with a clear diagnostic. The logic is broken: when `db.app.query(INSERT INTO postings ...)` **succeeds** (the revoke is missing), the code throws a custom `Error("beforeAll guard: aprumo_app could INSERT ...")`. This `Error` has no `.code` property. In the `catch` block the condition is:

```typescript
typeof err === "object"   // true
&& err !== null           // true
&& "code" in err          // FALSE — custom Error has no .code
&& ...                    // short-circuits
```

The condition evaluates to `false`, the error is **not re-thrown**, and `beforeAll` silently continues. The later immutability tests then fail with "Expected promise to reject, but it resolved" — the exact obscure failure the guard was designed to prevent.

**Fix:**

```typescript
try {
  await db.app.query(
    `INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
     VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'debit')`,
  );
  // INSERT succeeded — 0007 is missing. Fail loudly.
  throw new Error(
    "beforeAll guard: aprumo_app could INSERT directly into postings — " +
      "migration 0007_revoke_insert_append_only has not been applied.",
  );
} catch (err: unknown) {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code: string }).code
      : undefined;
  if (code === "42501") {
    // Expected — REVOKE is in place, guard passes.
    return;
  }
  // Re-throw everything else: our sentinel Error, connection failures, etc.
  throw err;
}
```

## Warnings

### WR-01: Savepoint handler in applyMigrationsToSchema absorbs 23505/42710 for ALL DO blocks

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:386-393`
**Issue:** The savepoint error handler absorbs duplicate-object errors when `firstToken.startsWith("DO ")`. Currently only `0001_roles.sql` uses a `DO` block in non-seed migrations, so the heuristic is accidentally correct. However, any future migration that uses a `DO $$` block for data migrations, conditional index creation, or other DDL could silently have a `23505` or `42710` error swallowed. The outer transaction would continue, the tracking INSERT would record the migration as applied, and the schema would be left in a partially-applied state with no diagnostic error.

**Fix:** Tighten the check to match only the role-creation DO blocks by inspecting the actual SQL content, not just the token prefix:

```typescript
const isRoleCreationBlock =
  firstToken.startsWith("CREATE ROLE") ||
  (firstToken.startsWith("DO ") &&
    /CREATE\s+ROLE\s+aprumo_/i.test(trimmed.replace(/--[^\n]*/g, "")));
if ((pgCode === "23505" || pgCode === "42710") && isRoleCreationBlock) {
  return;
}
```

Alternatively, update `0001_roles.sql` to use `EXCEPTION WHEN duplicate_object` (as `globalSetup.ts` already does for the pre-creation step) and remove `DO` from the savepoint absorption entirely.

---

### WR-02: post_transaction v_signed_sum accumulator can BIGINT-overflow with multiple large-but-individually-valid postings

**File:** `packages/core/migrations/0010_fix_validation_order.sql:68-70`
**Issue:** The per-posting positivity check (`amount_cents <= 0`) prevents BIGINT_MIN as a single amount. However, `v_signed_sum := v_signed_sum + v_rec.amount_cents` can still overflow when multiple individually-valid postings sum to more than `BIGINT_MAX` (9,223,372,036,854,775,807 cents ≈ 92 quadrillion USD). For example, two debit postings of `4,611,686,018,427,387,904` cents each would produce integer overflow. PostgreSQL raises `SQLSTATE 22003` (numeric value out of range) rather than `P0001`, breaking the invariant that all `post_transaction` validation errors use `P0001` and can be handled uniformly by callers.

**Fix:** Use `numeric` for the accumulator (the intermediate calculation only; `bigint` storage is unchanged) so overflow cannot occur, then validate the final sum fits in `bigint` before proceeding:

```sql
DECLARE
  v_tx_id       uuid;
  v_signed_sum  numeric := 0;   -- overflow-safe accumulator
  v_rec         posting_input;
BEGIN
  -- ... validation loop as-is ...

  IF v_signed_sum <> 0 THEN
    RAISE EXCEPTION 'post_transaction: postings do not balance (signed sum = %)',
      v_signed_sum USING ERRCODE = 'P0001';
  END IF;
  -- No range check needed when sum = 0 (zero is within bigint range).
```

---

### WR-03: EXECUTE ON ALL FUNCTIONS grant pre-authorises future SECURITY DEFINER functions for aprumo_app

**File:** `packages/core/migrations/0002_grants.sql:24-26`
**Issue:** The migration issues `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aprumo_app` and sets a `DEFAULT PRIVILEGES` clause so all future functions created by `aprumo_migration` are automatically executable by `aprumo_app`. The comment states this is needed for `post_transaction`, but the grant is far broader. Any future `SECURITY DEFINER` function added via a new migration will be callable by `aprumo_app` without an explicit per-function grant review. If such a function performs privileged operations with insufficient input validation, `aprumo_app` can invoke it without any additional migration step to grant access.

**Fix:** Remove the broad default-privilege clause and require each new function to explicitly grant EXECUTE in its own migration, consistent with how `0003_post_transaction.sql` already does it on line 119:

```sql
-- 0002_grants.sql should NOT include:
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aprumo_app;
--   ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO aprumo_app;
-- Each function's migration grants EXECUTE explicitly (see 0003_post_transaction.sql:119).
```

Revoke the existing over-broad grant in a new migration:

```sql
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM aprumo_app;
-- Then verify post_transaction still has its explicit GRANT (it does — 0003_post_transaction.sql:119).
```

## Info

### IN-01: migration-integrity CI job is not in integration-test needs, causing redundant execution

**File:** `.github/workflows/ci.yml:139-154`
**Issue:** The `integration-test` job declares `needs: [lint, typecheck, build]` and also re-runs `check-migration-drift.mjs` inline as a step. The standalone `migration-integrity` job runs in parallel. This means the drift check runs twice per CI run with no guarantee they execute in the correct order. Adding `migration-integrity` to `integration-test`'s `needs:` array would enforce ordering and remove the inline duplicate.

**Fix:**

```yaml
integration-test:
  needs: [lint, typecheck, build, migration-integrity]
  # Remove the inline "Check migration drift" step — it's now guaranteed by needs.
```

---

### IN-02: readWithRetry comment says "3 retries" but implementation uses 10 attempts

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:232`
**Issue:** The function header comment on line 232 says "Read a file with up to 3 retries on ENOENT" but the loop condition is `attempt < 10` (10 total attempts, 9 retries). The discrepancy creates a false expectation when debugging slow or flaky macOS APFS test runs.

**Fix:** Align the comment with the implementation:

```typescript
/**
 * Read a file with up to 9 retries (10 total attempts) on ENOENT.
 * ...
 */
```

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
