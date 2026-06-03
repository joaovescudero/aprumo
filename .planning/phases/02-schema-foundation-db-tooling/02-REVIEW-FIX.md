---
phase: 02-schema-foundation-db-tooling
fixed_at: 2026-06-02T23:32:35Z
review_path: .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 7
skipped: 1
status: partial
---

# Phase 02: Code Review Fix Report (deep pass)

**Fixed at:** 2026-06-02T23:32:35Z
**Source review:** .planning/phases/02-schema-foundation-db-tooling/02-REVIEW.md (deep depth)
**Iteration:** 1

**Summary:**
- Findings in scope (--all): 8 (CR-01, CR-02, WR-01, WR-02, WR-03, IN-01, IN-02, IN-03)
- Fixed: 7
- Skipped: 1 (IN-03 — lives in immutable migration)

> Supersedes the prior standard-pass fix report. The deep cross-file review found
> a different, more serious finding set (notably the raw_events INSERT revoke and
> the missing search_path on the double-entry trigger). The standard-pass fixes
> (seed.ts guard, beforeAll guard, etc.) remain committed earlier in history.

## Fixed Issues

### CR-01: 0007 revokes INSERT on raw_events from aprumo_app — breaks Invariant 4 (exact-once webhook)

**Files modified:** `packages/core/migrations/0014_regrant_insert_raw_events.sql` (new), meta `_journal.json` + `0014_snapshot.json`, `migration-hashes.json`, `packages/core/tests/schema/post-transaction.integration.test.ts`, `packages/core/tests/schema/revoke.integration.test.ts`
**Commit:** `c4c2c15`
**Decision:** User-confirmed direction — re-grant via new migration (postings stays revoked).
**Applied fix:** New migration `0014_regrant_insert_raw_events.sql` issuing `GRANT INSERT ON TABLE raw_events TO aprumo_app`, with header referencing CLAUDE.md role spec, Invariant 4, and ADR-003 (webhook exact-once = plain INSERT into raw_events + pg-boss enqueue in the same Postgres tx, executed as aprumo_app). INSERT on `postings` remains revoked (sole write path = `post_transaction` SECURITY DEFINER — correct). Updated the now-wrong test in `post-transaction.integration.test.ts` (was asserting 42501 on raw_events INSERT) to expect success. Added an `INSERT privilege enforcement` describe block in `revoke.integration.test.ts` (resolves WR-03).
**Status:** fixed — requires human verification (privilege change; integration tests need a running container to confirm).

---

### CR-02: check_double_entry_balance() missing SET search_path — search-path injection at COMMIT

**Files modified:** `packages/core/migrations/0015_set_search_path_double_entry.sql` (new), meta `_journal.json` + `0015_snapshot.json`, `migration-hashes.json`
**Commit:** `73c87c3`
**Applied fix:** New migration CREATE OR REPLACEs `check_double_entry_balance()` adding `SET search_path = public`, matching `post_transaction` / `audit_row_change`. Closes the search-path redirection vector on the DEFERRABLE INITIALLY DEFERRED trigger that fires in the caller's session at COMMIT (protects Invariant 2, double-entry SUM=0).
**Status:** fixed — requires human verification (logic/security fix; container needed).

---

### WR-01: duplicate globalSetup starts two testcontainer PG instances

**Files modified:** `vitest.config.ts` (root)
**Commit:** `b0a83c9`
**Applied fix:** Removed the root `globalSetup` registration. The per-package `packages/core/vitest.config.ts` declaration is now the single source of truth — one PG container, deterministic pgUri.

---

### WR-02: outbound_events_audit orphaned (no writes) after 0011 trigger drop

**Files modified:** `packages/core/src/db/schema.ts`
**Commit:** `b382dc2`
**Applied fix:** Added JSDoc to `outboundEventsAudit` documenting it as intentionally unpopulated (audit trigger dropped by immutable migration 0011), the Phase 7+ TTL rationale, and that CLAUDE.md Invariant 6 applies to mutable config tables. No schema change — the divergence is now documented rather than silent.

---

### WR-03: revoke test gap — no postings INSERT-denied / raw_events INSERT-allowed coverage

**Files modified:** `packages/core/tests/schema/revoke.integration.test.ts`
**Commit:** `c4c2c15` (atomic with CR-01)
**Applied fix:** New `INSERT privilege enforcement` describe block covering the full INSERT model: postings INSERT → 42501 (denied), raw_events INSERT → succeeds (granted by 0014).
**Status:** fixed — requires human verification (container needed).

---

### IN-01: readWithRetry JSDoc says "3 retries" but loop does 10 attempts

**Files modified:** `packages/core/tests/helpers/applyMigrationsToSchema.ts`
**Commit:** `98d95b4`
**Applied fix:** JSDoc corrected to "up to 10 attempts (9 retries)" with worst-case timing note (~3s).

---

### IN-02: drift gate misses orphaned hash entries (hash present, no journal entry)

**Files modified:** `scripts/check-migration-drift.mjs`
**Commit:** `3dcb146`
**Applied fix:** Added reverse hash check — flags entries in `migration-hashes.json` with no corresponding `_journal.json` entry. Closes the silent-pass gap when a journal entry is removed but its hash remains.

---

## Skipped Issues

### IN-03: misleading comment in 0013 (explicit GRANT does not survive REVOKE ON ALL FUNCTIONS)

**Reason:** The comment lives only inside immutable migration `0013_revoke_execute_all_functions.sql`. Editing it would trip the drift gate. No runtime impact — the required re-grant is already present. Document the correct PostgreSQL behavior in a mutable location (e.g. ADR or migration README) if desired.

---

## Verification

- `pnpm --filter @aprumo/core typecheck` — clean
- `node scripts/check-migration-drift.mjs` — passed (16 migrations)
- Integration tests (CR-01, CR-02, WR-03) need a live Postgres container: `pnpm --filter @aprumo/core test`

_Fixed: 2026-06-02T23:32:35Z_
_Fixer: Claude (gsd-code-fixer, deep pass) + orchestrator reconciliation_
_Iteration: 1_
