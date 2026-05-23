---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-05-23T00:00:00Z
depth: standard
files_reviewed: 49
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
  - packages/core/src/db/schema.ts
  - packages/core/src/db/seed.ts
  - packages/core/tests/e2e/migration-e2e.integration.test.ts
  - packages/core/tests/globalSetup.ts
  - packages/core/tests/helpers/applyMigrationsToSchema.ts
  - packages/core/tests/helpers/createTestDb.ts
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
  warning: 4
  info: 3
  total: 9
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 49
**Status:** issues_found

## Summary

This phase delivers the Postgres schema DDL, migration runner, role/permission model, `post_transaction` SECURITY DEFINER function, audit triggers, deferred double-entry constraint trigger, hash-based drift gate, and the full test harness with testcontainers and per-schema isolation. The overall architecture is well-reasoned and the layered invariant enforcement (REVOKE + SECURITY DEFINER + deferred constraint trigger) is conceptually correct.

Two critical defects were found. First, `aprumo_app` actually retains direct `INSERT` privilege on the `postings` table — the broad `GRANT SELECT, INSERT ON ALL TABLES` is never followed by a matching `REVOKE INSERT`, only `REVOKE UPDATE, DELETE`. Comments throughout the codebase claim the opposite, and the architecture of the SECURITY DEFINER function depends on it. Second, the idempotency guard in `post_transaction` is a SELECT-then-INSERT sequence with no concurrent-duplicate handler; two simultaneous calls with the same key will both pass the SELECT guard and then race to INSERT, causing the loser to throw a `unique_violation` instead of silently returning the existing transaction ID.

Four warnings cover: missing `TESTCONTAINERS_RYUK_DISABLED` env var on the coverage CI job (causing intermittent Ryuk failures on GitHub runners), a fragile URL regex in `reset.ts`, a nullable `last_posting_id` cursor column with no FK validation, and a latent named-dollar-quote parsing gap in the test migration splitter.

---

## Critical Issues

### CR-01: `aprumo_app` retains direct INSERT privilege on `postings` — SECURITY DEFINER sole-write-path invariant is not enforced at the DB layer

**File:** `packages/core/migrations/0002_grants.sql:8-12`

**Issue:** The grants migration issues a broad privilege grant and then only partially revokes it:

```sql
-- Line 8
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aprumo_app;

-- Lines 11-12 — only UPDATE and DELETE are revoked; INSERT is NOT revoked
REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app;
REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app;
```

The `aprumo_app` role retains `INSERT` on both `postings` and `raw_events`. This directly contradicts multiple explicit claims in the codebase:

- `0003_post_transaction.sql` line 8: "even when called by aprumo_app (which has EXECUTE on the function but **NO direct INSERT privilege on postings**)"
- `0003_post_transaction.sql` line 118: "DO NOT grant INSERT ON postings to aprumo_app here or anywhere (sole write path invariant)"
- CLAUDE.md Invariant #1: post_transaction is intended to be the sole write path into postings

The test in `post-transaction.integration.test.ts:183-196` is supposed to verify the sole-write-path invariant but explicitly accepts a FK violation (`23503`) and comments it away: "The 'sole write path' invariant is enforced by the double-entry CONSTRAINT TRIGGER ... not by revoking INSERT on postings." This is architecturally incorrect — the deferred constraint trigger fires at COMMIT time and only checks balance; it does not prevent a malicious or buggy application from inserting a valid balanced pair of postings directly, bypassing `post_transaction`'s validation logic (e.g., the non-empty-array check, the non-zero amount check, the direction validation, the idempotency guard).

**Fix:** After the broad grant, also revoke INSERT on the append-only tables:

```sql
-- After line 8, add:
REVOKE INSERT ON TABLE postings FROM aprumo_app;
REVOKE INSERT ON TABLE raw_events FROM aprumo_app;
```

This requires a new migration (the committed `0002_grants.sql` is immutable). The test at `post-transaction.integration.test.ts:183` must be updated to expect `42501` (permission denied) instead of `23503`, and its comment must be corrected.

---

### CR-02: TOCTOU race in `post_transaction` idempotency guard — concurrent duplicate calls throw `unique_violation` instead of returning silently

**File:** `packages/core/migrations/0003_post_transaction.sql:45-51`

**Issue:** The idempotency guard uses a SELECT-then-INSERT pattern with no concurrent-duplicate handler:

```sql
-- Lines 45-51
SELECT id INTO v_tx_id
  FROM transactions
 WHERE idempotency_key = p_idempotency_key;

IF FOUND THEN
  RETURN v_tx_id;   -- early return for known key
END IF;
-- ... validation ...
INSERT INTO transactions (id, idempotency_key, ...) VALUES (...);
```

Two concurrent calls with the same `p_idempotency_key` can both execute the `SELECT`, both find `FOUND = false`, both pass the guard, and then race to the `INSERT`. The losing INSERT hits the `UNIQUE (idempotency_key)` constraint and raises SQLSTATE `23505` (`unique_violation`). There is no `EXCEPTION WHEN unique_violation` handler anywhere in the function. The function propagates the error to the caller.

CLAUDE.md Invariant #3 mandates: "Duplicatas retornam 200 OK sem reprocessar — nunca falham com erro." This race violates that invariant under any concurrent load. The idempotency test in `post-transaction.integration.test.ts:73-96` is sequential (two `await` calls in series), so it does not catch the concurrent case.

**Fix:** Add an exception handler that catches `unique_violation` and fetches the winning call's result:

```sql
DECLARE
  v_tx_id      uuid;
  v_signed_sum bigint := 0;
  v_rec        posting_input;
BEGIN
  -- Idempotency guard (fast path — already committed)
  SELECT id INTO v_tx_id
    FROM transactions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_tx_id;
  END IF;

  -- ... validation logic unchanged ...

  -- Atomic INSERT with race handler
  v_tx_id := gen_random_uuid();
  BEGIN
    INSERT INTO transactions (id, idempotency_key, ts, description, source, metadata)
    VALUES (v_tx_id, p_idempotency_key, now(), p_description, p_source, p_metadata);
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent call won the INSERT race; return the winner's id.
    SELECT id INTO v_tx_id
      FROM transactions
     WHERE idempotency_key = p_idempotency_key;
    RETURN v_tx_id;
  END;

  -- Insert postings only when this call won the INSERT race.
  FOREACH v_rec IN ARRAY p_postings LOOP
    INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
    VALUES (gen_random_uuid(), v_tx_id, v_rec.account_id, v_rec.amount_cents, v_rec.direction);
  END LOOP;

  RETURN v_tx_id;
END;
```

This requires a new migration since `0003_post_transaction.sql` is immutable.

---

## Warnings

### WR-01: `coverage-gate` CI job lacks `TESTCONTAINERS_RYUK_DISABLED=true` and has no `needs:` dependency

**File:** `.github/workflows/ci.yml:74-97`

**Issue:** The `integration-test` job (line 134) correctly sets `TESTCONTAINERS_RYUK_DISABLED: "true"` because GitHub-hosted Ubuntu runners' Docker daemon can fail when Ryuk tries to manage container cleanup. The `coverage-gate` job runs `pnpm vitest run --coverage`, which triggers the same testcontainers-backed integration tests (the root `vitest.config.ts` includes `packages/core/tests/globalSetup.ts`), but sets no env vars at all. On GitHub-hosted runners this produces intermittent Ryuk errors that fail the coverage job for reasons unrelated to code coverage.

Additionally, `coverage-gate` has no `needs:` clause, so it runs concurrently with `typecheck` and `build`. If `typecheck` fails, the coverage gate can still produce a green status for the run.

**Fix:**
```yaml
coverage-gate:
  name: Coverage Gate
  needs: [lint, typecheck, build]      # add dependency
  runs-on: ubuntu-latest
  ...
  steps:
    ...
    - name: Run tests with coverage
      run: pnpm vitest run --coverage
      env:
        DATABASE_URL: ""
        TESTCONTAINERS_RYUK_DISABLED: "true"   # add Ryuk flag
```

---

### WR-02: `reset.ts` URL regex is fragile for PostgreSQL connection strings with special characters in credentials

**File:** `packages/core/src/db/reset.ts:39`

**Issue:** The system database URL is derived by:
```typescript
const systemUrl = appDbUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres");
```

This replaces the last `/path-segment` (optionally followed by `?query`) with `/postgres`. If the `DATABASE_URL` password contains a `/` character (allowed in URL-encoded form and sometimes passed raw in local dev environments — e.g., `postgres://user:pa/ss@host:5432/appdb`), the regex matches inside the credential portion, not the database path. The resulting `systemUrl` would be malformed, causing a connection failure with no clear diagnostic.

**Fix:** Use the `URL` class (already imported via `node:url` in this file) for reliable URL manipulation:
```typescript
const parsed = new URL(appDbUrl);
parsed.pathname = "/postgres";
const systemUrl = parsed.toString();
```

---

### WR-03: `account_balance.last_posting_id` has no FK constraint — balance worker cursor is unvalidated at the DB layer

**File:** `packages/core/src/db/schema.ts:146` and `packages/core/migrations/0000_init_tables.sql:15`

**Issue:** The `account_balance.last_posting_id` column is defined as a bare nullable UUID with no FK reference:
```typescript
// schema.ts line 146
last_posting_id: uuid("last_posting_id"),
```
The DDL confirms no FK clause. A bug in the incremental balance worker that sets a wrong UUID as the cursor would be accepted by Postgres silently. The worker would then compute balances from an invalid anchor position, producing incorrect account balances without any database-level error.

Since `postings` is append-only (no DELETE), a FK here carries no risk of cascade-delete side effects — only the correctness benefit of referential integrity enforcement.

**Fix:** Add the FK reference in the Drizzle schema (this requires a new migration):
```typescript
last_posting_id: uuid("last_posting_id").references(() => postings.id),
```
If existing rows may have `NULL` in this column (they will in v0.1 before the worker runs), the FK can be added `NOT VALID` and validated later.

---

### WR-04: `splitMigrationStatements` dollar-quote parser does not handle named dollar-quotes — future migrations using `$tag$...$tag$` will mis-split

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:88-93`

**Issue:** The dollar-quote state machine toggles `inDollarQuote` on every `$$` pair:
```typescript
if (!inLineComment && ch === "$" && next === "$") {
  inDollarQuote = !inDollarQuote;
  current += "$$";
  i += 2;
  continue;
}
```

PostgreSQL also supports named dollar-quotes: `$tag$...$tag$` (e.g., `$function$`, `$body$`). A `$tag$` delimiter contains a `$$` substring at position 0 and its last character pair. The current parser does not distinguish tag boundaries — it treats any two adjacent `$` characters as a toggle. A migration using `$function$...$function$` would enter `inDollarQuote = true` on the first `$$` inside `$function$`, then exit it prematurely on the next `$$` pair encountered (possibly the opening of the matching `$function$` close-delimiter or another `$$` elsewhere). This produces incorrect statement boundaries.

No current migration uses named dollar-quotes (all use `$$`), so this is latent. It will silently fail when any future hand-written migration adopts named dollar-quote style.

**Fix:** Capture the full dollar-quote delimiter (tag) and require the same tag to close:
```typescript
// Replace the simple toggle with tag-aware matching:
if (!inLineComment && ch === "$") {
  // Find the closing $ of this potential dollar-quote delimiter
  const closeIdx = sql.indexOf("$", i + 1);
  if (closeIdx !== -1) {
    const tag = sql.slice(i, closeIdx + 1); // e.g. "$$" or "$func$"
    if (!inDollarQuote) {
      // Check that the tag ends with $ and has no whitespace (PG rule)
      if (/^\$[A-Za-z0-9_]*\$$/.test(tag)) {
        currentDollarTag = tag;
        inDollarQuote = true;
        current += tag;
        i = closeIdx + 1;
        continue;
      }
    } else if (tag === currentDollarTag) {
      inDollarQuote = false;
      currentDollarTag = null;
      current += tag;
      i = closeIdx + 1;
      continue;
    }
  }
}
```

---

## Info

### IN-01: `console.log` / `console.error` in CLI scripts published as part of `@aprumo/core`

**File:** `packages/core/src/db/migrate.ts:159,163`, `packages/core/src/db/reset.ts:57,75`, `packages/core/src/db/seed.ts:43,61`

**Issue:** CLAUDE.md mandates structured logging (pino) and prohibits `console.log` in production code. The CLI entry points in `migrate.ts`, `reset.ts`, and `seed.ts` use `console.log` and `console.error`. These are tooling/CLI scripts, not request handlers, so the risk is low — but they are part of the published package (`migrations/` is in `files`) and violate the project convention. They will also trigger the project's `console.log` audit hook.

**Fix:** Route diagnostic output through `process.stdout.write` / `process.stderr.write`, or configure a pino logger with `destination: process.stdout` for these CLI scripts.

---

### IN-02: Test container uses Postgres 18 while CLAUDE.md specifies "Postgres 16+" as the supported version

**File:** `packages/core/tests/setup/container.ts:5-6`

**Issue:** The pinned image is `postgres:18-alpine@sha256:96d56f7f...`. Postgres 18 is not yet generally available. CLAUDE.md states "DB: Postgres 16+" as the supported version. Testing exclusively on an unreleased/pre-GA Postgres version while the documented minimum is 16 creates a gap: production deployments on Postgres 16 or 17 may encounter different behavior for `pg_authid` row locking, constraint trigger semantics, or plpgsql type resolution.

**Fix:** Pin the test container to `postgres:16-alpine` (the documented minimum) to verify that the migration stack works on the minimum supported version, or add a Postgres version matrix analogous to the Node version matrix in the `test` CI job.

---

### IN-03: `migration-drift.test.ts` uses bare `__dirname` which is a CommonJS global not available in native ESM

**File:** `packages/core/tests/infra/migration-drift.test.ts:18`

**Issue:**
```typescript
const REPO_ROOT = resolve(__dirname, "../../../../");
```
The package is `"type": "module"` (ESM). Bare `__dirname` is not defined in native ESM. This currently works because Vitest's transpilation shim provides `__dirname`. If the compilation toolchain changes, or the test is run under a stricter ESM environment, this will throw `ReferenceError: __dirname is not defined`.

All other test helpers correctly use the `fileURLToPath(import.meta.url)` pattern (`applyMigrationsToSchema.ts`, `createTestDb.ts`, `migrate.ts`, the two `.mjs` scripts).

**Fix:**
```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../../");
```

---

_Reviewed: 2026-05-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
