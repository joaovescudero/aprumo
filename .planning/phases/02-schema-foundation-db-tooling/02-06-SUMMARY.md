---
phase: 02-schema-foundation-db-tooling
plan: "06"
subsystem: database
tags: [postgres, plpgsql, security-definer, audit-triggers, tdd, immutability]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "03"
    provides: 0001_roles.sql + 0002_grants.sql; aprumo_app and aprumo_migration roles configured;
      REVOKE UPDATE/DELETE on postings/raw_events applied
  - phase: 02-schema-foundation-db-tooling
    plan: "08"
    provides: createTestDb helper for schema-per-file integration tests with role-specific pools

provides:
  - packages/core/migrations/0004_audit_triggers.sql (CREATE FUNCTION audit_row_change SECURITY
    DEFINER; AFTER UPDATE OR DELETE triggers on accounts, outbound_endpoints, outbound_events)
  - packages/core/migrations/meta/_journal.json (updated with 0004_audit_triggers entry idx=4)
  - packages/core/tests/schema/audit-triggers.integration.test.ts (TDD: 5 tests covering
    UPDATE/DELETE audit rows, INSERT no audit row, trigger existence, postings exclusion)

affects:
  - 02-09 (migration drift check — hashes 0004_audit_triggers.sql against journal)
  - Phase 3+ (audit trail present for all mutable table changes from day one)
  - Any future mutable table (must add to audit_row_change pattern per CLAUDE.md Invariant #6)

tech-stack:
  added: []
  patterns:
    - SECURITY DEFINER + SET search_path = public (T-2-03 SQL injection prevention via %I quoting)
    - Generic trigger function routing to per-table shadow via EXECUTE format('%I_audit', TG_TABLE_NAME)
    - AFTER UPDATE OR DELETE only — INSERT explicitly excluded (audit only captures mutations)
    - RETURN NULL from AFTER trigger (return value ignored by Postgres for AFTER triggers)
    - current_user captured as changed_by for accountability audit trail

key-files:
  created:
    - packages/core/migrations/0004_audit_triggers.sql
    - packages/core/tests/schema/audit-triggers.integration.test.ts
  modified:
    - packages/core/migrations/meta/_journal.json

key-decisions:
  - "Migration assigned idx=4 (not 5 as planned) — Plan 05 runs in parallel wave; drizzle-kit
    assigns next available index. Functional outcome identical."
  - "Single generic audit_row_change() chosen over per-table functions — EXECUTE format('%I_audit',
    TG_TABLE_NAME) is safer and DRY; %I quoting prevents SQL injection on table name routing"
  - "RETURN NULL in AFTER trigger — Postgres ignores return value for AFTER triggers; NULL is correct
    and conventional"
  - "outbound_events included in audit despite being relatively low-security — status field changes
    (pending→delivered/failed) benefit from audit trail for debugging delivery failures"

requirements-completed:
  - FND-06

duration: 3min
completed: 2026-05-22
---

# Phase 02 Plan 06: Audit Triggers Migration Summary

**Generic SECURITY DEFINER `audit_row_change()` function routes AFTER UPDATE/DELETE events to
per-table `*_audit` shadow tables — implements CLAUDE.md Invariant #6 for all mutable ledger tables**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-22T21:20:45Z
- **Completed:** 2026-05-22T21:23:50Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created:** 2
- **Files modified:** 1

## Accomplishments

- Created `packages/core/tests/schema/audit-triggers.integration.test.ts` with 5 test cases:
  UPDATE on accounts creates accounts_audit row with operation=UPDATE + changed_by + old_data;
  DELETE on accounts creates audit row with operation=DELETE + null new_data;
  INSERT on accounts creates zero audit rows (trigger is AFTER UPDATE OR DELETE only);
  outbound_endpoints_audit_trigger exists in pg_trigger;
  postings has zero audit triggers (append-only exclusion)
- Created `packages/core/migrations/0004_audit_triggers.sql`: `audit_row_change()` SECURITY DEFINER
  function with `SET search_path = public` + EXECUTE format using `%I` identifier quoting for
  per-table shadow routing + three AFTER UPDATE OR DELETE trigger attachments on mutable tables
- Updated `_journal.json` via `drizzle-kit generate --custom` to register 0004_audit_triggers at idx=4
- All CLAUDE.md invariants enforced: Invariant #6 (audit shadow tables for mutable tables),
  Invariant #1 (no audit on append-only postings/raw_events)
- T-2-03 (SQL injection via EXECUTE format) mitigated: `%I` quoting applied to TG_TABLE_NAME routing

## Task Commits

1. `3cb7b17` — `test(02-06): add RED audit trigger behavior tests`
2. `25eebfb` — `feat(02-06): add 0004_audit_triggers migration; audit trigger tests GREEN`

## Files Created

- `packages/core/migrations/0004_audit_triggers.sql` — audit_row_change() SECURITY DEFINER plpgsql
  function with generic per-table routing + AFTER UPDATE OR DELETE triggers on accounts,
  outbound_endpoints, outbound_events; explicit exclusion comment for postings/raw_events
- `packages/core/tests/schema/audit-triggers.integration.test.ts` — 5 integration tests asserting
  UPDATE/DELETE create audit rows with correct fields, INSERT does not, trigger catalog presence,
  and postings append-only exclusion

## Files Modified

- `packages/core/migrations/meta/_journal.json` — added entry idx=4 for 0004_audit_triggers

## Decisions Made

- **Migration number is 0004 (not 0005):** Plans 05 and 06 run in parallel in wave 5; drizzle-kit
  assigns the next available index. Since Plan 05 (double_entry_trigger) had not yet run when this
  plan executed, idx=4 was assigned to audit_triggers. The functional outcome is identical —
  migrations are applied in numeric order regardless of naming convention.
- **Generic function over per-table functions:** `EXECUTE format('%I_audit', TG_TABLE_NAME)` routes
  to the correct shadow table dynamically. This is DRY and safe — `%I` quotes the identifier,
  preventing SQL injection even if TG_TABLE_NAME somehow contained unusual characters.
- **outbound_events included in audit:** Although outbound_events is relatively operational (not
  strictly financial), status transitions are useful in the audit trail for debugging delivery
  failures. Consistent with the "any mutable table" rule in CLAUDE.md Invariant #6.
- **Biome trailing newline fix:** `_journal.json` generated by drizzle-kit lacks trailing newline;
  added as required by Biome formatter (pre-commit hook). Standard fix, not a deviation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration assigned idx=4, not idx=5 as plan named it**
- **Found during:** Task 2 (drizzle-kit generate)
- **Issue:** Plan referred to output file as `0005_audit_triggers.sql` but drizzle-kit assigned
  idx=4 since Plan 05 (double_entry_trigger) had not yet applied. The two plans run in the same
  wave (wave 5).
- **Fix:** Accepted the drizzle-kit assignment (0004_audit_triggers.sql). Migration functional
  outcome is identical — correct SQL content, registered in journal at correct idx.
- **Files modified:** File name is 0004_audit_triggers.sql; journal entry uses tag 0004_audit_triggers.
- **Commit:** 25eebfb

**2. [Rule 1 - Bug] Biome trailing newline required in _journal.json**
- **Found during:** Task 2 GREEN commit (pre-commit hook failure)
- **Issue:** drizzle-kit generate omits trailing newline; Biome pre-commit hook rejects the file.
- **Fix:** Added trailing newline to `_journal.json` before re-staging and committing.
- **Files modified:** packages/core/migrations/meta/_journal.json
- **Commit:** 25eebfb

## TDD Gate Compliance

- RED commit `3cb7b17`: `test(02-06): add RED audit trigger behavior tests` — exists BEFORE implementation
- GREEN commit `25eebfb`: `feat(02-06): add 0004_audit_triggers migration; audit trigger tests GREEN` — exists AFTER RED
- Gate sequence: RED → GREEN — PASSED

## Known Stubs

None — this plan delivers a SQL migration and integration tests with no UI or data stubs.

## Threat Flags

No new security surface beyond what the plan's threat_model covers.

- T-2-01 mitigated: `audit_row_change()` is SECURITY DEFINER — caller cannot bypass audit by
  switching roles. Audit shadow tables are not directly writable by aprumo_app (covered by grants pattern).
- T-2-03 mitigated: `EXECUTE format('%I_audit', TG_TABLE_NAME)` uses `%I` identifier quoting —
  prevents SQL injection via TG_TABLE_NAME in the dynamic EXECUTE statement.
- T-2-04 accepted: No audit trigger on postings or raw_events — append-only tables cannot be
  mutated by any role (REVOKE in 0002_grants.sql). Nothing to audit.
- T-2-02 (schema drift): 0004_audit_triggers.sql registered in `_journal.json` at idx=4 for
  Plan 09 drift check.

## Self-Check: PASSED

Files verified on disk:
- packages/core/migrations/0004_audit_triggers.sql: FOUND
- packages/core/tests/schema/audit-triggers.integration.test.ts: FOUND
- packages/core/migrations/meta/_journal.json: FOUND (entry for 0004_audit_triggers at idx=4)

Commits verified:
- 3cb7b17: FOUND (test(02-06): add RED audit trigger behavior tests)
- 25eebfb: FOUND (feat(02-06): add 0004_audit_triggers migration; audit trigger tests GREEN)

Verification checks:
- SECURITY DEFINER in function definition (line 25): PRESENT
- SET search_path = public in function: PRESENT
- Three AFTER UPDATE OR DELETE trigger statements (accounts, outbound_endpoints, outbound_events): 3 FOUND
- Three trigger names match acceptance criteria: 3 FOUND
- EXECUTE format with %I quoting in function body: PRESENT
- No CREATE TRIGGER on postings or raw_events: VERIFIED (zero non-comment SQL lines reference these tables)
- 0004_audit_triggers in _journal.json at idx=4: 1 match — PASSED
- typecheck: exits 0 — PASSED

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
