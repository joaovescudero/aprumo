---
phase: 02-schema-foundation-db-tooling
fixed_at: 2026-05-23T16:30:00Z
review_path: .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-05-23T16:30:00Z
**Source review:** .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9
- Fixed: 9
- Skipped: 0

## Fixed Issues

### CR-01: `aprumo_app` retains direct INSERT privilege on `postings` — SECURITY DEFINER sole-write-path invariant not enforced

**Files modified:** `packages/core/migrations/0007_revoke_insert_append_only.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0007_snapshot.json`, `packages/core/migrations/migration-hashes.json`, `packages/core/tests/schema/post-transaction.integration.test.ts`
**Commit:** d924824
**Applied fix:** Created migration `0007_revoke_insert_append_only.sql` that issues `REVOKE INSERT ON TABLE postings FROM aprumo_app` and `REVOKE INSERT ON TABLE raw_events FROM aprumo_app`. Updated journal, snapshot, and hashes. Updated the sole-write-path test to expect SQLSTATE `42501` (permission denied) instead of `23503` (FK violation), and added a second test case verifying INSERT into `raw_events` also fails with `42501`. Existing `0002_grants.sql` is not modified (immutable).

---

### CR-02: TOCTOU race in `post_transaction` idempotency guard — concurrent duplicate calls throw `unique_violation`

**Files modified:** `packages/core/migrations/0008_post_transaction_idempotency_race.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0008_snapshot.json`, `packages/core/migrations/migration-hashes.json`
**Commit:** 9ba34ba
**Applied fix:** Created migration `0008_post_transaction_idempotency_race.sql` using `CREATE OR REPLACE FUNCTION`. The new implementation wraps `INSERT INTO transactions` in a nested `BEGIN ... EXCEPTION WHEN unique_violation` block. The losing concurrent call catches the exception, re-fetches the winner's row by idempotency key, and returns that UUID — satisfying CLAUDE.md Invariant #3 without error. Postings are only inserted by the call that won the INSERT race. Existing `0003_post_transaction.sql` is not modified (immutable).
**Status:** fixed: requires human verification (concurrent race logic — sequential tests pass but concurrent behavior requires load testing to confirm)

---

### WR-01: `coverage-gate` CI job lacks `TESTCONTAINERS_RYUK_DISABLED=true` and has no `needs:` dependency

**Files modified:** `.github/workflows/ci.yml`
**Commit:** 47161f6
**Applied fix:** Added `needs: [lint, typecheck, build]` to the `coverage-gate` job so it only runs after prerequisite checks pass. Added `TESTCONTAINERS_RYUK_DISABLED: "true"` and `DATABASE_URL: ""` env vars to the `Run tests with coverage` step, matching the existing `integration-test` job's configuration.

---

### WR-02: `reset.ts` URL regex is fragile for PostgreSQL connection strings with `/` in credentials

**Files modified:** `packages/core/src/db/reset.ts`
**Commit:** 1f0b05e
**Applied fix:** Replaced the fragile `appDbUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres")` regex with `new URL(appDbUrl); parsed.pathname = "/postgres"; parsed.toString()`. The `URL` class correctly parses the URL structure regardless of special characters in the password portion. `URL` is a Node.js global, no additional import required.

---

### WR-03: `account_balance.last_posting_id` has no FK constraint to `postings.id`

**Files modified:** `packages/core/src/db/schema.ts`, `packages/core/migrations/0009_account_balance_last_posting_fk.sql`, `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0009_snapshot.json`, `packages/core/migrations/migration-hashes.json`
**Commit:** 8bd92da
**Applied fix:** Added `.references(() => postings.id)` to `last_posting_id` in the Drizzle schema. Created migration `0009_account_balance_last_posting_fk.sql` which adds the FK using `NOT VALID` so existing NULL rows are not rejected and the constraint is enforced only on future writes. The Drizzle snapshot for 0009 reflects the new FK in `account_balance.foreignKeys`. `VALIDATE CONSTRAINT` can be run when the balance worker is implemented.

---

### WR-04: `splitMigrationStatements` dollar-quote parser does not handle named dollar-quotes (`$tag$`)

**Files modified:** `packages/core/tests/helpers/applyMigrationsToSchema.ts`
**Commit:** 6b4ed5f
**Applied fix:** Replaced the simple `$$` toggle with a tag-aware parser. When a `$` is encountered outside a comment, the parser now finds the closing `$` to extract the full tag (e.g., `$function$`). If not in dollar-quote mode, it enters only when the tag matches `^\$[A-Za-z0-9_]*\$$` (PostgreSQL rule). If in dollar-quote mode, it exits only when the identical closing tag is found. This prevents premature exit when `$$` appears inside a `$function$...$function$` body. Added `currentDollarTag` state variable to track the opening delimiter.

---

### IN-01: `console.log` / `console.error` in CLI scripts

**Files modified:** `packages/core/src/db/migrate.ts`, `packages/core/src/db/reset.ts`, `packages/core/src/db/seed.ts`
**Commit:** 18cd6c2
**Applied fix:** Replaced all `console.log(...)` calls with `process.stdout.write("...\n")` and all `console.error(...)` calls with `process.stderr.write(\`...\n\`)` in the three CLI entry-point scripts. This satisfies the CLAUDE.md structured-logging convention for published tooling scripts.

---

### IN-02: Test container pinned to `postgres:18-alpine` instead of documented minimum `postgres:16-alpine`

**Files modified:** `packages/core/tests/setup/container.ts`
**Commit:** 05532ae
**Applied fix:** Changed `PG_IMAGE` from `postgres:18-alpine@sha256:96d56f7f...` to `postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`. The digest was obtained by pulling the image locally (`docker pull postgres:16-alpine`) and inspecting the repo digest. This ensures the test suite validates against the documented minimum supported Postgres version.

---

### IN-03: `migration-drift.test.ts` uses bare `__dirname` not available in native ESM

**Files modified:** `packages/core/tests/infra/migration-drift.test.ts`
**Commit:** 7985831
**Applied fix:** Added `import { dirname } from "node:path"` and `import { fileURLToPath } from "node:url"`, then declared `const __dirname = dirname(fileURLToPath(import.meta.url))` before the `REPO_ROOT` computation. This matches the pattern used by all other test helpers in the project (`applyMigrationsToSchema.ts`, `createTestDb.ts`, `migrate.ts`, and the `.mjs` scripts).

---

_Fixed: 2026-05-23T16:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
