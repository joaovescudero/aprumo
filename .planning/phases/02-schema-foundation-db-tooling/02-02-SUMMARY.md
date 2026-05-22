---
phase: 02-schema-foundation-db-tooling
plan: "02"
subsystem: database
tags: [drizzle-orm, drizzle-kit, postgres, schema, migrations, tdd]

requires:
  - phase: 02-schema-foundation-db-tooling
    plan: "01"
    provides: drizzle-orm + drizzle-kit installed, drizzle.config.ts, migrations/ dir
  - phase: 02-schema-foundation-db-tooling
    plan: "08"
    provides: createTestDb helper for schema-shape integration tests

provides:
  - packages/core/src/db/schema.ts (all 10 Drizzle table definitions for the ledger)
  - packages/core/migrations/0000_init_tables.sql (generated DDL for all ledger tables)
  - packages/core/migrations/meta/_journal.json (migration tracking journal, tag 0000_init_tables)
  - packages/core/migrations/meta/0000_snapshot.json (Drizzle schema snapshot)
  - packages/core/tests/schema/schema-shape.integration.test.ts (RED→GREEN integration tests)

affects:
  - 02-03 (hand-written migrations 0001-0005 — consume migrations/ dir + journal)
  - 02-04 (post_transaction function — reads postings/transactions schema)
  - 02-05 (constraint trigger — reads postings/transactions schema)
  - 02-06 (audit triggers — reads accounts_audit, outbound_*_audit tables)
  - 02-09 (migration drift check — hashes 0000_init_tables.sql against journal)
  - all Phase 3+ plans (consume schema exports from @aprumo/core)

tech-stack:
  added: []
  patterns:
    - bigint({ mode: 'bigint' }) required for all money columns (drizzle-orm BigInt64 mode)
    - sql`0` default for bigint columns (BigInt(0) literal breaks drizzle-kit JSON serialization)
    - check() with sql`` tagged template for CHECK constraints in pgTable
    - unique() for composite unique constraints (raw_events provider+provider_event_id)
    - Audit shadow tables defined in Drizzle schema with shared auditColumns object
    - D-47 triple documentation: header comment, COMMENT ON COLUMN appended to SQL file, ADR-009

key-files:
  created:
    - packages/core/src/db/schema.ts
    - packages/core/migrations/0000_init_tables.sql
    - packages/core/migrations/meta/_journal.json
    - packages/core/migrations/meta/0000_snapshot.json
    - packages/core/tests/schema/schema-shape.integration.test.ts
  modified: []

key-decisions:
  - "sql`0` used for bigint defaults instead of BigInt(0) — drizzle-kit 0.31.10 JSON.stringify cannot serialize native BigInt"
  - "auditColumns shared object for 3 audit shadow tables — DRY approach for identical schemas"
  - "Migration file renamed from drizzle-kit auto-generated name to 0000_init_tables; journal tag updated accordingly"
  - "COMMENT ON COLUMN appended after generation per D-47 — drift check hashes the final committed file"

requirements-completed:
  - FND-01
  - FND-02
  - FND-03
  - FND-04
  - FND-05
  - FND-06

duration: 7min
completed: 2026-05-22
---

# Phase 02 Plan 02: Drizzle Schema + 0000_init_tables Migration Summary

**All 10 ledger tables declared in schema.ts with correct Drizzle types; 0000_init_tables.sql generated and registered; schema-shape integration tests written RED then verified GREEN**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-22T20:56:58Z
- **Completed:** 2026-05-22T21:03:45Z
- **Tasks:** 2 (1 RED, 1 GREEN)
- **Files created:** 5

## Accomplishments

- Created `packages/core/src/db/schema.ts` exporting all 10 tables: `accounts`, `transactions`, `postings`, `rawEvents`, `accountBalance`, `outboundEndpoints`, `outboundEvents`, `accountsAudit`, `outboundEndpointsAudit`, `outboundEventsAudit`
- All money columns use `bigint({ mode: 'bigint' })` — prevents silent number precision loss (CLAUDE.md invariant 8)
- CHECK constraints for `accounts.type` (5 values), `postings.direction` (debit/credit), `raw_events.status` (pending/reconciled/failed)
- UNIQUE constraint on `transactions.idempotency_key` (FND-02) and composite `raw_events(provider, provider_event_id)` (FND-04)
- D-45: `pending_balance` and `available_balance` reserved as `BIGINT NULL` in `account_balance` for v0.5
- D-47: header comment block in SQL file listing v0.5 reservations + `COMMENT ON COLUMN` appended after generation
- Ran `pnpm db:generate` → produced `0000_init_tables.sql` (10 CREATE TABLEs), renamed from auto-generated name, updated `_journal.json` tag to `0000_init_tables`
- Wrote 7 integration tests in `schema-shape.integration.test.ts` (RED before schema existed, GREEN after migrations generated)

## Task Commits

1. `2ce4433` — `test(02-02): add RED schema-shape integration tests`
2. `dbb370e` — `feat(02-02): add schema.ts + generate 0000_init_tables migration`

## Files Created

- `packages/core/src/db/schema.ts` — 10 Drizzle table definitions, CHECK constraints, FKs, indexes
- `packages/core/migrations/0000_init_tables.sql` — Generated DDL (10 CREATE TABLEs), header + COMMENT ON COLUMN
- `packages/core/migrations/meta/_journal.json` — Migration journal with tag `0000_init_tables`
- `packages/core/migrations/meta/0000_snapshot.json` — Drizzle schema snapshot for future diff
- `packages/core/tests/schema/schema-shape.integration.test.ts` — 7 integration tests (schema shape assertions)

## Decisions Made

- `sql\`0\`` for bigint defaults instead of `BigInt(0)` — drizzle-kit 0.31.10 `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt` when a native BigInt default value appears in the schema; `sql\`0\`` generates the same SQL (`DEFAULT 0`) without the serialization issue
- Shared `auditColumns` object for the 3 audit shadow tables — all three have identical column structure; sharing avoids copy-paste drift
- Migration file renamed from drizzle-kit auto-generated `0000_harsh_electro.sql` to `0000_init_tables.sql` per plan requirement D-34; `_journal.json` tag updated to match

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] drizzle-kit 0.31.10 cannot serialize BigInt literal defaults**
- **Found during:** Task 2, Step 3 (`pnpm db:generate`) — `TypeError: Do not know how to serialize a BigInt`
- **Issue:** `bigint(...).default(BigInt(0))` puts a native JS `bigint` value into the Drizzle column definition. drizzle-kit's internal `JSON.stringify` call in `diffSchemasOrTables` cannot serialize it.
- **Fix:** Replaced `BigInt(0)` defaults with `sql\`0\`` in `accountBalance.balance` and `outboundEvents.attempts`. Both emit `DEFAULT 0` in the generated SQL — identical behavior.
- **Files modified:** `packages/core/src/db/schema.ts`
- **Committed in:** `dbb370e`

**2. [Rule 1 - Bug] Biome formatting on JSON migration files**
- **Found during:** Task 2 commit — pre-commit Biome hook
- **Issue:** `0000_snapshot.json` had multi-line arrays for FK columns (`columnsFrom`, `columnsTo`) that Biome flattened; both JSON files missing trailing newlines
- **Fix:** `biome format --write` on both JSON files
- **Files modified:** `packages/core/migrations/meta/_journal.json`, `packages/core/migrations/meta/0000_snapshot.json`
- **Committed in:** `dbb370e`

**3. [Rule 1 - Bug] Biome lint on test file**
- **Found during:** Task 1 — first Biome check pass
- **Issue:** Unused `import { type Pool }` import; import order (TestDb before createTestDb); long line in `constraintNames.some()`
- **Fix:** Removed unused Pool import; sorted imports; wrapped long expression across 3 lines
- **Files modified:** `packages/core/tests/schema/schema-shape.integration.test.ts`
- **Committed in:** `2ce4433`

---

**Total deviations:** 3 auto-fixed (Rule 1 — bugs)
**Impact on plan:** All deviations required for correct/compilable code; no scope change.

## TDD Gate Compliance

- RED commit `2ce4433`: `test(02-02): add RED schema-shape integration tests` — exists BEFORE implementation
- GREEN commit `dbb370e`: `feat(02-02): add schema.ts + generate 0000_init_tables migration` — exists AFTER RED
- Gate sequence: RED → GREEN — PASSED

## Known Stubs

None — this plan delivers schema DDL and generated migrations with no UI or data stubs.

## Threat Flags

No new security-relevant surface beyond what the plan's threat_model covers. The generated DDL does not contain credentials. `COMMENT ON COLUMN` statements are metadata-only with no security implications.

T-2-03 (amount_cents precision) mitigated: all 9 money columns in schema.ts verified to use `bigint({ mode: 'bigint' })`.

## Self-Check: PASSED

Files verified on disk:
- packages/core/src/db/schema.ts: FOUND
- packages/core/migrations/0000_init_tables.sql: FOUND
- packages/core/migrations/meta/_journal.json: FOUND
- packages/core/migrations/meta/0000_snapshot.json: FOUND
- packages/core/tests/schema/schema-shape.integration.test.ts: FOUND

Commits verified:
- 2ce4433: FOUND (test(02-02): add RED schema-shape integration tests)
- dbb370e: FOUND (feat(02-02): add schema.ts + generate 0000_init_tables migration)

Verification checks:
- CREATE TABLE count: 10 (expect >=10) — PASSED
- bigint mode count: 9 (expect >=3) — PASSED
- _journal.json tag: 0000_init_tables — PASSED
- pnpm --filter @aprumo/core typecheck: exits 0 — PASSED
- biome check: exits 0 on all modified files — PASSED

---

*Phase: 02-schema-foundation-db-tooling*
*Completed: 2026-05-22*
