---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-06-02T00:00:00Z
depth: deep
files_reviewed: 33
files_reviewed_list:
  - packages/core/drizzle.config.ts
  - packages/core/migrations/0000_init_tables.sql
  - packages/core/migrations/0001_roles.sql
  - packages/core/migrations/0002_grants.sql
  - packages/core/migrations/0003_post_transaction.sql
  - packages/core/migrations/0004_audit_triggers.sql
  - packages/core/migrations/0005_double_entry_trigger.sql
  - packages/core/migrations/0006_seed_dev.sql
  - packages/core/migrations/0007_revoke_insert_append_only.sql
  - packages/core/migrations/0008_post_transaction_idempotency_race.sql
  - packages/core/migrations/0009_account_balance_last_posting_fk.sql
  - packages/core/src/db/migrate.ts
  - packages/core/src/db/reset.ts
  - packages/core/src/db/schema.ts
  - packages/core/src/db/seed.ts
  - packages/core/tests/e2e/migration-e2e.integration.test.ts
  - packages/core/tests/globalSetup.ts
  - packages/core/tests/helpers/applyMigrationsToSchema.test.ts
  - packages/core/tests/helpers/applyMigrationsToSchema.ts
  - packages/core/tests/helpers/createTestDb.test.ts
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
  - packages/core/vitest.config.ts
  - scripts/check-migration-drift.mjs
  - scripts/generate-migration-hashes.mjs
  - tests/scaffold/coverage-gate-fires.test.ts
findings:
  critical: 4
  warning: 5
  info: 2
  total: 11
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** deep
**Files Reviewed:** 33
**Status:** issues_found

## Summary

This is a full adversarial review of Phase 02 (schema-foundation-db-tooling) at deep depth, covering all 33 source files. The review specifically verified the seven domain invariants mandated by CLAUDE.md: immutability, double-entry balance, idempotency, SERIALIZABLE isolation, audit shadow tables, money-as-bigint, and no-PAN storage.

The core SQL schema and migration pipeline are structurally sound. Role separation, REVOKE enforcement, and the SECURITY DEFINER sole-write-path pattern for `post_transaction` are correctly implemented. The constraint trigger for double-entry balance is correctly deferred. The test infrastructure with schema-per-file isolation via testcontainers is thoughtfully designed.

Four critical issues were found. The most serious is a phantom UUID return in the idempotency race handler (0008): when the winner of a concurrent `INSERT` subsequently rolls back before the loser's re-`SELECT` executes under `READ COMMITTED`, the loser returns a non-existent transaction UUID — a silent data correctness failure. The second critical issue is a missing `SET search_path` on `check_double_entry_balance()`, which leaves the double-entry backstop vulnerable to search-path injection by a superuser. Third, `reset.ts` blocks only `NODE_ENV=production`, silently allowing destructive execution under `staging`, `test`, or any other value. Fourth, `createTestDb()` does not guard against an empty `pgUri` and crashes with `Invalid URL` instead of a diagnostic skip.

Five warnings and two info findings follow.

---

## Critical Issues

### CR-01: Race handler in `post_transaction` (0008) returns phantom UUID when concurrent winner rolls back

**File:** `packages/core/migrations/0008_post_transaction_idempotency_race.sql:88-98`

**Issue:** The `EXCEPTION WHEN unique_violation` handler re-selects the winner's row, but does not check `FOUND` after the `SELECT … INTO`:

```sql
EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_tx_id
      FROM transactions
     WHERE idempotency_key = p_idempotency_key;
    RETURN v_tx_id;   -- ← v_tx_id is still the pre-INSERT gen_random_uuid() if SELECT returns no row
END;
```

Under `READ COMMITTED` isolation (the default), if the winner's transaction has not yet committed when the loser executes this re-`SELECT`, the winner's row is invisible. If the winner subsequently rolls back, the loser's re-`SELECT` finds nothing: `FOUND` is false, `v_tx_id` remains the `gen_random_uuid()` value assigned at line 88 (before the failed `INSERT`), and the function returns that random UUID. No transaction with that UUID exists in the database.

The `post_transaction` function does not internally set `SERIALIZABLE` isolation — it relies on the caller to do so (CLAUDE.md Invariant #4). A caller that forgets to use SERIALIZABLE, or uses READ COMMITTED, hits this window reliably under concurrent load. Even under SERIALIZABLE, the loser's outer transaction would receive a `40001` serialization failure rather than gracefully returning the winner's UUID, so the happy-path claim in the comment is only true if the caller's outer transaction is SERIALIZABLE **and** the winner commits before the loser's `EXCEPTION` handler fires.

**Fix:** After the re-`SELECT`, check `FOUND` and raise an explicit error if the row is not present:

```sql
EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_tx_id
      FROM transactions
     WHERE idempotency_key = p_idempotency_key;
    IF NOT FOUND THEN
      -- Winner rolled back; caller must retry.
      RAISE EXCEPTION 'post_transaction: concurrent idempotency race — winner rolled back, retry required'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_tx_id;
END;
```

Raising `40001` (serialization_failure) signals the caller to retry with the standard retry loop (CLAUDE.md Invariant #5), rather than silently returning a phantom UUID.

---

### CR-02: `check_double_entry_balance()` lacks `SET search_path` — double-entry backstop is vulnerable to search-path injection

**File:** `packages/core/migrations/0005_double_entry_trigger.sql:15-45`

**Issue:** The trigger function `check_double_entry_balance()` is created without `SET search_path = public` and without `SECURITY DEFINER`:

```sql
CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
-- ... queries FROM postings WHERE transaction_id = NEW.transaction_id
```

The function runs in the security context of the invoking user (not SECURITY DEFINER). When a superuser or `aprumo_migration` session has set a custom `search_path` before the transaction commits, the deferred trigger fires with that session's `search_path`. A malicious or misconfigured session could place a shadow `postings` table in a schema earlier in `search_path` that always returns a balanced sum, bypassing the integrity check entirely.

This is in direct contrast with `audit_row_change()` in `0004_audit_triggers.sql`, which correctly includes both `SECURITY DEFINER` and `SET search_path = public` with the explicit comment "prevents search-path injection attacks (T-2-03)." The same rationale applies here — the double-entry constraint is the final safety net for CLAUDE.md Invariant #2.

Note: direct `INSERT` by superuser bypasses `post_transaction`'s application-level balance check but must still be caught by this trigger. If the trigger can be subverted via `search_path`, Invariant #2 has no backstop.

**Fix:** Add `SECURITY DEFINER` and `SET search_path = public` to the function:

```sql
CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
```

Also set `OWNER TO aprumo_migration` so `SECURITY DEFINER` runs with migration-level privileges (consistent with `post_transaction`):

```sql
ALTER FUNCTION check_double_entry_balance()
  OWNER TO aprumo_migration;
```

---

### CR-03: `reset.ts` NODE_ENV guard allows destructive execution in `staging`, `test`, and any non-production environment

**File:** `packages/core/src/db/reset.ts:24-27`

**Issue:** The guard only refuses to run when `NODE_ENV === "production"`:

```typescript
const nodeEnv = process.env.NODE_ENV;
if (nodeEnv === "production") {
  throw new Error("db:reset refused: NODE_ENV=production. ...");
}
```

Any other value — `staging`, `test`, `undefined`, `"PRODUCTION"` (case-sensitive mismatch) — allows the destructive `DROP DATABASE` / `CREATE DATABASE` sequence to proceed. A developer who runs `NODE_ENV=staging tsx src/db/reset.ts` against a staging environment will silently drop the database. The script is also exposed to inadvertent execution when `NODE_ENV` is unset (the common case for local shells that have not exported the variable), which means the guard provides no protection at all for the most common developer workflow.

**Fix:** Invert the guard to an explicit allowlist:

```typescript
const nodeEnv = process.env.NODE_ENV;
const ALLOWED_ENVS = new Set(["development", "test", "ci"]);
if (!ALLOWED_ENVS.has(nodeEnv ?? "")) {
  throw new Error(
    `db:reset refused: NODE_ENV="${nodeEnv ?? "(unset)"}". ` +
    `Only allowed in: ${[...ALLOWED_ENVS].join(", ")}. ` +
    "This command is for development/CI use only."
  );
}
```

This refuses execution when `NODE_ENV` is unset, `production`, `staging`, or any value not in the explicit allowlist.

---

### CR-04: `createTestDb()` crashes with `Invalid URL` when Docker is unavailable — no diagnostic skip

**File:** `packages/core/tests/helpers/createTestDb.ts:49-107`

**Issue:** When Docker is unavailable, `globalSetup.ts` sets `pgUri` to `""` (empty string). `createTestDb()` calls `inject("pgUri")` and immediately passes the empty string to `postgres(pgUri, …)` at line 54 and `new URL(pgUri)` at line 107. `new URL("")` throws `Invalid URL` — a cryptic Node.js URL parse error that gives no indication this is a Docker-unavailability issue. Developers debugging CI failures without Docker will see this error in every integration test file that calls `createTestDb()`.

Contrast this with the integration tests in `applyMigrationsToSchema.test.ts`, `globalSetup.race.test.ts`, and others, which correctly guard:

```typescript
const pgUri = inject("pgUri");
if (!pgUri) {
  console.warn("Skipping integration test — no pgUri (Docker unavailable)");
  return;
}
```

`createTestDb()` lacks this guard and instead crashes at `postgres("")` or `new URL("")`.

**Fix:** Add a guard at the top of `createTestDb()`:

```typescript
export async function createTestDb(testPath: string): Promise<TestDb> {
  const pgUri = inject("pgUri");
  if (!pgUri) {
    throw new Error(
      "createTestDb: pgUri is empty — Docker is unavailable. " +
      "Integration tests require a running Docker daemon."
    );
  }
  // ... rest unchanged
}
```

A clear error message avoids the `Invalid URL` red-herring and preserves the fail-fast contract (these tests must have a DB; they cannot silently skip).

---

## Warnings

### WR-01: `audit_row_change()` is missing `OWNER TO aprumo_migration` — SECURITY DEFINER runs as superuser

**File:** `packages/core/migrations/0004_audit_triggers.sql:22-49`

**Issue:** `audit_row_change()` is created with `SECURITY DEFINER` but without an explicit `OWNER TO aprumo_migration` statement. When the migration runner is the superuser (as in development and CI), the function is owned by the superuser. A `SECURITY DEFINER` function owned by the superuser runs with superuser privileges — far more power than necessary for inserting a row into an `*_audit` shadow table.

`0003_post_transaction.sql` correctly sets `OWNER TO aprumo_migration` with an explicit comment explaining why. `0004` omits this step.

**Fix:** Add after the function definition:

```sql
ALTER FUNCTION audit_row_change()
  OWNER TO aprumo_migration;
```

---

### WR-02: `aprumo_app` has no path to `INSERT` into `raw_events` — webhook ingestion will fail at runtime

**File:** `packages/core/migrations/0007_revoke_insert_append_only.sql:18-19`

**Issue:** Migration 0007 revokes `INSERT` on `raw_events` from `aprumo_app`. Unlike `postings` (which has the `post_transaction` SECURITY DEFINER function as its sole write path), `raw_events` has no equivalent SECURITY DEFINER function. The webhook ingestion flow must INSERT into `raw_events` to fulfill CLAUDE.md Invariant #4 (exact-once of webhook). With INSERT revoked and no SECURITY DEFINER function provided, any code running as `aprumo_app` that attempts to ingest a webhook will receive `42501 (insufficient_privilege)`.

This is a v0.1 architectural gap: the schema is fully locked down but the write path for `raw_events` is not yet implemented. The constraint is architecturally correct (only a controlled SECURITY DEFINER function should write to append-only tables), but the function does not yet exist.

**Fix:** Before shipping any webhook ingestion code, create a `SECURITY DEFINER` function (e.g., `ingest_raw_event(...)`) owned by `aprumo_migration` that performs the transactional `INSERT INTO raw_events` + pg-boss job enqueue atomically (CLAUDE.md Invariant #4). Grant `EXECUTE` on that function to `aprumo_app`. The fix is architectural and belongs in Phase 03 or the webhooks package, but the gap should be tracked.

---

### WR-03: `schema.ts` postings index is declared ASC but migration 0010 creates it DESC — Drizzle introspection drift

**File:** `packages/core/src/db/schema.ts:107` and `packages/core/migrations/0010_postings_created_at.sql:19`

**Issue:** `schema.ts` declares:

```typescript
index("postings_created_at_idx").on(table.created_at),  // ← no .desc()
```

Drizzle ORM generates an `ASC` index for this. However, `0010_postings_created_at.sql` creates:

```sql
CREATE INDEX "postings_created_at_idx" ON "postings" ("created_at" DESC);
```

The live database has a `DESC` index. When `drizzle-kit introspect` or `drizzle-kit check` compares `schema.ts` against the live database, it detects a direction mismatch and may generate a spurious migration to drop and recreate the index. This does not affect runtime correctness (both ASC and DESC indexes support ORDER BY in both directions via index scan reversal), but it will confuse the next developer who runs `pnpm drizzle-kit generate` and sees an unexpected index migration.

**Fix:** Update `schema.ts` to match the actual DESC direction:

```typescript
index("postings_created_at_idx").on(table.created_at).desc(),
```

---

### WR-04: Dual `globalSetup` paths — container may start twice when running full workspace

**File:** `packages/core/vitest.config.ts:9` and `vitest.config.ts:17`

**Issue:** `packages/core/vitest.config.ts` defines:

```typescript
globalSetup: ["./tests/globalSetup.ts"],
```

The root `vitest.config.ts` also defines:

```typescript
globalSetup: ["packages/core/tests/globalSetup.ts"],
```

In Vitest workspace mode, both the root-level `globalSetup` and each project's `globalSetup` run. When tests are executed via the root config (the default `pnpm test`), `globalSetup.ts` runs once at the workspace level (root) and again as the per-project setup for `@aprumo/core`. This starts **two** PostgreSQL containers: the root-level container (whose URI is provided to all projects via `project.provide`) and the per-project container (whose URI is not re-provided). The per-project container is leaked unless the per-project teardown returns a paired `container.stop()`.

The practical impact: double the container startup time, one leaked container per run, and potential port conflicts on heavily parallelised CI runners.

**Fix:** Remove `globalSetup` from `packages/core/vitest.config.ts`. The root config already handles it. The per-package config should only declare project-specific settings (name, include patterns, pool, timeouts):

```typescript
// packages/core/vitest.config.ts — remove globalSetup line
export default defineConfig({
  test: {
    name: "@aprumo/core",
    pool: "forks",
    // globalSetup is handled by the root vitest.config.ts
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

---

### WR-05: `reset.ts` comment claims URL parsing "avoids regex fragility" but the actual concern is different

**File:** `packages/core/src/db/reset.ts:38-43`

**Issue:** The comment states:

```typescript
// Using the URL class avoids the regex fragility where a "/" in the password
// portion could match the database-path segment
```

This is technically correct, but the more important security property of using `new URL()` is that it canonicalises the connection string and prevents path traversal in the `dbName` variable from being injected into the reconstructed URL. However, the `dbName` is then used directly in:

```typescript
await sql`DROP DATABASE IF EXISTS ${sql(dbName)}`;
```

The `postgres-js` tagged template with `${sql(dbName)}` uses identifier quoting (double-quotes), which prevents SQL injection. This is safe. However, `dbName` is user-controlled via `RESET_DB_NAME` environment variable with no validation — a value like `"aprumo"; SELECT pg_sleep(60); --` would be quoted by `sql()` as `"aprumo""; SELECT pg_sleep(60); --"` which Postgres would reject as a syntax error. The quoting protection holds, but the absence of any validation means typos in `RESET_DB_NAME` would silently drop the wrong database.

**Fix:** Add basic validation for `dbName`:

```typescript
if (!/^[a-z][a-z0-9_]*$/.test(dbName)) {
  throw new Error(`db:reset refused: invalid database name "${dbName}". Must match /^[a-z][a-z0-9_]*$/`);
}
```

---

## Info

### IN-01: `0009_account_balance_last_posting_fk.sql` uses `NOT VALID` without a documented plan to validate

**File:** `packages/core/migrations/0009_account_balance_last_posting_fk.sql:10-13`

**Issue:** The migration correctly adds the FK `NOT VALID` to avoid a full-table scan on an empty table. The comment says "Run VALIDATE CONSTRAINT when the worker is implemented to backfill and validate." However, there is no corresponding task in the ROADMAP or phase plan that tracks this. Without a tracked task, `VALIDATE CONSTRAINT` is likely to be forgotten, leaving the FK permanently `NOT VALID` — which means it enforces on new writes but never validates existing rows when the balance worker eventually populates `last_posting_id`.

**Fix:** Add a tracking issue or ROADMAP entry: "VALIDATE CONSTRAINT `account_balance_last_posting_fk` after balance worker first run." A `TODO` comment referencing the ADR or ROADMAP task ID in the migration itself would also suffice.

---

### IN-02: `applyMigrationsToSchema.ts` `readWithRetry` uses 10 retries for a "transient ENOENT" that should never occur

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:232-257`

**Issue:** The function `readWithRetry` retries up to 10 times on `ENOENT` with exponential backoff (up to 500ms). The comment explains this as a macOS APFS behaviour under heavy concurrent I/O. However:

1. Migration files are static assets committed to git. `ENOENT` on a file that definitely exists in the repository is extremely unlikely except under filesystem corruption or incorrect path construction.
2. Ten retries with up to 500ms each means a worst-case wait of ~5 seconds per migration file per test file. With 10 migrations and, say, 10 test files running in parallel, the worst-case overhead is 500 seconds of retry delays.
3. The original comment says "macOS APFS can transiently return ENOENT under heavy concurrent I/O (10+ forks)." This is a real macOS APFS quirk under `O_EXCL` file creation, but not for `readFileSync` on existing files. The correct mitigation for concurrent read ENOENT on APFS is typically `fs.open()` with retry, but 10 attempts is high.

**Fix:** Reduce retry count to 3 (matching the original comment that says "up to 3 retries"). If 3 retries are insufficient, investigate the APFS configuration. The current 10-retry loop is a code smell masking a potentially incorrect path or race in the test framework setup.

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
