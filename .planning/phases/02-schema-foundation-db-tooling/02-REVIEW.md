---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-06-02T00:00:00Z
depth: deep
files_reviewed: 38
files_reviewed_list:
  - .github/workflows/ci.yml
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
  - packages/core/migrations/0010_fix_validation_order.sql
  - packages/core/migrations/0011_drop_outbound_events_audit_trigger.sql
  - packages/core/migrations/0012_numeric_accumulator_post_transaction.sql
  - packages/core/migrations/0013_revoke_execute_all_functions.sql
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
  - packages/core/tests/infra/seed-guard.test.ts
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
findings:
  critical: 2
  warning: 3
  info: 3
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** deep
**Files Reviewed:** 38
**Status:** issues_found

## Summary

Deep review of the Phase 2 schema foundation: 14 migrations (0000-0013), the TypeScript DB tooling layer (migrate.ts, reset.ts, seed.ts, schema.ts), test harness (testcontainers globalSetup, createTestDb, applyMigrationsToSchema), drift-gate scripts (generate-migration-hashes.mjs, check-migration-drift.mjs), and CI pipeline.

The migration chain is well-structured and demonstrates careful layering — each subsequent migration correctly supersedes and preserves invariants from earlier ones. The drift gate, seed guard (WR-06), idempotency race fix (0008), validation-order fix (0010), and numeric-accumulator fix (0012) all address real bugs correctly. However, two critical issues were found:

1. **Migration 0007 revokes INSERT on `raw_events` from `aprumo_app`**, directly contradicting CLAUDE.md role spec ("aprumo_app: SELECT/INSERT em todas; sem UPDATE/DELETE em postings/raw_events") and breaking the exact-once webhook invariant (Invariant 4) at Phase 4+ when the webhook ingestion path must INSERT into `raw_events` in the same transaction as pg-boss enqueueing.

2. **`check_double_entry_balance()` (0005) has no `SET search_path`**, leaving it vulnerable to search-path injection attacks in production — unlike every other SECURITY DEFINER or privilege-sensitive function in the codebase which all set `SET search_path = public`.

Three warnings and three info items round out the findings.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `0007_revoke_insert_append_only.sql` revokes INSERT on `raw_events` from `aprumo_app` — contradicts CLAUDE.md role spec and breaks Invariant 4

**File:** `packages/core/migrations/0007_revoke_insert_append_only.sql:19`

**Issue:** Migration 0007 issues:
```sql
REVOKE INSERT ON TABLE raw_events FROM aprumo_app;
```

CLAUDE.md (roles section, line 74) specifies the `aprumo_app` privilege model as:
> "aprumo_app: SELECT/INSERT em todas; sem UPDATE/DELETE em postings/raw_events."

The spec explicitly says **no UPDATE/DELETE** on `raw_events`, but INSERT is permitted on all tables. Migration 0007 goes beyond the spec by revoking INSERT on `raw_events`, which is not authorised by CLAUDE.md.

More critically, CLAUDE.md Invariant 4 requires:
> "o INSERT em `raw_events` e o enfileiramento do job pg-boss devem acontecer **na mesma transacao Postgres**."

The webhook ingestion path (implemented in Phase 4+) must atomically INSERT a row into `raw_events` and enqueue a pg-boss job. After 0007, `aprumo_app` cannot INSERT into `raw_events` directly and there is no `SECURITY DEFINER` function for `raw_events` inserts (unlike `post_transaction` for `postings`). The test at `post-transaction.integration.test.ts:302-311` confirms the revoke is active and tests for `42501` on INSERT — meaning the test suite validates the wrong behaviour and will mask this bug through Phase 4.

After 0013, `aprumo_app` has EXECUTE only on `post_transaction`, leaving no write path to `raw_events` whatsoever from the application role.

**Fix:** Create a new migration 0014 that restores INSERT on `raw_events` to `aprumo_app` (matching CLAUDE.md spec); or, preferably, issue a corrective migration that only revokes INSERT on `postings` and restores INSERT on `raw_events`. Alternatively create a `SECURITY DEFINER` function `ingest_raw_event(...)` owned by `aprumo_migration` to serve as the sole write path (analogous to `post_transaction`), and explicitly document this decision. The simplest fix matching the documented spec:

```sql
-- 0014_restore_raw_events_insert.sql
-- Restores INSERT on raw_events to aprumo_app.
-- 0007_revoke_insert_append_only.sql incorrectly revoked INSERT on raw_events.
-- Per CLAUDE.md: aprumo_app must have SELECT/INSERT on ALL tables;
-- only UPDATE/DELETE on postings/raw_events is prohibited.
-- Per CLAUDE.md Invariant #4: INSERT into raw_events must occur in the same
-- Postgres transaction as pg-boss job enqueueing — requires aprumo_app INSERT.
GRANT INSERT ON TABLE raw_events TO aprumo_app;
```

Also update `post-transaction.integration.test.ts:302-311` to assert that `aprumo_app` **can** INSERT into `raw_events` (no 42501 expected), and add the INSERT-revoke-on-postings-only test to `revoke.integration.test.ts`.

---

### CR-02: `check_double_entry_balance()` (migration 0005) has no `SET search_path` — susceptible to search-path injection

**File:** `packages/core/migrations/0005_double_entry_trigger.sql:15-17`

**Issue:** The `check_double_entry_balance()` trigger function is defined without `SET search_path`:

```sql
CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
```

Every other privilege-sensitive function in the codebase sets `SET search_path = public` to prevent search-path injection:
- `post_transaction` (0003, 0008, 0010, 0012): `SET search_path = public`
- `audit_row_change` (0004): `SET search_path = public`

Without `SET search_path`, if an attacker or misconfigured session can manipulate the session `search_path` before the deferred constraint trigger fires at COMMIT, the query `FROM postings WHERE transaction_id = NEW.transaction_id` could resolve to a shadow `postings` table in a different schema, returning a fraudulent zero sum and allowing unbalanced postings to pass the double-entry check. This undermines CLAUDE.md Invariant 2. The trigger is deferred to COMMIT (`DEFERRABLE INITIALLY DEFERRED`), meaning the session `search_path` in effect at COMMIT time is used — a window for manipulation.

**Fix:**
```sql
CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_signed_sum bigint;
BEGIN
  -- ... (rest unchanged)
```

This should be applied as a new migration (e.g., 0014 or appended to an existing corrective migration) since 0005 is immutable per the drift gate.

---

## Warnings

### WR-01: Duplicate `globalSetup` registration causes two testcontainers instances in `pnpm test` and coverage-gate

**File:** `vitest.config.ts:17` and `packages/core/vitest.config.ts:9`

**Issue:** The root `vitest.config.ts` declares:
```ts
globalSetup: ["packages/core/tests/globalSetup.ts"],
```
And also includes `"packages/*/vitest.config.ts"` in `projects`, which resolves `packages/core/vitest.config.ts`, which itself declares:
```ts
globalSetup: ["./tests/globalSetup.ts"],
```

In Vitest workspace mode, both the root-level and project-level `globalSetup` are executed. Since both point to the same file (`packages/core/tests/globalSetup.ts`), the file runs twice: once in the root context and once in the core project context. Each execution calls `builder.start()`, starting a second PostgreSQL container in non-reuse mode (CI). This doubles container startup time and wastes CI resources. Worse, `project.provide("pgUri", pgUri)` is called twice with different URIs; which `pgUri` tests receive depends on Vitest's internal execution order, making this a potential source of non-deterministic integration test failures.

The integration-test CI job (`pnpm --filter @aprumo/core test --run`) runs only the package project and is not affected. But `pnpm test` (test job, line 71) and `pnpm vitest run --coverage` (coverage-gate job, line 96) both run from the root and trigger the double-setup.

**Fix:** Remove the root-level `globalSetup` entry from `vitest.config.ts` and rely solely on the per-project declaration in `packages/core/vitest.config.ts`:

```ts
// vitest.config.ts — remove:
// globalSetup: ["packages/core/tests/globalSetup.ts"],
export default defineConfig({
  test: {
    // no globalSetup here — per-package projects manage their own
    projects: [
      { test: { name: "root-tests", include: ["tests/**/*.test.ts"], environment: "node" } },
      "packages/*/vitest.config.ts",
    ],
    coverage: { /* unchanged */ },
  },
});
```

---

### WR-02: `outbound_events_audit` shadow table is orphaned after migration 0011 drops its trigger

**File:** `packages/core/migrations/0011_drop_outbound_events_audit_trigger.sql:25`

**Issue:** Migration 0011 drops `outbound_events_audit_trigger` on `outbound_events` but retains the `outbound_events_audit` table. After 0011, the shadow table exists in the schema, is visible to `information_schema.tables` queries, and receives no writes. CLAUDE.md Invariant 6 reads: "qualquer tabela mutavel (configs, customers, endpoints) tem shadow *_audit populada por trigger." `outbound_events` is mutable (status, attempts, last_error, next_attempt_at are all updated) and was covered by this invariant at schema creation.

The 0011 comment correctly notes the operational noise rationale, but the orphaned audit table creates two concrete issues: (1) tests in `schema-shape.integration.test.ts:184-198` verify `outbound_events_audit` exists — and it does — giving a false sense of audit coverage. (2) Future developers may query `outbound_events_audit` expecting content and get silent empty results.

**Fix:** Either drop `outbound_events_audit` in a subsequent migration (0014+) and remove it from the expected audit tables in `schema-shape.integration.test.ts`; or add a prominent comment to `schema.ts` and the migration marking the table as intentionally empty:

```ts
// schema.ts: outbound_events_audit — shadow table retained but INTENTIONALLY UNPOPULATED.
// Audit trigger was dropped in migration 0011 (high-frequency writes; no TTL strategy).
// See 0011_drop_outbound_events_audit_trigger.sql for rationale.
export const outboundEventsAudit = pgTable("outbound_events_audit", auditColumns);
```

---

### WR-03: `revoke.integration.test.ts` does not test INSERT revoke on `postings`/`raw_events` — gap in revoke coverage is misleading

**File:** `packages/core/tests/schema/revoke.integration.test.ts:22-57`

**Issue:** `revoke.integration.test.ts` tests `UPDATE` and `DELETE` revoke on `postings` and `raw_events` (from migration 0002), but contains no test for the INSERT revoke introduced by migration 0007. The INSERT revoke tests exist in `post-transaction.integration.test.ts:288-311`, but they are placed in the wrong test file: revoke enforcement belongs in `revoke.integration.test.ts` for discoverability.

Compounding this, as documented in CR-01, the test at `post-transaction.integration.test.ts:302-311` asserts `42501` on INSERT into `raw_events` — but per CLAUDE.md that INSERT should be permitted, meaning the test validates the wrong (incorrect) behaviour and will pass until Phase 4 when the missing write path causes a production failure. A reader of `revoke.integration.test.ts` who checks "is INSERT on `raw_events` covered?" finds nothing, masking the violation.

**Fix:** After applying the CR-01 corrective migration, add explicit INSERT tests to `revoke.integration.test.ts`:

```ts
describe("INSERT revoke enforcement", () => {
  it("aprumo_app INSERT into postings -> SQLSTATE 42501", async () => {
    await expect(
      db.app.query(`INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'debit')`)
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("aprumo_app INSERT into raw_events -> succeeds (SELECT/INSERT em todas per CLAUDE.md)", async () => {
    // aprumo_app retains INSERT on raw_events per CLAUDE.md role spec
    await expect(
      db.app.query(`INSERT INTO raw_events (provider, provider_event_id, payload_jsonb)
        VALUES ('test', $1, '{}')`, [randomUUID()])
    ).resolves.toBeDefined();
  });
});
```

---

## Info

### IN-01: `readWithRetry` doc-comment says "3 retries" but implementation does 10 attempts

**File:** `packages/core/tests/helpers/applyMigrationsToSchema.ts:231` and `238`

**Issue:** The JSDoc comment at line 231 reads:
```
* Read a file with up to 3 retries on ENOENT.
```
But the loop on line 238 runs:
```ts
for (let attempt = 0; attempt < 10; attempt++) {
```

The implementation does 10 attempts (not 3). The comment was not updated when the retry count was increased. No runtime impact, but the comment misleads future maintainers reasoning about worst-case retry delays (actual worst-case is ~3 seconds of retries, not ~140ms).

**Fix:**
```ts
/**
 * Read a file with up to 10 retries on ENOENT.
 * macOS APFS can transiently return ENOENT under heavy concurrent I/O ...
 */
```

---

### IN-02: `check-migration-drift.mjs` does not detect hashes in `migration-hashes.json` that have no corresponding journal entry

**File:** `scripts/check-migration-drift.mjs:100-114`

**Issue:** The drift check correctly detects migration files on disk absent from `_journal.json`, and journal entries whose files are missing or hash-mismatched. But it does NOT detect hash entries in `migration-hashes.json` that have no corresponding `_journal.json` entry. If a developer removes a migration from the journal (accidentally or to hide a change) while leaving its hash in the JSON file, the drift check passes silently — the reverse-disk check (lines 100-114) only compares `.sql` files against the journal, not hash-file entries against the journal.

**Fix:** Add a third check after the existing reverse-file check:
```js
// 5b. Detect hash entries with no journal counterpart (stale/orphaned hashes)
for (const tag of Object.keys(storedHashes)) {
  if (!journalTags.has(tag)) {
    process.stderr.write(
      `DRIFT: ${tag} has a stored hash in migration-hashes.json but no entry in _journal.json\n`
    );
    driftedFiles.push(tag);
    driftDetected = true;
  }
}
```

---

### IN-03: Comment in `0013_revoke_execute_all_functions.sql` incorrectly implies explicit function grants survive `REVOKE ON ALL FUNCTIONS`

**File:** `packages/core/migrations/0013_revoke_execute_all_functions.sql:22-23`

**Issue:** The migration comment states:
> "The explicit function-level grants are not affected by REVOKE ON ALL FUNCTIONS."

This is incorrect. In PostgreSQL, `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM aprumo_app` revokes EXECUTE from ALL functions, including those that received an earlier explicit `GRANT EXECUTE`. The subsequent `GRANT EXECUTE ON FUNCTION post_transaction(...)` at line 42 is **required** (not optional belt-and-suspenders) to restore `aprumo_app`'s access. If a future developer removes the re-grant believing the comment's claim that explicit grants survive, `aprumo_app` will silently lose access to `post_transaction`.

No runtime bug exists since the re-grant is present. The risk is that the misleading comment becomes a maintenance hazard.

**Fix:** Correct the comment:
```sql
-- IMPORTANT: REVOKE EXECUTE ON ALL FUNCTIONS revokes ALL existing function grants,
-- including those issued by explicit prior GRANT EXECUTE statements.
-- The GRANT EXECUTE below is REQUIRED — not belt-and-suspenders — to restore
-- aprumo_app's access to post_transaction after the broad revoke above.
-- If this re-grant is removed, aprumo_app loses all DB write capability.
GRANT EXECUTE ON FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  TO aprumo_app;
```

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
