---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 48
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
  - packages/core/migrations/meta/0000_snapshot.json
  - packages/core/migrations/meta/0001_snapshot.json
  - packages/core/migrations/meta/0002_snapshot.json
  - packages/core/migrations/meta/0003_snapshot.json
  - packages/core/migrations/meta/0004_snapshot.json
  - packages/core/migrations/meta/0005_snapshot.json
  - packages/core/migrations/meta/0006_snapshot.json
  - packages/core/migrations/meta/_journal.json
  - packages/core/migrations/migration-hashes.json
  - packages/core/package.json
  - packages/core/src/db/migrate.ts
  - packages/core/src/db/reset.ts
  - packages/core/src/db/seed.ts
  - packages/core/src/db/schema.ts
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
  critical: 4
  warning: 6
  info: 4
  total: 14
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 48
**Status:** issues_found

## Summary

This review covers the schema foundation phase of the Aprumo financial ledger: PostgreSQL DDL migrations (0000–0009, including the three outside the original scope list but already committed and referenced in `migration-hashes.json`), the Drizzle schema definition, migration runner, reset/seed tooling, test infrastructure (testcontainers + per-schema isolation), CI workflow, and drift-gate scripts.

The overall quality is high. Critical invariants — append-only tables, double-entry balance, idempotency, SECURITY DEFINER sole-write-path — are properly engineered and tested with real Postgres containers. The per-schema isolation approach is well-designed and the dollar-quote parser is thoughtful. However, four issues were found with correctness or security consequences: a validation ordering bug in `post_transaction`, a single-transaction wrapping bug in the production migration runner, an unsafe environment guard in `reset.ts`, and a latent parser bug in the test SQL splitter. Six warnings and four info items follow.

---

## Critical Issues

### CR-01: `post_transaction` validates `amount_cents` AFTER accumulating the signed sum — BIGINT overflow can silently produce a zero sum for extreme-value postings

**File:** `packages/core/migrations/0003_post_transaction.sql:61-81`

**Issue:** Inside the `FOREACH` loop the direction branch accumulates `v_signed_sum` before the `amount_cents <= 0` check fires. For ordinary inputs this is fine because PostgreSQL raises an integer overflow exception if `v_signed_sum + amount_cents` overflows BIGINT. However, consider two postings of BIGINT MAX (`9223372036854775807`) each — one debit, one credit. The signed sum calculation is `9223372036854775807 - 9223372036854775807 = 0` and does NOT overflow because the subtraction cancels. The balance check passes. The positivity check then passes because both values are `> 0`. The function proceeds to insert two postings each carrying `9223372036854775807` cents. This is not directly exploitable for financial gain (debits and credits cancel), but it allows inserting values that will almost certainly cause overflow in any downstream arithmetic (balance worker, reports) that sums these amounts. The invariant intent was to validate inputs before operating on them; the current ordering violates that principle.

The same logic exists in `0008_post_transaction_idempotency_race.sql:54-74` (which supersedes 0003 at runtime).

**Fix:** Move the positivity check before the signed-sum accumulation in both migration files. Apply the same fix to `0008_post_transaction_idempotency_race.sql`.

```sql
FOREACH v_rec IN ARRAY p_postings LOOP
  -- Validate amount_cents FIRST — before any arithmetic.
  IF v_rec.amount_cents <= 0 THEN
    RAISE EXCEPTION
      'post_transaction: amount_cents must be positive, got %',
      v_rec.amount_cents
      USING ERRCODE = 'P0001';
  END IF;

  -- Now safe to accumulate.
  IF v_rec.direction = 'debit' THEN
    v_signed_sum := v_signed_sum + v_rec.amount_cents;
  ELSIF v_rec.direction = 'credit' THEN
    v_signed_sum := v_signed_sum - v_rec.amount_cents;
  ELSE
    RAISE EXCEPTION
      'post_transaction: invalid direction %, must be debit or credit',
      v_rec.direction
      USING ERRCODE = 'P0001';
  END IF;
END LOOP;
```

---

### CR-02: `migrate.ts` wraps ALL pending migrations in a single outer transaction — a failure in migration N rolls back successfully-completed migrations N-1, N-2, … which are then retried against non-idempotent DDL

**File:** `packages/core/src/db/migrate.ts:108-145`

**Issue:** The production migration runner opens one `sql.begin()` that spans all pending migrations and the tracking INSERTs (lines 108–145). If there are three unapplied migrations (A, B, C) and C fails, the entire transaction rolls back. Migrations A and B are rolled back. On the next invocation, A and B are retried — but the DDL in `0000_init_tables.sql` uses `CREATE TABLE` without `IF NOT EXISTS`. Retrying `CREATE TABLE "accounts"` after it was previously created (and then rolled back) will fail with `42P07 (duplicate_table)`. This means a single bad migration can permanently lock the runner in a loop.

Note: `applyMigrationsToSchema.ts` (the test helper) correctly uses a per-migration `sql.begin()` inside the loop at line 352 — it does not have this bug. The production runner should follow the same pattern.

**Fix:** Move the `sql.begin()` inside the loop so each migration is committed atomically before advancing to the next:

```typescript
for (const migration of migrations) {
  if (appliedHashes.has(migration.hash)) continue;

  await sql.begin(async (tx) => {
    for (const statement of migration.sql) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await tx.unsafe(trimmed);
    }
    await tx`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${migration.hash}, ${migration.folderMillis})
    `;
  });
}
```

---

### CR-03: `reset.ts` environment guard uses a deny-list (`!== 'production'`) — any non-production value (`staging`, `ci`, unset) allows a destructive `DROP DATABASE`

**File:** `packages/core/src/db/reset.ts:24-27`

**Issue:** The guard is:
```typescript
if (nodeEnv === "production") {
  throw new Error("db:reset refused: NODE_ENV=production...");
}
```

This permits `DROP DATABASE` when `NODE_ENV` is `"staging"`, `"ci"`, `"test"`, or `undefined`. In a CI pipeline where `DATABASE_URL` points to a shared test cluster and `NODE_ENV` is unset or `"test"`, `pnpm db:reset` will succeed and destroy the database. For a financial ledger where the database is the source of truth, this is a data-loss risk.

**Fix:** Flip to an allowlist:

```typescript
const SAFE_ENVS = new Set(["development", "test"]);
const nodeEnv = process.env.NODE_ENV ?? "";
if (!SAFE_ENVS.has(nodeEnv)) {
  throw new Error(
    `db:reset refused: NODE_ENV="${nodeEnv}" is not a permitted environment. ` +
    `Allowed values: development, test.`
  );
}
```

---

### CR-04: `splitMigrationStatements` dollar-quote parser has a greedy `indexOf` scan that can misidentify `$identifier` expressions as dollar-quote delimiters, corrupting statement boundaries

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:95-116`

**Issue:** At line 96, when the parser encounters a `$` character it runs:
```typescript
const closeIdx = sql.indexOf("$", i + 1);
```
This finds the **next** `$` anywhere in the remaining string, not the closing `$` of the potential tag. If the SQL contains a bare `$1` parameter placeholder (e.g., in a migration that uses server-side prepared statement syntax) or a `$var` PL/pgSQL variable reference, the parser will build a tag string from `$` to the next `$` — which could span across lines. The guard `(/^\$[A-Za-z0-9_]*\$$/.test(tag))` prevents most false positives (e.g., `$1` produces tag `$1...nextDollar$` which fails the regex unless the next `$` is right after a word-char). But if the next `$` happens to be adjacent (e.g., `$$` appears two characters after a `$1` in `$1$$`), the parser will enter dollar-quote mode spuriously. The current migrations do not trigger this, but it is a latent correctness bug for future hand-written migrations.

The parser also has no awareness of single-quoted string literals — a semicolon inside `'a;b'` would split the statement incorrectly.

**Fix:** Rewrite the dollar-quote open-tag detection to only match at the current position without a greedy forward scan. An alternative is to scan only up to the next non-identifier character from `i+1`:

```typescript
if (ch === "$" && !inLineComment && !inSingleQuote) {
  // Read the potential tag inline: $[word_chars]*$
  let j = i + 1;
  while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j] ?? "")) j++;
  if ((sql[j] ?? "") === "$") {
    const tag = sql.slice(i, j + 1); // e.g. "$$" or "$function$"
    if (!inDollarQuote) {
      currentDollarTag = tag;
      inDollarQuote = true;
      current += tag;
      i = j + 1;
      continue;
    } else if (tag === currentDollarTag) {
      inDollarQuote = false;
      currentDollarTag = null;
      current += tag;
      i = j + 1;
      continue;
    }
  }
}
```

---

## Warnings

### WR-01: `0002_grants.sql` grants INSERT on `postings` and `raw_events` to `aprumo_app` — the revocation is deferred six migrations later in 0007, leaving a privilege gap in partially-migrated states

**File:** `packages/core/migrations/0002_grants.sql:8`

**Issue:** `GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aprumo_app` includes `postings` and `raw_events`. The INSERT revocation happens in `0007_revoke_insert_append_only.sql`. Any database that has had 0002–0006 applied but not 0007 has `aprumo_app` with direct INSERT on the append-only tables, violating CLAUDE.md Invariant #1. The comment in `0003_post_transaction.sql` line 118 explicitly says "DO NOT grant INSERT ON postings to aprumo_app here or anywhere" — but 0002 does exactly that, relying on a later migration to fix it.

**Fix:** Restructure 0002 to grant INSERT on each table individually, excluding `postings` and `raw_events` from INSERT from the outset:

```sql
GRANT SELECT, INSERT ON TABLE accounts, transactions, account_balance,
  outbound_endpoints, outbound_events,
  accounts_audit, outbound_endpoints_audit, outbound_events_audit
  TO aprumo_app;
-- postings and raw_events: SELECT only (append-only; write path via post_transaction)
GRANT SELECT ON TABLE postings TO aprumo_app;
GRANT SELECT ON TABLE raw_events TO aprumo_app;
```

Since migrations are immutable once committed, this fix would need to be implemented as a new migration (0010 or later) that reverts the GRANT/REVOKE sequence to the clean state, and the existing 0007 remains as-is for the current deployment chain.

---

### WR-02: `outbound_events_audit_trigger` fires on every delivery status update, producing unbounded audit log growth with no pruning strategy

**File:** `packages/core/migrations/0004_audit_triggers.sql:62-65`

**Issue:** The trigger fires AFTER UPDATE OR DELETE on `outbound_events`. The `outbound_events` table is high-frequency operational data: every delivery attempt updates `status`, `attempts`, `last_error`, and `next_attempt_at`. In production with a meaningful webhook fanout, each event generates multiple audit rows (one per retry). `outbound_events_audit` has no TTL, no `changed_at` index, and no partition strategy. It will grow unboundedly and degrade over time.

Unlike `accounts` and `outbound_endpoints` (configuration tables with low update frequency where audit trails are genuinely needed), `outbound_events` state transitions are operational noise for audit purposes.

**Fix:** Remove `outbound_events` from the generic audit trigger. If state transition history is needed for debugging, store it in a dedicated delivery attempt log table with explicit TTL. At minimum, add an index on `outbound_events_audit(changed_at)` before this goes to production.

---

### WR-03: `check-migration-drift.mjs` does not detect SQL files in the migrations directory that are absent from `_journal.json`

**File:** `scripts/check-migration-drift.mjs:65-96`

**Issue:** The script iterates over `_journal.json` entries and checks that each has a matching SQL file and hash. It does NOT scan the `migrations/` directory for `.sql` files that are not registered in the journal. A developer could add a `0010_fix.sql` to the directory without adding it to `_journal.json` — the file is silently ignored by the migration runner, and the drift gate does not flag it.

**Fix:** Add a reverse check:
```javascript
import { readdirSync } from 'node:fs';
const sqlFilesOnDisk = readdirSync(MIGRATIONS_DIR)
  .filter(f => /^\d{4}_.*\.sql$/.test(f))
  .map(f => f.replace(/\.sql$/, ''));
const journalTags = new Set(entries.map(e => e.tag));
for (const tag of sqlFilesOnDisk) {
  if (!journalTags.has(tag)) {
    process.stderr.write(`DRIFT: ${tag}.sql is not registered in _journal.json\n`);
    driftDetected = true;
  }
}
```

---

### WR-04: `createTestDb` grants `ALL PRIVILEGES ON ALL TABLES` to `aprumo_migration` in test schemas, masking the production permission boundary for that role

**File:** `packages/core/tests/helpers/createTestDb.ts:102`

**Issue:**
```typescript
await setupSql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${setupSql(schema)} TO aprumo_migration`;
```
In production, `aprumo_migration` is the table owner and has DDL rights but is not expected to UPDATE/DELETE `postings`/`raw_events` (those tables are append-only by policy, not just by explicit REVOKE). In the test context, `ALL PRIVILEGES` includes UPDATE and DELETE on those tables. Tests using `db.migration` to verify privilege enforcement are testing the superuser role, not the production `aprumo_migration` role. This creates a false sense of security: tests pass for the `aprumo_app` revocation check but do not test that `aprumo_migration` is also restricted.

**Fix:** Grant only the minimum needed — SELECT, INSERT, and EXECUTE on functions — matching what `aprumo_migration` actually needs to run SECURITY DEFINER functions:
```typescript
await setupSql`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${setupSql(schema)} TO aprumo_migration`;
```

---

### WR-05: CI `coverage-gate` job does not declare a dependency on `test` — coverage can show green while a test matrix job is red

**File:** `.github/workflows/ci.yml:79`

**Issue:**
```yaml
coverage-gate:
  needs: [lint, typecheck, build]
```
The `test` job (which runs the full test matrix on Node 22 and 24) is NOT in `needs`. `coverage-gate` and `test` run in parallel. If the Node 24 matrix run fails but the coverage job passes, branch protection that lists only `coverage-gate` as a required check would allow a merge with a failing test. The jobs test different things (coverage does not distinguish Node version behavior), so the independence is intentional, but the ordering creates a CI topology that can mislead.

**Fix:** Either add `test` to `needs`, or explicitly document in the CI YAML that branch protection must require all of `test (Node 22)`, `test (Node 24)`, AND `coverage-gate` as independent required checks.

---

### WR-06: `seed.ts` reads the seed SQL file path from a hardcoded relative path resolved against `__dirname` — there is no path traversal guard if `SEED_SQL_PATH` is overridden

**File:** `packages/core/src/db/seed.ts:25-26`

**Issue:** The seed path is constructed as:
```typescript
const SEED_SQL_PATH = path.resolve(__dirname, "../../migrations/0006_seed_dev.sql");
```
This is safe as written because the path is hardcoded. However, `runSeed` accepts a `databaseUrl` parameter and could be called programmatically. The function has no parameter to override the seed path, so there is no injection vector from external callers. The risk is that `sql.unsafe(seedContent)` executes the full file as multi-statement SQL with no validation. If a dependency confusion attack substitutes the `@aprumo/core` package with a malicious one that contains a modified `0006_seed_dev.sql`, the entire content would run as the migration role.

This is a lower-severity concern for a dev-only path, but the use of `sql.unsafe()` without any content validation (even a basic check that the file contains only a `DO $$` block) is worth noting in a financial application context.

**Fix:** Add a basic structural validation that the seed file begins with the expected `DO $$` pattern before executing, and log the resolved path for audit purposes.

---

## Info

### IN-01: `_journal.json` entries 0007–0009 have anomalous `when` timestamps — round-number, evenly-spaced values in an earlier epoch than entries 0000–0006

**File:** `packages/core/migrations/meta/_journal.json:37-49`

**Issue:** Entries 0000–0006 have `when` values in the `1779483682778`–`1779485643554` range (millisecond timestamps consistent with a specific generation session). Entries 0007–0009 have `when` values `1748044800000`, `1748044860000`, `1748044920000` — exactly 60 seconds apart, round numbers, and corresponding to a different epoch (~2025-05-23 vs. ~2026-04-22). These are manually authored values. The `migrate.ts` runner stores `folderMillis` (the `when` value) as `created_at` in `__drizzle_migrations`, which means the tracking table will have out-of-sequence timestamps for these entries. Any tooling that sorts by `created_at` to determine migration order will produce incorrect results.

**Fix:** Regenerate the journal entries for 0007–0009 using `drizzle-kit generate`, or set the `when` values to be greater than entry 0006's `when` (`1779485643554`) to maintain monotonic ordering in the tracking table.

---

### IN-02: `vitest.config.ts` does not configure the coverage provider — CLAUDE.md specifies v8 but the default may be istanbul

**File:** `packages/core/vitest.config.ts:1-16`

**Issue:** No `coverage` block is present in the Vitest config. CLAUDE.md specifies "coverage v8". Without `provider: 'v8'` in the config, `pnpm vitest run --coverage` will use whatever coverage provider is installed as the default. If `@vitest/coverage-v8` is not the default, coverage will be measured with different instrumentation semantics, and thresholds designed around v8 may not hold.

**Fix:**
```typescript
export default defineConfig({
  test: {
    // ... existing ...
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'lcov'],
      thresholds: { lines: 90 },
    },
  },
});
```

---

### IN-03: `post-transaction.integration.test.ts` sole-write-path tests reference migration 0007 in comments but this dependency is implicit — missing 0007 causes a confusing test failure

**File:** `packages/core/tests/schema/post-transaction.integration.test.ts:184,197`

**Issue:** The immutability tests at lines 183–208 depend on migration 0007 having been applied (which revokes INSERT on `postings`/`raw_events` from `aprumo_app`). Without 0007, `db.app.query(INSERT INTO postings...)` would succeed instead of raising 42501, causing `rejects.toMatchObject({ code: "42501" })` to fail because the promise resolved. The failure message would be confusing. The dependency is undocumented in the test setup.

**Fix:** Add a `beforeAll` check that confirms 0007 is applied, or include a guard assertion that logs a clear diagnostic if 42501 is not the error received.

---

### IN-04: `drizzle.config.ts` lacks a comment prohibiting `drizzle-kit push` — the config silently supports push if credentials are added

**File:** `packages/core/drizzle.config.ts:1-11`

**Issue:** The config does not include `dbCredentials`, which prevents `drizzle-kit push` from working as-is. But there is no comment or guard documenting that `push` is prohibited. A developer adding credentials to run `drizzle-kit studio` could accidentally enable push, which bypasses the migration file system and the drift gate entirely.

**Fix:** Add a prominent comment to `drizzle.config.ts` documenting that `drizzle-kit push` is prohibited and that DDL changes must go through versioned migration files.

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
