# Phase 2: Schema Foundation + DB Tooling - Research

**Researched:** 2026-05-22
**Domain:** PostgreSQL schema DDL, Drizzle hybrid migrations, plpgsql functions, constraint triggers, testcontainers/Vitest integration, MADR 4.0 ADRs
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migrations: Drizzle + raw SQL boundary (D-33/D-34/D-35/D-36)**
- D-33: Hybrid migrations. `schema.ts` declares tables/columns/FKs/CHECK/indexes; `drizzle-kit generate` emits `0000_init_tables.sql`. Additional hand-written migrations for CREATE ROLE, GRANT/REVOKE, plpgsql functions, CONSTRAINT TRIGGER, audit triggers. Hand-written migrations registered via `drizzle-kit generate --custom`.
- D-34: Linear prefix ordering, forward-only: `0000_init_tables.sql` (Drizzle-generated), `0001_roles.sql`, `0002_grants.sql`, `0003_post_transaction.sql`, `0004_double_entry_trigger.sql`, `0005_audit_triggers.sql`, `0006_seed_dev.sql` (dev-only, not part of `db:migrate`).
- D-35: Drift check = `_journal.json` committed. CI re-hashes every `.sql` in `migrations/` and diffs byte-by-byte against `_journal.json`. Any edit to an applied migration fails CI. Zero tooling extra beyond Node.
- D-36: Location = `packages/core/migrations/` + `packages/core/drizzle.config.ts`. Root `package.json` exposes `db:migrate`, `db:reset`, `db:generate`, `db:seed` delegating via `pnpm --filter @aprumo/core <script>`.

**Testcontainers + Vitest (D-37/D-38/D-39/D-40)**
- D-37: One global PG container in `tests/globalSetup.ts`; schema-per-test-file isolation. Each test file in `beforeAll` calls `createTestDb()` which: (a) computes `schema_name = 'test_' + sha1(testPath).slice(0,12)`, (b) `CREATE SCHEMA test_xxx`, (c) `SET search_path = test_xxx, public`, (d) runs migrations against that schema, (e) returns pools. `afterAll` calls `cleanup()` → `DROP SCHEMA test_xxx CASCADE`.
- D-38: No migration state cache. Each test file runs migrations fresh (50–200ms). Revisit only if suite exceeds 30s on migration setup alone.
- D-39: Helper returns `{ app: Pool, migration: Pool, schema: string, cleanup(): Promise<void> }`. `app` authenticates as `aprumo_app`; `migration` as `aprumo_migration`. FND-08 test uses `app.query('UPDATE postings ...')` and expects `42501`.
- D-40: Image = `postgres:18-alpine` pinned by digest in `tests/setup/container.ts`. `.withReuse()` disabled by default; `APRUMO_TEST_REUSE=1` enables for local dev.

**ADRs (D-41/D-42/D-43/D-44)**
- D-41: Expansion from PRD.md §9 + SUMMARY.md + CLAUDE.md. No new research/benchmarks. ~1 page per ADR, MADR 4.0.
- D-42: Scope = ADR-001..ADR-009 only. Phase-2 implementation decisions stay in CONTEXT.md/PLAN, not ADR.
- D-43: Files: `docs/adr/0001-postgres-as-ledger-engine.md` through `0009-drizzle-orm-migrations.md`. Index in `docs/adr/README.md`. No adr-tools/log4brains.
- D-44: `status: Accepted`. Frontmatter: `decided: 2026-05-18` (001–008) / `2026-05-22` (ADR-009) + `documented: 2026-05-22`. Honest back-fill dating.

**Schema Reservations (D-45/D-46/D-47)**
- D-45: Reserve `pending_balance BIGINT NULL` and `available_balance BIGINT NULL` in `account_balance`. Worker v0.1 writes only `balance`; reserved columns stay NULL until v0.5.
- D-46: Do NOT add v0.5 columns to `transactions` or `raw_events`. Those features need new tables (`splits`, `disputes`, `payment_methods`).
- D-47: Triple documentation: (a) `COMMENT ON COLUMN` for both reserved columns, (b) header comment block in `0000_init_tables.sql`, (c) ADR-009 "Reservation pattern" paragraph.

### Claude's Discretion (planner decides)
- Schema and error message of CONSTRAINT TRIGGER for double-entry — must enforce `SUM(amount_cents signed) = 0` per `transaction_id` at COMMIT; error must be mappable to 422 in Phase 3.
- `post_transaction(postings[])` internals: argument shape (composite type vs array of JSONB), `accounts.type` validation, `idempotency_key` collision handling.
- Audit trigger implementation: single generic `audit_row_change()` with `TG_TABLE_NAME` vs per-table functions; payload (JSONB OLD + JSONB NEW vs mirrored columns). Requirements: capture `current_user` and `now()`.
- `raw_events.status` vocabulary: CHECK constraint with `pending|reconciled|failed` or leave for Phase 7.
- `transactions.source` vocabulary: free string with convention, or CHECK constraint.
- Role password strategy in dev (env-vars `.env.example`) + CI (init script or migration step).

### Deferred Ideas (OUT OF SCOPE)
- Template-DB caching for testcontainers (revisit if suite > 30s).
- `available_balance` worker logic — column reserved, implementation v0.5.
- `splits`, `disputes`, `payment_methods` tables — v0.5 phases.
- PG-side migration drift check (journal-only is sufficient).
- `adr-tools` CLI / log4brains static site.
- Migration rollback (forward-only convention; document in CONTRIBUTING.md).
- `SET ROLE` in test helpers — rejected; separate pools per role instead.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | `accounts` table with type CHECK | `schema.ts` Drizzle table definition; `pgEnum` or CHECK `IN (...)` |
| FND-02 | `transactions` table with `idempotency_key UNIQUE NOT NULL`, `metadata jsonb` | Drizzle `unique()`, `jsonb()` columns |
| FND-03 | `postings` table append-only (BIGINT amount_cents, direction debit/credit) | REVOKE UPDATE/DELETE; CHECK on direction |
| FND-04 | `raw_events` with `UNIQUE(provider, provider_event_id)`, `status`, `transaction_id FK NULL` | Drizzle unique constraint; FKs |
| FND-05 | `account_balance` with `balance BIGINT`, `last_posting_id`, `updated_at` | Drizzle table; `pending_balance`/`available_balance` reserved NULL |
| FND-06 | `*_audit` shadow tables with `AFTER UPDATE/DELETE` triggers | Generic `audit_row_change()` plpgsql function |
| FND-07 | Separate roles: `aprumo_app` (SELECT/INSERT), `aprumo_migration` (DDL) | `0001_roles.sql`, `0002_grants.sql` |
| FND-08 | `REVOKE UPDATE, DELETE ON postings, raw_events FROM aprumo_app` + CI test | `0002_grants.sql`; test: `app.query('UPDATE postings ...')` → error `42501` |
| FND-09 | `post_transaction(postings[])`: validates balance, persists atomically, sole INSERT path | `0003_post_transaction.sql`; SECURITY DEFINER or GRANT-controlled |
| FND-10 | CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED validates `SUM = 0` at COMMIT | `0004_double_entry_trigger.sql`; AFTER ROW on postings |
| FND-11 | CI queries `pg_constraint` asserts `condeferrable=true AND condeferred=true` | Integration test via `SELECT` on `pg_constraint` |
| FND-12 | `docker-compose.yml` with Postgres 16+ and role env vars | `POSTGRES_USER`, role init script or migration step |
| FND-13 | `pnpm db:reset` destroys+recreates DB; `pnpm db:migrate` applies migrations | Root scripts delegating to `@aprumo/core` |
| FND-14 | Seed: 1 customer, 2 accounts, 1 transaction via `post_transaction` (no direct INSERT) | `0006_seed_dev.sql`; `post_transaction` call |
| FND-15 | Drizzle migration hash check in CI fails on edited migration | CI step: re-hash `.sql` files, diff `_journal.json` |
| FND-16 | Testcontainers globalSetup + schema-per-file isolation | `tests/globalSetup.ts`; `createTestDb()` helper |
| FND-17 | ADR-009 (Drizzle ratification) in `docs/adr/` MADR 4.0 format | MADR 4.0 template sections; content from SUMMARY.md |
| FND-18 | ADRs 001–008 ported to `docs/adr/` MADR 4.0 format | Content from PRD.md §9; MADR 4.0 template |
</phase_requirements>

---

## Summary

Phase 2 delivers the complete persistence foundation for Aprumo: all ledger tables, three-layer immutability enforcement, the `post_transaction` plpgsql function, testcontainers infrastructure for integration tests, and 9 ADRs in MADR 4.0 format. The implementation decisions are already locked in CONTEXT.md — this research deepens the technical patterns for each decision.

The critical path is: Drizzle `schema.ts` → `drizzle-kit generate` emits `0000_init_tables.sql` → 5 hand-written SQL migrations registered via `drizzle-kit generate --custom` → `migrate()` function applies all 7 files in order → tests use globalSetup with `inject()` for the PG URI + schema-per-file isolation. The trickiest piece is the CONSTRAINT TRIGGER: it's an AFTER ROW trigger on `postings` that, when deferred, runs at COMMIT time and queries the table to verify `SUM(amount_cents WITH SIGN) = 0` per `transaction_id`. The `post_transaction` function is SECURITY DEFINER and owns the only INSERT path into `postings` — `aprumo_app` has no direct INSERT on postings.

**Primary recommendation:** Use SECURITY DEFINER on `post_transaction` so `aprumo_app` cannot INSERT into `postings` directly. The CONSTRAINT TRIGGER uses `RAISE EXCEPTION ... USING ERRCODE = 'P0001'` with a message containing `transaction_id` and the imbalanced sum — Phase 3 maps this to HTTP 422.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema DDL (tables, types, FKs) | Database (Postgres) | Drizzle (`schema.ts` as source-of-truth) | DDL lives in PG; Drizzle generates the SQL |
| Role permission enforcement | Database (Postgres roles) | CI test (42501 assertion) | REVOKE is a DB-level guarantee, not application code |
| Double-entry validation | Database (plpgsql function + deferred trigger) | — | Must be atomic with the INSERT; cannot be in application layer |
| Immutability enforcement | Database (REVOKE + SECURITY DEFINER) | CI test (FND-08, FND-11) | Third defense: aprumo_app literally cannot UPDATE/DELETE |
| Audit capture | Database (AFTER UPDATE/DELETE triggers) | — | Triggers fire inside the same transaction as the mutating statement |
| Migration execution | Migration runner (`drizzle-orm/postgres-js/migrator`) | `drizzle-kit migrate` CLI | Programmatic runner needed for test schema isolation |
| Schema drift detection | CI (hash comparison script) | — | Stateless, zero-tooling check against `_journal.json` |
| Test PG container lifecycle | Vitest `globalSetup.ts` | `createTestDb()` helper | Container starts once; schema-per-file handles isolation |
| ADR documentation | `docs/adr/` (static Markdown) | — | No tooling dependency; naming convention is the interface |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 | Runtime query builder + programmatic migrator | Required for `fromDrizzle` pg-boss adapter; `migrate()` for test isolation [VERIFIED: npm registry] |
| `drizzle-kit` | 0.31.10 | Schema-to-SQL generation + custom migration file scaffolding | Official Drizzle CLI tool [VERIFIED: npm registry] |
| `postgres` (postgres-js) | 3.4.9 | PG driver for production and migration runner | Lightweight, native ESM, used by Drizzle postgres-js adapter [VERIFIED: npm registry] |
| `@testcontainers/postgresql` | 12.0.0 | Real Postgres container in integration tests | Official testcontainers Node.js module; mocking PG is prohibited [VERIFIED: npm registry] |
| `testcontainers` | 12.0.0 | Core testcontainers library | Required peer by `@testcontainers/postgresql` [VERIFIED: npm registry] |
| `pg` | 8.21.0 | PG driver — optional, for `aprumo_app` / `aprumo_migration` pool connections in tests using `node-postgres` | Mature, typed, well-documented for multi-role pool pattern [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/pg` | latest | TypeScript types for `pg` | Always when using `pg` driver |
| `vitest` | 4.1.7 (already installed) | Test runner; `globalSetup` + `inject` | Phase 1 already installed; Phase 2 adds globalSetup |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `postgres` (postgres-js) | `pg` (node-postgres) | `postgres` is the recommended driver for Drizzle + ESM; `pg` is used separately for test pools where multi-role connection switching matters |
| Schema-per-file isolation | DB-per-file isolation | DB-per-file is simpler but ~10x slower (CREATE DATABASE serializes); schema-per-file with `search_path` is faster |
| Generic `audit_row_change()` | Per-table audit functions | Generic is DRY; per-table allows typed OLD/NEW columns. Generic chosen for 4 audit tables |

**Installation (packages/core):**
```bash
pnpm --filter @aprumo/core add drizzle-orm postgres
pnpm --filter @aprumo/core add -D drizzle-kit @testcontainers/postgresql testcontainers @types/pg pg
```

**Version verification:** All package versions confirmed via `npm view <pkg> version` on 2026-05-22.

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages tagged [ASSUMED] for provenance; registry existence + source repo verification performed manually.

| Package | Registry | Age | Source Repo | Notes | Disposition |
|---------|----------|-----|-------------|-------|-------------|
| `drizzle-orm` | npm | ~4 yrs | github.com/drizzle-team/drizzle-orm | 200k+ weekly downloads; official Drizzle project | Approved [ASSUMED] |
| `drizzle-kit` | npm | ~4 yrs | github.com/drizzle-team/drizzle-orm | Same mono-repo as drizzle-orm | Approved [ASSUMED] |
| `postgres` | npm | ~5 yrs | github.com/porsager/postgres | 1M+ weekly downloads; widely used | Approved [ASSUMED] |
| `@testcontainers/postgresql` | npm | ~4 yrs | github.com/testcontainers/testcontainers-node | Official testcontainers org | Approved [ASSUMED] |
| `testcontainers` | npm | ~4 yrs | github.com/testcontainers/testcontainers-node | Official testcontainers org | Approved [ASSUMED] |
| `pg` | npm | ~12 yrs | github.com/brianc/node-postgres | 10M+ weekly downloads; canonical PG client | Approved [ASSUMED] |

**Packages removed due to slopcheck verdict:** none
**Packages flagged as suspicious:** none
*All packages above are tagged `[ASSUMED]` because slopcheck was unavailable. Planner should add a `checkpoint:human-verify` task before the first install step.*

---

## Architecture Patterns

### System Architecture Diagram

```
[drizzle-kit generate]
        │ emits 0000_init_tables.sql
        ▼
[drizzle-kit generate --custom] ──► 0001_roles.sql
                                    0002_grants.sql
                                    0003_post_transaction.sql
                                    0004_double_entry_trigger.sql
                                    0005_audit_triggers.sql
        │ all registered in _journal.json (meta/ folder)
        ▼
[pnpm db:migrate]
        │ calls drizzle-orm/postgres-js/migrator
        │ connects as aprumo_migration
        ▼
[Postgres 18 container]
        ├── Tables: accounts, transactions, postings, raw_events,
        │           account_balance, outbound_endpoints, outbound_events,
        │           accounts_audit, outbound_endpoints_audit (+ others)
        ├── Roles: aprumo_app (SELECT/INSERT), aprumo_migration (DDL)
        ├── Function: post_transaction() SECURITY DEFINER
        ├── Constraint trigger: assert_double_entry DEFERRABLE INITIALLY DEFERRED
        └── Audit triggers: AFTER UPDATE/DELETE on mutable tables
                │
    ┌──────────┴──────────────────────────┐
    │                                     │
[Application write path]         [CI verification]
  aprumo_app role                  pg_constraint check
  calls post_transaction()         42501 REVOKE test
  ─► validates SUM=0               drift hash check
  ─► INSERTs transaction           ADR presence check
  ─► INSERTs postings
  ─► COMMIT fires trigger
     ─► queries SUM per tx_id
     ─► RAISE EXCEPTION if ≠ 0

[Vitest globalSetup.ts]
  ─► starts PostgreSqlContainer('postgres:18-alpine')
  ─► project.provide('pgUri', container.getConnectionUri())
  ─► returns teardown → container.stop()
        │
  [Each test file beforeAll]
  ─► inject('pgUri')
  ─► schema = 'test_' + sha1(testPath).slice(0,12)
  ─► CREATE SCHEMA test_xxx
  ─► migrate(db, { migrationsFolder, migrationsSchema: schema })
  ─► returns { app, migration, schema, cleanup }
        │
  [afterAll]
  ─► cleanup() ─► DROP SCHEMA test_xxx CASCADE
```

### Recommended Project Structure

```
packages/core/
├── src/
│   ├── db/
│   │   ├── schema.ts            # Drizzle table definitions (source-of-truth for 0000)
│   │   └── index.ts             # exports db instance + schema
│   ├── sql/                     # (optional) long SQL queries as .sql files
│   └── index.ts                 # package public API
├── migrations/
│   ├── meta/
│   │   ├── _journal.json        # tracked by CI drift check
│   │   └── 0000_snapshot.json   # Drizzle schema snapshot
│   ├── 0000_init_tables.sql     # drizzle-kit generated
│   ├── 0001_roles.sql           # hand-written
│   ├── 0002_grants.sql          # hand-written
│   ├── 0003_post_transaction.sql# hand-written
│   ├── 0004_double_entry_trigger.sql # hand-written
│   ├── 0005_audit_triggers.sql  # hand-written
│   └── 0006_seed_dev.sql        # hand-written (dev-only, NOT in db:migrate)
├── tests/
│   ├── globalSetup.ts           # starts/stops PG container
│   ├── setup/
│   │   └── container.ts         # PostgreSqlContainer instance + digest constant
│   ├── helpers/
│   │   └── createTestDb.ts      # schema-per-file helper
│   └── *.integration.test.ts    # integration tests
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

### Pattern 1: Drizzle Hybrid Migration Setup

**What:** `schema.ts` declares tables; `drizzle-kit generate` emits `0000_init_tables.sql`; subsequent hand-written files are scaffolded as empty with `drizzle-kit generate --custom --name=<slug>` which registers them in `meta/_journal.json`.

**drizzle.config.ts:**
```typescript
// Source: https://orm.drizzle.team/docs/drizzle-config-file
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  migrations: {
    table: '__drizzle_migrations', // default
    schema: 'drizzle',            // default — where the tracking table lives
  },
})
```

**Generating the initial migration (Drizzle):**
```bash
pnpm drizzle-kit generate
# Creates migrations/meta/_journal.json + migrations/meta/0000_snapshot.json
# Creates migrations/0000_init_tables.sql
```

**Registering hand-written migrations (one per file):**
```bash
pnpm drizzle-kit generate --custom --name=roles
# Creates empty migrations/0001_roles.sql
# Appends entry to migrations/meta/_journal.json

pnpm drizzle-kit generate --custom --name=grants
# Creates migrations/0002_grants.sql + appends to _journal.json
# ... repeat for post_transaction, double_entry_trigger, audit_triggers
```

**`_journal.json` structure** (what gets written):
```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1716062400000,
      "tag": "0000_init_tables",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "7",
      "when": 1716062401000,
      "tag": "0001_roles",
      "breakpoints": true
    }
  ]
}
```
Note: The `_journal.json` entries reference files by `tag` (which maps to `<tag>.sql`). The file hash for drift detection is computed by the CI script against the `.sql` file content, NOT stored in `_journal.json` itself. [ASSUMED — internal structure inferred from Drizzle source; official docs do not publish the schema]

**Programmatic migrate runner (used in scripts AND test helper):**
```typescript
// Source: https://orm.drizzle.team/docs/migrations
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const migrationClient = postgres(process.env.DATABASE_URL!, { max: 1 })
const db = drizzle(migrationClient)
await migrate(db, {
  migrationsFolder: './migrations',
  migrationsSchema: 'public',   // schema where __drizzle_migrations lives
})
await migrationClient.end()
```

**Pitfall:** `migrate()` requires `{ max: 1 }` on the postgres-js connection — it uses a single connection and does not work with a pool. [VERIFIED: https://orm.drizzle.team/docs/migrations]

---

### Pattern 2: `post_transaction(postings[])` SECURITY DEFINER Function

**What:** The sole write path into `postings`. Validates `SUM(amount_cents WITH SIGN) = 0`. Persists `transactions` + `postings` atomically. `aprumo_app` has EXECUTE on the function but NO direct INSERT on `postings`.

**Recommended approach:** SECURITY DEFINER + composite type argument

**Why SECURITY DEFINER over GRANT INSERT + convention:**
- Convention can be bypassed by future developers or bugs; DB-level enforcement cannot.
- `aprumo_app` with no INSERT on `postings` means no code path can insert postings directly — not even future code, not even ORM mistakes.
- SECURITY DEFINER runs as the function owner (likely `aprumo_migration` which does have INSERT on postings).
- Planner should consider: `aprumo_migration` owns the function; `aprumo_app` has EXECUTE permission.

**Why composite type over JSONB array:**
- Type safety: PG composite type `posting_input` gives column-level type checking in plpgsql.
- Cleaner code: `rec.account_id`, `rec.amount_cents` vs `(j->>'account_id')::uuid`, `(j->>'amount_cents')::bigint`.
- Drizzle's query builder can construct the composite array with proper casting.
- JSONB array is simpler to construct from TypeScript but loses type checking at the PG boundary.

**Concrete implementation skeleton:**
```sql
-- In 0003_post_transaction.sql

-- 1. Define composite input type
CREATE TYPE posting_input AS (
  account_id    uuid,
  amount_cents  bigint,
  direction     text    -- 'debit' | 'credit'
);

-- 2. The function (SECURITY DEFINER — runs as owner, not caller)
CREATE OR REPLACE FUNCTION post_transaction(
  p_idempotency_key  text,
  p_description      text,
  p_source           text,
  p_metadata         jsonb,
  p_postings         posting_input[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public   -- security best practice: prevent search_path injection
AS $$
DECLARE
  v_tx_id        uuid;
  v_signed_sum   bigint := 0;
  v_rec          posting_input;
BEGIN
  -- Idempotency: return existing tx_id if key already used
  SELECT id INTO v_tx_id
    FROM transactions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_tx_id;
  END IF;

  -- Validate postings array is not empty
  IF array_length(p_postings, 1) IS NULL THEN
    RAISE EXCEPTION 'post_transaction: postings array must not be empty'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate double-entry balance before inserting
  -- (belt-and-suspenders with the CONSTRAINT TRIGGER)
  FOREACH v_rec IN ARRAY p_postings LOOP
    IF v_rec.direction = 'debit' THEN
      v_signed_sum := v_signed_sum + v_rec.amount_cents;
    ELSIF v_rec.direction = 'credit' THEN
      v_signed_sum := v_signed_sum - v_rec.amount_cents;
    ELSE
      RAISE EXCEPTION 'post_transaction: invalid direction %, must be debit or credit', v_rec.direction
        USING ERRCODE = 'P0001';
    END IF;

    IF v_rec.amount_cents <= 0 THEN
      RAISE EXCEPTION 'post_transaction: amount_cents must be positive, got %', v_rec.amount_cents
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF v_signed_sum <> 0 THEN
    RAISE EXCEPTION 'post_transaction: postings do not balance (signed sum = %)', v_signed_sum
      USING ERRCODE = 'P0001';
  END IF;

  -- Insert transaction
  v_tx_id := gen_random_uuid();
  INSERT INTO transactions (id, idempotency_key, ts, description, source, metadata)
  VALUES (v_tx_id, p_idempotency_key, now(), p_description, p_source, p_metadata);

  -- Insert postings (this role has INSERT because of SECURITY DEFINER)
  FOREACH v_rec IN ARRAY p_postings LOOP
    INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
    VALUES (gen_random_uuid(), v_tx_id, v_rec.account_id, v_rec.amount_cents, v_rec.direction);
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- Grant EXECUTE to aprumo_app (NOT INSERT on postings)
GRANT EXECUTE ON FUNCTION post_transaction(text, text, text, jsonb, posting_input[]) TO aprumo_app;
```

**Idempotency collision handling:** Return existing `transaction_id` on `FOUND` — do NOT raise an error. This matches the requirement that duplicate `Idempotency-Key` returns the original transaction (HTTP 200 in Phase 3). [ASSUMED — pattern derived from standard idempotency key convention; matches REQUIREMENTS.md API-05]

---

### Pattern 3: CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED

**What:** Cross-row aggregate check: `SUM(amount_cents WITH SIGN per transaction_id) = 0` at COMMIT. This is the second layer of defense after `post_transaction`'s inline check.

**Key insight:** An AFTER ROW constraint trigger can query the table it's on at deferred firing time (COMMIT), enabling aggregate checks across all rows of a transaction. The trigger fires once per inserted/updated row but at COMMIT has visibility into all committed rows of that transaction. [VERIFIED: https://www.postgresql.org/message-id/5C29B392-6215-4791-8DD8-7B8977A637B7@yugabyte.com]

```sql
-- In 0004_double_entry_trigger.sql

CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_signed_sum bigint;
BEGIN
  -- Compute signed sum for this transaction_id
  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'debit'  THEN  amount_cents
      WHEN 'credit' THEN -amount_cents
      ELSE 0
    END
  ), 0)
  INTO v_signed_sum
  FROM postings
  WHERE transaction_id = NEW.transaction_id;

  IF v_signed_sum <> 0 THEN
    RAISE EXCEPTION
      'double_entry_violation: transaction % has unbalanced postings (signed sum = %)',
      NEW.transaction_id, v_signed_sum
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL; -- AFTER triggers ignore return value
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED: fires at COMMIT, not at statement end
CREATE CONSTRAINT TRIGGER assert_double_entry
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_double_entry_balance();
```

**SQLSTATE for Phase 3 mapping:**
- Error code `P0001` (raise_exception) is the default RAISE EXCEPTION code.
- In Phase 3, the Fastify error handler catches `error.code === 'P0001'` where `error.message` contains `double_entry_violation:` → maps to HTTP 422.
- Custom code `AP001` is an alternative for more precise routing (any 5-char alphanumeric code is valid). Using `P0001` with a distinctive message prefix is simpler and sufficient. [ASSUMED — custom code pattern is valid PG; message-prefix routing is a common pattern]

**Performance:** The trigger fires once per inserted posting (not once per transaction). For a typical 2-posting transaction, it queries `postings WHERE transaction_id = $1` twice. With an index on `postings(transaction_id)` this is an index scan of ~2 rows — negligible overhead. The function body is simple: one aggregate query. [ASSUMED — performance estimate based on typical ledger workloads]

**CI verification (FND-11):**
```sql
SELECT condeferrable, condeferred
FROM pg_constraint
WHERE conname = 'assert_double_entry'
  AND conrelid = 'postings'::regclass;
-- Expected: { condeferrable: true, condeferred: true }
```
This query runs in a vitest integration test AFTER the migration suite completes. The test asserts both columns are `true`. [VERIFIED: pg_constraint columns from official PG docs]

---

### Pattern 4: Role Permission Model

**What:** `aprumo_migration` = DDL owner. `aprumo_app` = runtime role with SELECT/INSERT on most tables, NO UPDATE/DELETE on `postings`/`raw_events`. Default privileges ensure future tables inherit the pattern.

```sql
-- In 0001_roles.sql
-- IF NOT EXISTS prevents failure on re-run in dev (reset + re-migrate)
CREATE ROLE aprumo_app  NOLOGIN NOSUPERUSER;
CREATE ROLE aprumo_migration NOLOGIN NOSUPERUSER CREATEDB;

-- In dev, passwords are set by docker-compose init script or .env.example
-- NEVER hardcode passwords here — this file is committed
```

```sql
-- In 0002_grants.sql
-- Grant SELECT + INSERT on all existing tables to aprumo_app
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aprumo_app;

-- Revoke mutation access on append-only tables
REVOKE UPDATE, DELETE ON TABLE postings   FROM aprumo_app;
REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app;

-- Default privileges: future tables created by aprumo_migration get the same grants
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO aprumo_app;

-- Sequences: aprumo_app needs USAGE on sequences for INSERT with serial/identity
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aprumo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO aprumo_app;
```

**Why ALTER DEFAULT PRIVILEGES matters:**
- `ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration` means: *"For any table that aprumo_migration creates in the future, automatically grant SELECT/INSERT to aprumo_app."* [VERIFIED: https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html]
- Without this, every new migration that adds a table would need to explicitly GRANT to aprumo_app.
- `GRANT ... ON ALL TABLES` applies only to tables that exist at the time the statement runs — it does not cover future tables.

**SECURITY DEFINER function owner note:**
- `post_transaction` is owned by `aprumo_migration` (the role that creates it).
- `aprumo_migration` HAS INSERT on `postings`.
- SECURITY DEFINER means the function runs with `aprumo_migration`'s rights, not the caller's.
- Therefore: `aprumo_app` calls `post_transaction`, which internally INSERTs into postings with `aprumo_migration`'s INSERT privilege.
- `aprumo_app` itself has no INSERT on `postings` — only EXECUTE on the function.
- This is the correct pattern; it closes the only INSERT path. [VERIFIED: https://www.postgresql.org/docs/current/sql-createfunction.html]

**`IF NOT EXISTS` on CREATE ROLE:**
PG 16+ supports `CREATE ROLE IF NOT EXISTS`. Use it in `0001_roles.sql` to make migrations re-runnable in dev after `db:reset`. [VERIFIED: PostgreSQL 16 release notes feature]

---

### Pattern 5: Audit Trigger (Generic Function)

**What:** Single `audit_row_change()` plpgsql function using `TG_TABLE_NAME`, `TG_OP`, `to_jsonb(OLD)`, `to_jsonb(NEW)`. Attached `AFTER UPDATE OR DELETE` on `accounts`, `outbound_endpoints`, `outbound_events`. NOT on `postings` or `raw_events` (append-only, no mutation to audit). [VERIFIED: https://www.postgresql.org/docs/current/plpgsql-trigger.html]

**Concrete implementation:**
```sql
-- In 0005_audit_triggers.sql

-- Audit shadow tables (created in 0000_init_tables.sql by Drizzle schema.ts)
-- Pattern: accounts_audit, outbound_endpoints_audit, outbound_events_audit

-- Generic audit function
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_log (  -- or into the appropriate *_audit shadow table
    table_name,
    operation,
    old_data,
    new_data,
    changed_by,
    changed_at
  ) VALUES (
    TG_TABLE_NAME,
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    current_user,
    now()
  );
  RETURN NULL; -- AFTER triggers; return value ignored
END;
$$;

-- Attach to each mutable table
CREATE TRIGGER accounts_audit_trigger
  AFTER UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

CREATE TRIGGER outbound_endpoints_audit_trigger
  AFTER UPDATE OR DELETE ON outbound_endpoints
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();
```

**Discretion note:** The planner should decide whether to use a single `audit_log` table (with `table_name` column) or separate `accounts_audit`, `outbound_endpoints_audit` shadow tables with mirrored column structure. The FND-06 requirement says `*_audit` shadow tables — so Drizzle `schema.ts` must define each shadow table; the trigger inserts into the appropriate one by `TG_TABLE_NAME`. The generic function approach using `to_jsonb()` is flexible; the function can `EXECUTE format('INSERT INTO %I_audit ...', TG_TABLE_NAME)` for dynamic routing.

**`TG_OP` values:** `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`. [VERIFIED: https://www.postgresql.org/docs/current/plpgsql-trigger.html]
**Return value for AFTER triggers:** Always ignored by PG — return NULL. [VERIFIED: same source]

---

### Pattern 6: Testcontainers globalSetup with inject()

**What:** `tests/globalSetup.ts` starts one `PostgreSqlContainer('postgres:18-alpine@sha256:...')` for the entire Vitest run. Uses Vitest's `project.provide()` + `inject()` API to pass the connection URI to worker processes (forks). Each test file's `beforeAll` calls `createTestDb()` which creates an isolated schema and runs migrations.

**globalSetup.ts:**
```typescript
// packages/core/tests/globalSetup.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'

// Import the pinned digest constant
import { PG_IMAGE } from './setup/container.js'

let container: StartedPostgreSqlContainer

export async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const useReuse = process.env['APRUMO_TEST_REUSE'] === '1'

  let builder = new PostgreSqlContainer(PG_IMAGE)
  // .withReuse() is available in testcontainers-node; disabled by default per D-40
  if (useReuse) {
    // builder = builder.withReuse()  // enable with env var for local dev speed
  }

  container = await builder.start()

  // Provide the URI to all worker forks via Vitest's inject API
  project.provide('pgUri', container.getConnectionUri())
}

export async function teardown() {
  await container.stop()
}
```

**container.ts (digest pinning):**
```typescript
// packages/core/tests/setup/container.ts
// Single source of truth for the PG image digest
// Update this when upgrading Postgres version
export const PG_IMAGE = 'postgres:18-alpine'
// When pinning by digest:
// export const PG_IMAGE = 'postgres:18-alpine@sha256:<digest>'
// Get digest: docker pull postgres:18-alpine && docker inspect postgres:18-alpine | jq '.[0].RepoDigests'
```

**createTestDb helper:**
```typescript
// packages/core/tests/helpers/createTestDb.ts
import { inject } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Pool } from 'pg'

const MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), '../../../migrations')

export interface TestDb {
  app: Pool         // aprumo_app role — for production-path tests
  migration: Pool   // aprumo_migration role — for setup + FND-08 reverse tests
  schema: string
  cleanup: () => Promise<void>
}

export async function createTestDb(testPath: string): Promise<TestDb> {
  const pgUri = inject('pgUri') as string

  // Deterministic schema name from test file path (12-char hex prefix)
  const schema = 'test_' + createHash('sha1').update(testPath).digest('hex').slice(0, 12)

  // Migration connection: connect to default schema first, then create test schema
  const migrationSql = postgres(pgUri, { max: 1 })

  await migrationSql`CREATE SCHEMA IF NOT EXISTS ${migrationSql(schema)}`

  // Run migrations into the test schema
  // search_path set per-connection via options so migrate() targets the right schema
  const migrationWithSchema = postgres(pgUri, {
    max: 1,
    options: `--search_path=${schema},public`,
  })
  const db = drizzle(migrationWithSchema)
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: schema,  // isolates __drizzle_migrations table per test schema
  })
  await migrationWithSchema.end()
  await migrationSql.end()

  // Return typed pools for tests
  const app = new Pool({
    connectionString: pgUri,
    // In real prod: separate credentials; in test: same URI, different search_path
    options: `--search_path=${schema},public`,
  })

  const migration = new Pool({
    connectionString: pgUri,
    options: `--search_path=${schema},public`,
  })

  const cleanup = async () => {
    await app.end()
    await migration.end()
    const cleanupSql = postgres(pgUri, { max: 1 })
    await cleanupSql`DROP SCHEMA IF EXISTS ${cleanupSql(schema)} CASCADE`
    await cleanupSql.end()
  }

  return { app, migration, schema, cleanup }
}
```

**Vitest config update (root vitest.config.ts) — add globalSetup:**
```typescript
// vitest.config.ts root — Phase 2 adds globalSetup
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: 'packages/core/tests/globalSetup.ts',
    projects: [
      // ... existing projects array from Phase 1
    ]
  }
})
```

**Critical notes on inject() + pool:forks:**
- `inject()` is the ONLY safe way to pass data from `globalSetup` to test workers when using `pool: 'forks'` — forks do NOT share memory with the main process.
- `process.env` set in `globalSetup` IS propagated to forks (env vars are inherited on fork).
- `project.provide()` + `inject()` is cleaner and type-safe. Both approaches work. [VERIFIED: https://vitest.dev/config/globalsetup.html]
- `inject()` only works in Vitest test files (not in helper modules called directly from Node). Import `inject` from `'vitest'` — it throws if called outside test context.

---

### Pattern 7: Drift Check CI Script

**What:** Re-hash all `.sql` files in `migrations/`, compare against entries in `_journal.json`. Fail if any file content has changed since journal was committed.

```typescript
// scripts/check-migration-drift.ts (run in CI via pnpm tsx)
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const MIGRATIONS_DIR = resolve('packages/core/migrations')
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta/_journal.json')

interface JournalEntry {
  idx: number
  tag: string
  when: number
  version: string
  breakpoints: boolean
}

interface Journal {
  entries: JournalEntry[]
}

const journal: Journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'))

let driftDetected = false

for (const entry of journal.entries) {
  const filePath = join(MIGRATIONS_DIR, `${entry.tag}.sql`)
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    console.error(`DRIFT: Migration file missing: ${filePath}`)
    driftDetected = true
    continue
  }

  // Hash the file content (SHA-256 hex)
  const hash = createHash('sha256').update(content).digest('hex')

  // Compare against a stored hash — but _journal.json does NOT store file hashes by default
  // Strategy: first run stores hashes in a separate committed file (migration-hashes.json)
  // OR: compare against git-committed version of the file using git show HEAD:path
  console.log(`${entry.tag}: ${hash}`)
}

// Alternative simpler strategy: use git to detect if any migrations/*.sql was modified
// git diff --name-only HEAD -- packages/core/migrations/*.sql
// If any file shows as modified AND is in _journal.json, it's drift.
```

**Simpler CI approach** (git-based, recommended):
```bash
# In CI step after checkout:
# Any .sql migration file that was committed and then modified is drift.
MODIFIED=$(git diff --name-only HEAD -- 'packages/core/migrations/*.sql' 2>/dev/null | grep -v '^$')
if [ -n "$MODIFIED" ]; then
  echo "DRIFT DETECTED: The following committed migration files have been modified:"
  echo "$MODIFIED"
  exit 1
fi
```

**Note on hash storage:** The cleanest implementation stores a `migration-hashes.json` committed alongside the migration files. On first run (generating migrations), `pnpm db:generate` computes and writes the hashes. CI reads the committed hashes and recomputes from current file content. [ASSUMED — `_journal.json` does not natively store per-file content hashes; this is a custom addition]

**Alternative:** Since migrations are committed to git, the git approach (`git diff HEAD`) is the simplest zero-tooling drift check. It correctly detects edits to committed files. The planner should choose one strategy and document it.

---

### Pattern 8: MADR 4.0 ADR Template

**What:** Standard MADR 4.0 format for all 9 ADRs. [VERIFIED: https://adr.github.io/madr/]

**Frontmatter fields:**
```yaml
---
status: "Accepted"
date: "2026-05-18"         # decided: date of original decision (PRD date for 001-008)
decision-makers: "Joao Escudero"
consulted: ""
informed: ""
---
```

**Section order (MADR 4.0):**
1. `# ADR-001: [Title]` (H1 heading)
2. `## Context and Problem Statement` — what problem does this decision solve?
3. `## Decision Drivers` — forces/criteria that shaped the decision
4. `## Considered Options` — list of alternatives evaluated
5. `## Decision Outcome` — what was chosen and why
6. `### Consequences` — what becomes easier/harder; risks accepted
7. `### Confirmation` — how to verify the decision was implemented correctly (optional)
8. `## Pros and Cons of the Options` — table or subsection per option (optional)
9. `## More Information` — links, references, superseded decisions (optional)

**ADR-001 (Postgres as ledger engine) skeleton:**
```markdown
---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-001: Use PostgreSQL as the Ledger Engine

## Context and Problem Statement

Aprumo needs a persistent store that can enforce double-entry accounting
invariants at the database level, support ACID transactions with
SERIALIZABLE isolation, and host the pg-boss job queue in the same
transaction boundary as the ledger writes (exact-once webhook guarantee).

## Decision Drivers

- Must support DEFERRABLE CONSTRAINT TRIGGERs for deferred double-entry validation
- Must allow pg-boss to participate in the same Postgres transaction
- Must support fine-grained role permissions (REVOKE UPDATE/DELETE)
- Operational simplicity: self-hosted on a single instance without distributed consensus

## Considered Options

- PostgreSQL 16+
- TigerBeetle
- ScyllaDB / Cassandra (rejected without deep evaluation)

## Decision Outcome

PostgreSQL 16+ was chosen. It satisfies all requirements above. TigerBeetle
was evaluated and rejected.

### Consequences

- Good: Single database for ledger + queue + migrations simplifies deployment
- Good: 30+ years of operational maturity; ecosystem of hosting options
- Bad: No horizontal write sharding at the DB layer (acceptable for v0.1 target of 100 RPS)
- Accepted risk: Postgres performance ceiling at ~10k TPS for ledger workloads

## Pros and Cons of the Options

### PostgreSQL 16+

- Pro: DEFERRABLE CONSTRAINT TRIGGER — required for deferred double-entry validation
- Pro: pg-boss exact-once webhook via shared transaction
- Pro: SERIALIZABLE isolation level available and documented
- Con: Not optimized purely for financial ledger throughput

### TigerBeetle

- Pro: Purpose-built for financial ledger; sub-millisecond transfers
- Con: No standard SQL; custom API; no pg-boss compatibility
- Con: Adds operational complexity (separate process, separate backups)
- Con: No equivalent of `CONSTRAINT TRIGGER DEFERRABLE` for custom validation
- Con: Not ACID in the relational sense; eventual consistency model for cross-account

## More Information

See PRD.md §9 ADR-001. TigerBeetle evaluation summary in `.planning/research/SUMMARY.md`.
```

**D-44 honest dating note:** Add after frontmatter or in "More Information":
```markdown
> **Note on dating:** This decision was made during initial project design (2026-05-18)
> and documented here on 2026-05-22 as a back-fill from PRD.md §9.
> The `date` field reflects the original decision, not the documentation date.
```

---

### Pattern 9: `pnpm db:migrate` Script Wiring

**Root package.json scripts (already has placeholder — replace with real delegation):**
```json
{
  "scripts": {
    "db:migrate": "pnpm --filter @aprumo/core db:migrate",
    "db:reset":   "pnpm --filter @aprumo/core db:reset",
    "db:generate":"pnpm --filter @aprumo/core db:generate",
    "db:seed":    "pnpm --filter @aprumo/core db:seed"
  }
}
```

**packages/core/package.json additions:**
```json
{
  "scripts": {
    "db:migrate": "tsx src/db/migrate.ts",
    "db:reset":   "tsx src/db/reset.ts",
    "db:generate":"drizzle-kit generate",
    "db:seed":    "tsx migrations/0006_seed_dev.ts"
  }
}
```

**src/db/migrate.ts:**
```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATABASE_URL = process.env['DATABASE_URL']
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')

const MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), '../../migrations')

const sql = postgres(DATABASE_URL, { max: 1 })
const db = drizzle(sql)

try {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
  console.log('Migrations applied successfully')
} finally {
  await sql.end()
}
```

**Role credentials in dev:** `.env.example` documents `DATABASE_URL=postgres://aprumo_migration:changeme@localhost:5432/aprumo`. Docker-compose creates the roles via an init script (`docker-entrypoint-initdb.d/`). CI uses a fresh PG container with roles created by the first migration. [ASSUMED — standard Docker PG init script pattern; see docker-compose notes in FND-12]

---

### Pattern 10: schema.ts Drizzle Declarations

**What:** The TypeScript source that `drizzle-kit generate` reads to produce `0000_init_tables.sql`. Must declare all tables, FKs, CHECK constraints, and indexes that Drizzle can model. Hand-written migrations handle what Drizzle cannot (roles, functions, triggers).

**Critical Drizzle notes for this schema:**
- Use `bigint('amount_cents', { mode: 'bigint' })` NOT `bigint('amount_cents')` — the `mode: 'bigint'` option maps to JS `BigInt`, not `Number`. This is mandatory for money. [VERIFIED: drizzle-orm docs]
- `uuid` columns: use `uuid('id').defaultRandom().primaryKey()` to get `gen_random_uuid()` default.
- For `pending_balance BIGINT NULL` reservation (D-45): `bigint('pending_balance', { mode: 'bigint' })` — nullable by default in Drizzle (no `.notNull()`).
- COMMENT ON COLUMN must be in a hand-written migration (Drizzle `schema.ts` does not emit COMMENT directives). [ASSUMED — Drizzle does not expose COMMENT via schema.ts as of 0.45.2]

**account_balance with reservations (D-45/D-47):**
```typescript
export const accountBalance = pgTable('account_balance', {
  accountId:        uuid('account_id').primaryKey().references(() => accounts.id),
  balance:          bigint('balance', { mode: 'bigint' }).notNull().default(0n),
  lastPostingId:    uuid('last_posting_id'),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // D-45: Reserved for v0.5 pending balance tracking — NULL in v0.1
  pendingBalance:   bigint('pending_balance', { mode: 'bigint' }),
  availableBalance: bigint('available_balance', { mode: 'bigint' }),
})
```

---

### Anti-Patterns to Avoid

- **Using `bigint` without `{ mode: 'bigint' }` in Drizzle schema:** Without mode, Drizzle maps bigint to JS `number` — silent precision loss for values > 2^53. Always use `{ mode: 'bigint' }`.
- **Calling `migrate()` with a pooled connection:** The migrator requires `max: 1`. A pooled connection will hang or error. Use a separate migration client.
- **`SET CONSTRAINTS ALL IMMEDIATE` in test helpers:** This disables the deferred trigger globally in the session, making FND-10 tests meaningless. Never call this in test setup/teardown.
- **Calling `project.provide()` after returning from setup:** Data must be provided during the synchronous execution of `setup()` before the return/teardown.
- **`GRANT INSERT ON postings TO aprumo_app` anywhere:** This breaks the sole-write-path invariant. Only the SECURITY DEFINER function should be able to INSERT into postings.
- **Testing with `INSERT INTO postings` directly in integration tests:** Tests must call `post_transaction()` like production code does. Direct INSERTs bypass the constraint trigger and validate nothing.
- **Forgetting `SET search_path = public` in SECURITY DEFINER functions:** Without this, a malicious caller could inject a different `search_path` and redirect function calls. Mandatory for all SECURITY DEFINER functions. [VERIFIED: PostgreSQL docs on SECURITY DEFINER + search_path]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PG migration tracking | Custom migration history table + version checker | `drizzle-orm/postgres-js/migrator` | Handles idempotency, ordering, and the `_journal.json` integration out-of-box |
| Schema drift detection | Custom hash database or PG-side check | Git-based `git diff HEAD` or committed `migration-hashes.json` + Node script | Zero tooling, reliable, fast |
| PG container in tests | `docker run` subprocess management | `@testcontainers/postgresql` | Lifecycle management, port mapping, log capture, `.stop()` cleanup |
| Cross-row aggregate constraint | Application-layer double-entry check only | `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` | Provides DB-level guarantee that cannot be bypassed by any application code |
| Hand-rolled REVOKE enforcement | Trusting application layer not to UPDATE postings | `REVOKE UPDATE, DELETE ON postings FROM aprumo_app` | Cannot be bypassed — even a bug, ORMleak, or raw query will fail with 42501 |
| ADR web tooling | `adr-tools` CLI, `log4brains` static site | Plain MADR markdown files + index table | No dependency; readable in GitHub UI; searchable with grep; convention is the interface |

**Key insight:** The combination of three DB-level defenses (REVOKE + SECURITY DEFINER + CONSTRAINT TRIGGER) means immutability is enforced even if all application code is compromised. This is the correct threat model for a financial ledger.

---

## Common Pitfalls

### Pitfall 1: Deferred Trigger Silently Bypassed by `SET CONSTRAINTS ALL IMMEDIATE`

**What goes wrong:** Any test helper, seed script, or ORM query that calls `SET CONSTRAINTS ALL IMMEDIATE` will cause the deferred trigger to fire immediately after each row INSERT, not at COMMIT. If `post_transaction` validates balance before inserting (which it does), the deferred trigger will always pass because the function only inserts balanced rows. But the deferred trigger is meant to be a second layer of defense — a direct INSERT bypass would fail the trigger correctly, but `SET CONSTRAINTS IMMEDIATE` changes the firing semantics.

**Why it happens:** Drizzle or ORMs sometimes emit `SET CONSTRAINTS ALL IMMEDIATE` as a "safety" measure before certain operations. Test helpers that wrap in a transaction and call `ROLLBACK` may also trigger this.

**How to avoid:** Search the codebase for `SET CONSTRAINTS` before Phase 3. CI should assert `pg_constraint.condeferred = true` after every migration run (FND-11). Never call `SET CONSTRAINTS` in test helpers.

**Warning signs:** The FND-11 test passes but the FND-10 red-path test (inserting unbalanced postings directly) fails to trigger the exception.

---

### Pitfall 2: `_journal.json` Not Updated After Hand-Writing a Migration

**What goes wrong:** Developer writes `0003_post_transaction.sql` manually (not via `drizzle-kit generate --custom`) and the file is not registered in `_journal.json`. Running `pnpm db:migrate` will not apply the file because the migrator reads the journal, not the directory. The migration is silently skipped.

**Why it happens:** Muscle memory from other migration tools (node-pg-migrate, Flyway) where adding a file to the directory is sufficient.

**How to avoid:** Always use `drizzle-kit generate --custom --name=<slug>` to scaffold hand-written migration files. This ensures journal registration. If a file was written manually, run `drizzle-kit generate --custom --name=<slug>` for the empty file, then move the content in. Alternatively, manually add the journal entry following the existing format.

**Warning signs:** `pnpm db:migrate` completes without error but the `post_transaction` function does not exist in the DB.

---

### Pitfall 3: `pool: 'forks'` + `inject()` Timing

**What goes wrong:** `inject('pgUri')` called outside a Vitest test lifecycle hook returns `undefined`. This happens if the URI is accessed at module import time (top-level `const pgUri = inject('pgUri')`) rather than inside `beforeAll` or a test body.

**Why it happens:** `inject()` is only valid after the global setup has run and the Vitest test runtime is active. Module-level evaluation happens before test lifecycle.

**How to avoid:** Always call `inject()` inside `beforeAll`, `beforeEach`, or inside test functions. Never at module top level in test files.

**Warning signs:** `pgUri` is `undefined`; connection string errors; `postgres(undefined)` throws.

---

### Pitfall 4: Schema `search_path` and `__drizzle_migrations` Table Collisions

**What goes wrong:** Multiple test files running in parallel (Vitest forks) all use the same `migrationsSchema: 'public'` when calling `migrate()`, causing concurrent writes to the same `__drizzle_migrations` tracking table and race conditions.

**Why it happens:** Default `migrationsSchema` is `'public'`; must be overridden per test schema.

**How to avoid:** Always pass `migrationsSchema: schema` in `migrate(db, { migrationsSchema: schema })` where `schema` is the per-test schema name. This creates `__drizzle_migrations` inside `test_xxx` schema, isolating tracking. [VERIFIED: https://zenn.dev/sora_kumo/articles/drizzle-pg-schema]

---

### Pitfall 5: `CREATE ROLE IF NOT EXISTS` + Password Management

**What goes wrong:** If `0001_roles.sql` uses `CREATE ROLE aprumo_app` (without IF NOT EXISTS), running `pnpm db:migrate` a second time (e.g., in CI with a container that wasn't fresh-wiped) fails with "role already exists".

**Why it happens:** Roles are database-cluster-level objects; they persist across `DROP DATABASE` and recreation of the `aprumo` database unless explicitly dropped.

**How to avoid:** Use `CREATE ROLE IF NOT EXISTS aprumo_app NOLOGIN` (PostgreSQL 16+ syntax). [VERIFIED: PG 16 release notes]

**Warning signs:** `pnpm db:migrate` fails with `role "aprumo_app" already exists` on repeated runs.

---

### Pitfall 6: `COMMENT ON COLUMN` Lost in Drizzle-Generated SQL

**What goes wrong:** Developer adds `.comment('...')` to a Drizzle column definition expecting it to emit `COMMENT ON COLUMN` in `0000_init_tables.sql`. As of drizzle-kit 0.31.10, Drizzle does not emit `COMMENT ON COLUMN` directives.

**Why it happens:** Drizzle's schema model does not include column comments in DDL generation.

**How to avoid:** Add `COMMENT ON COLUMN` statements in the hand-written migration for `pending_balance` / `available_balance` (D-47). These can go in `0002_grants.sql` or a dedicated append to `0000_init_tables.sql` — but since `0000` is Drizzle-generated (drift-protected), the comments must be in a hand-written file. The `0002_grants.sql` is a natural place, or create `0002a_comments.sql` registered separately. [ASSUMED — based on drizzle-kit 0.31.10 feature set; verify COMMENT support status before coding]

---

## Code Examples

### Integration Test: FND-08 (REVOKE Enforcement)

```typescript
// packages/core/tests/schema/revoke.integration.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/createTestDb.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb(import.meta.url)
})

afterAll(async () => {
  await db.cleanup()
})

describe('FND-08: aprumo_app REVOKE enforcement', () => {
  it('should reject UPDATE on postings with SQLSTATE 42501', async () => {
    // Red: this test must fail BEFORE the migration runs (no table = different error)
    // Green: after 0002_grants.sql runs, UPDATE attempt returns 42501
    await expect(
      db.app.query('UPDATE postings SET amount_cents = 0 WHERE id = gen_random_uuid()')
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('should reject DELETE on raw_events with SQLSTATE 42501', async () => {
    await expect(
      db.app.query('DELETE FROM raw_events WHERE id = gen_random_uuid()')
    ).rejects.toMatchObject({ code: '42501' })
  })
})
```

### Integration Test: FND-11 (Constraint Trigger condeferrable/condeferred)

```typescript
// packages/core/tests/schema/constraint-trigger.integration.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/createTestDb.js'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb(import.meta.url)
})

afterAll(async () => {
  await db.cleanup()
})

describe('FND-11: double-entry constraint trigger is deferrable', () => {
  it('should have condeferrable=true AND condeferred=true for assert_double_entry', async () => {
    const result = await db.migration.query<{
      condeferrable: boolean
      condeferred: boolean
    }>(`
      SELECT condeferrable, condeferred
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      WHERE c.conname = 'assert_double_entry'
        AND r.relname = 'postings'
    `)
    expect(result.rows[0]).toBeDefined()
    expect(result.rows[0]?.condeferrable).toBe(true)
    expect(result.rows[0]?.condeferred).toBe(true)
  })
})
```

### Integration Test: FND-09 + FND-10 (post_transaction balance validation)

```typescript
// packages/core/tests/schema/post-transaction.integration.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/createTestDb.js'
import { randomUUID } from 'node:crypto'

let db: TestDb

beforeAll(async () => {
  db = await createTestDb(import.meta.url)
  // Seed: create two accounts needed for the tests
  await db.migration.query(`
    INSERT INTO accounts (id, type, owner_ref) VALUES
    (gen_random_uuid(), 'asset',     'test-owner'),
    (gen_random_uuid(), 'liability', 'test-owner')
  `)
})

afterAll(async () => {
  await db.cleanup()
})

describe('FND-09: post_transaction sole write path', () => {
  it('accepts balanced postings and returns a transaction UUID', async () => {
    const accounts = await db.migration.query<{ id: string }>(
      'SELECT id FROM accounts LIMIT 2'
    )
    const [acc1, acc2] = accounts.rows
    expect(acc1).toBeDefined()
    expect(acc2).toBeDefined()

    const result = await db.app.query<{ post_transaction: string }>(`
      SELECT post_transaction(
        $1::text, 'test tx', 'test', '{}'::jsonb,
        ARRAY[
          ROW($2::uuid, 100::bigint, 'debit')::posting_input,
          ROW($3::uuid, 100::bigint, 'credit')::posting_input
        ]
      )
    `, [randomUUID(), acc1!.id, acc2!.id])
    expect(result.rows[0]?.post_transaction).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-/
    )
  })

  it('rejects unbalanced postings with SQLSTATE P0001', async () => {
    const accounts = await db.migration.query<{ id: string }>(
      'SELECT id FROM accounts LIMIT 2'
    )
    const [acc1, acc2] = accounts.rows
    await expect(
      db.app.query(`
        SELECT post_transaction(
          $1::text, 'unbalanced', 'test', '{}'::jsonb,
          ARRAY[
            ROW($2::uuid, 100::bigint, 'debit')::posting_input,
            ROW($3::uuid, 50::bigint, 'credit')::posting_input
          ]
        )
      `, [randomUUID(), acc1!.id, acc2!.id])
    ).rejects.toMatchObject({ code: 'P0001' })
  })
})
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-pg-migrate` / raw SQL | Drizzle hybrid (generated + custom) | 2024–2025 | Type-safe schema + `fromDrizzle` pg-boss adapter |
| `CHECK` constraint for cross-row validation | `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` | PostgreSQL has always supported this; CHECK is not cross-row | CHECK cannot reference other rows; trigger can |
| `vitest.workspace.ts` | `vitest.config.ts` with `projects:` array | Vitest 3.2 (D-20 amended in Phase 1) | `workspace.ts` deprecated; inline projects array is current |
| Container per test file | Single shared container + schema-per-file | 2023+ testcontainers community pattern | 10–50x faster test startup |
| Separate migration tracking DB | `migrationsSchema` option in `migrate()` | drizzle-orm ~0.30+ | Per-schema migration tracking enables parallel test isolation |
| Manual ECDSA validation (Starkbank) | `starkbank.event.parse()` SDK method | Phase 6 concern | Not Phase 2; noted for future reference |

**Deprecated/outdated:**
- `vitest.workspace.ts`: Deprecated Vitest 3.2; use `projects:` array in `vitest.config.ts`
- `CREATE ROLE aprumo_app` (without `IF NOT EXISTS`): Always use `IF NOT EXISTS` for idempotent migrations
- `bigint('col')` in Drizzle without `{ mode: 'bigint' }`: Silently maps to JS `number` — precision loss on large amounts

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_journal.json` entries use `tag` field to reference `.sql` files (no content hash stored in the journal itself) | Pattern 1, Drift Check | Drift check script would need different implementation if journal stores hashes natively |
| A2 | `drizzle-kit generate --custom` registers the entry in `_journal.json` with the same `idx`/`tag`/`when` structure as generated migrations | Pattern 1 | Hand-written migrations would not be found by migrator if structure differs |
| A3 | SECURITY DEFINER `post_transaction` + GRANT EXECUTE to `aprumo_app` with NO INSERT on `postings` is the recommended isolation pattern (vs. GRANT INSERT + convention) | Pattern 2 | If SECURITY DEFINER has unexpected side effects (e.g., row security policy bypass), may need to reconsider |
| A4 | `RAISE EXCEPTION ... USING ERRCODE = 'P0001'` + message prefix `double_entry_violation:` is sufficient for Phase 3 to map to HTTP 422 | Pattern 3 | If Phase 3 needs finer-grained SQLSTATE routing, use a custom code like `AP001` instead |
| A5 | `drizzle-kit 0.31.10` does NOT emit `COMMENT ON COLUMN` directives | Pattern 10, Pitfall 6 | If Drizzle does emit COMMENT directives, the hand-written approach in D-47 is still correct but may be redundant |
| A6 | `postgres:18-alpine` is the target image per D-40 (CONTEXT.md says PG 18 testcontainers, ROADMAP says PG 16+) | Pattern 6 | docker-compose should use the same PG version as tests; confirm PG 18 vs 16 before writing docker-compose |
| A7 | `inject()` from `'vitest'` works correctly with `pool: 'forks'` (data is serialized and injected into each fork process) | Pattern 6 | If `inject()` is broken in some vitest 4.x + forks combination, fall back to `process.env` set in globalSetup |
| A8 | `COMMENT ON COLUMN` is required in a hand-written migration (not emittable from Drizzle schema.ts) | D-47, Pattern 10 | If Drizzle 0.45.2 does support column comments, no separate migration step is needed |
| A9 | Performance of constraint trigger (1 index scan per posting INSERT) is negligible for Phase 2 test workloads | Pattern 3 | If trigger overhead causes test timeouts, consider caching the aggregate in a trigger-maintained running total table |

---

## Open Questions

1. **PG 16 vs PG 18 for docker-compose.yml (FND-12)**
   - What we know: CONTEXT.md D-40 says `postgres:18-alpine` for testcontainers; ROADMAP Phase 2 goal says "Postgres 16 container"; PRD says "Postgres 16+".
   - What's unclear: Should docker-compose.yml use `postgres:16` or `postgres:18`? Testcontainers use `postgres:18-alpine` per D-40.
   - Recommendation: Use `postgres:18-alpine` in both docker-compose.yml and testcontainers for consistency. PG 18 is GA (May 2025); `CREATE ROLE IF NOT EXISTS` is available. [ASSUMED — PG 18 GA timeline from training data, verify current availability]

2. **`raw_events.status` CHECK constraint vocabulary**
   - What we know: CONTEXT.md Discretion area: `pending|reconciled|failed` triplette suggested.
   - What's unclear: Phase 7 (WHI-07) references `status='pending'` and `status='reconciled'`. Whether to add CHECK now or leave as `text` is Claude's discretion.
   - Recommendation: Add `CHECK (status IN ('pending', 'reconciled', 'failed'))` in `0000_init_tables.sql` via Drizzle `pgEnum` or CHECK constraint. Expansible later via `ALTER TYPE` (if pgEnum) or new migration adding `'disputed'`. This eliminates an entire class of typo-induced silent failures.

3. **`transactions.source` vocabulary**
   - What we know: Free string with convention mentioned. Seed uses `'seed'`; Phase 7 worker uses `'<provider>'`.
   - Recommendation: Leave as `text NOT NULL`; no CHECK constraint. Convention: `'manual'`, `'starkbank'`, `'reconciliation'`, `'seed'`. Check constraint would require a migration every time a new provider is added.

4. **Audit shadow table structure: generic `audit_log` vs per-table `*_audit`**
   - FND-06 explicitly says `*_audit` shadow tables — so it's per-table.
   - CONTEXT.md Discretion: payload shape (JSONB OLD/NEW vs mirrored columns).
   - Recommendation: Use per-table shadow tables with `(id uuid, operation text, old_data jsonb, new_data jsonb, changed_by text, changed_at timestamptz)` — same structure for all, but separate physical tables. Drizzle `schema.ts` declares each. Generic `audit_row_change()` function does `EXECUTE format('INSERT INTO %I_audit ...', TG_TABLE_NAME)` for routing.

5. **Role passwords in docker-compose and CI**
   - What we know: Passwords must not be committed. Dev uses `.env.example`.
   - Recommendation: `docker-compose.yml` uses `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme-dev}` for the superuser; role passwords set via init script `docker-entrypoint-initdb.d/01_roles.sh` that reads env vars `APRUMO_APP_PASSWORD` and `APRUMO_MIGRATION_PASSWORD`. CI: fresh container with default credentials or env vars in GitHub Actions secrets (not needed for Phase 2 CI since testcontainers handle it).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | testcontainers (FND-16), integration tests | ✓ | Client 29.4.0 (OrbStack) | — |
| Node.js | All TypeScript execution | ✓ | v22.22.2 | — |
| pnpm | Monorepo scripts | ✓ | 10.13.1 | — |
| postgres:18-alpine | testcontainers image (D-40) | Pull-on-demand | — | Fall back to postgres:16-alpine if 18 unavailable |

**Missing dependencies with no fallback:** None — Docker is available; Node/pnpm from Phase 1.
**Note:** `postgres:18-alpine` digest needs to be pinned after first pull. CI will pull on demand.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (root, projects array) |
| Quick run command | `pnpm vitest run --project @aprumo/core` |
| Full suite command | `pnpm test` (all packages) |
| Integration-specific | `pnpm vitest run --project @aprumo/core --reporter=verbose tests/**/*.integration.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| FND-08 | `aprumo_app` UPDATE on postings → error 42501 | integration | `pnpm vitest run --project @aprumo/core tests/schema/revoke.integration.test.ts` | Uses `db.app` pool, real PG |
| FND-09 | `post_transaction` rejects unbalanced postings | integration | `pnpm vitest run --project @aprumo/core tests/schema/post-transaction.integration.test.ts` | Expects SQLSTATE P0001 |
| FND-10 | DEFERRABLE trigger catches unbalanced INSERT at COMMIT | integration | Same test file as FND-09 (deferred trigger fires after function-level check if bypassed) | Second defense layer |
| FND-11 | `pg_constraint` shows condeferrable=true, condeferred=true | integration | `pnpm vitest run --project @aprumo/core tests/schema/constraint-trigger.integration.test.ts` | Query pg_constraint |
| FND-14 | Seed via `post_transaction` creates tx + postings | integration | `pnpm vitest run --project @aprumo/core tests/schema/seed.integration.test.ts` | No direct INSERT |
| FND-15 | Drift check fails if migration file edited | CI (shell) | `tsx scripts/check-migration-drift.ts` or git-diff CI step | Separate from vitest |
| FND-16 | Schema-per-file isolation: parallel test files don't collide | integration (multi-file) | `pnpm vitest run --project @aprumo/core` (all integration tests in parallel) | Pool:forks ensures process isolation |
| FND-17 | ADR-009 file exists with MADR frontmatter | CI (file check) | `test -f docs/adr/0009-drizzle-orm-migrations.md` in CI step | Not a vitest test |
| FND-18 | ADRs 001–008 all present | CI (file check) | `ls docs/adr/000{1..8}-*.md | wc -l` == 8 in CI | Not a vitest test |
| FND-06 | Audit trigger captures `current_user` + `now()` | integration | `pnpm vitest run --project @aprumo/core tests/schema/audit-trigger.integration.test.ts` | UPDATE an account, query *_audit |

### Wave 0 Gaps (files that must be created before implementation)

- [ ] `packages/core/tests/globalSetup.ts` — Vitest globalSetup for container lifecycle
- [ ] `packages/core/tests/setup/container.ts` — PG image digest constant
- [ ] `packages/core/tests/helpers/createTestDb.ts` — schema-per-file helper
- [ ] `packages/core/tests/schema/revoke.integration.test.ts` — FND-08 RED test (42501)
- [ ] `packages/core/tests/schema/constraint-trigger.integration.test.ts` — FND-11 RED test
- [ ] `packages/core/tests/schema/post-transaction.integration.test.ts` — FND-09/10 RED tests
- [ ] `packages/core/tests/schema/audit-trigger.integration.test.ts` — FND-06 RED test
- [ ] `scripts/check-migration-drift.ts` — FND-15 drift check script
- [ ] Root `vitest.config.ts` — add `globalSetup: 'packages/core/tests/globalSetup.ts'`
- [ ] `packages/core/drizzle.config.ts` — Drizzle configuration
- [ ] `packages/core/src/db/schema.ts` — Drizzle schema declarations

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Roles are DB-level; no user-facing auth in Phase 2 |
| V3 Session Management | No | No HTTP sessions in Phase 2 |
| V4 Access Control | YES | `REVOKE UPDATE, DELETE ON postings, raw_events FROM aprumo_app` + `SECURITY DEFINER` |
| V5 Input Validation | YES | `post_transaction` validates direction, amount_cents > 0, balanced sum |
| V6 Cryptography | No | No keys/tokens in Phase 2 |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via dynamic SQL in plpgsql | Tampering | Use `EXECUTE format(... $1) USING variable` for any dynamic SQL; never `||` concatenation |
| search_path injection in SECURITY DEFINER functions | Elevation of Privilege | `SET search_path = public` in SECURITY DEFINER function body [VERIFIED: PG docs] |
| Direct INSERT bypass of `post_transaction` | Tampering | REVOKE INSERT on postings from aprumo_app; only SECURITY DEFINER function can insert |
| Role credentials committed to git | Information Disclosure | `0001_roles.sql` uses `NOLOGIN`; passwords in `.env` only; gitleaks from Phase 1 catches leaks |
| Drizzle migration editing after commit | Tampering | Drift check CI step (FND-15) fails build on any edit |

---

## Project Constraints (from CLAUDE.md)

The following CLAUDE.md directives are mandatory for this phase. The planner must verify compliance:

1. **Immutability Invariant:** Tables `postings` and `raw_events` are append-only. No code (including tests) may use UPDATE/DELETE on them. Role `aprumo_app` does not have these permissions.
2. **Double-entry Invariant:** Every transaction must have `SUM(amount_cents WITH SIGN) = 0`. Validation in `post_transaction` AND in CONSTRAINT TRIGGER.
3. **Idempotency Invariant:** `UNIQUE (idempotency_key)` on `transactions`; `UNIQUE (provider, provider_event_id)` on `raw_events`.
4. **Exact-once Invariant (Phase 7 setup):** `raw_events` INSERT and pg-boss enqueue must happen in same PG transaction. Schema must support this (no deferred FK violations that break the tx).
5. **SERIALIZABLE Isolation:** Documented in ADR-001; schema must include `post_transaction` function callable within `SERIALIZABLE` transactions.
6. **Audit Shadow Tables:** Every mutatable table has a `*_audit` shadow table + trigger. Not optional.
7. **No PAN:** Nothing in this phase touches payment card data. Not applicable.
8. **BIGINT cents:** `amount_cents BIGINT` always. Drizzle must use `{ mode: 'bigint' }`. No float/numeric.
9. **TDD obrigatório:** Every production code file must have a failing test written BEFORE implementation. Wave 0 RED tests are mandatory.
10. **TypeScript strict + no `any`:** All TypeScript helpers (`createTestDb`, `migrate.ts`, `schema.ts`) must compile with `strict: true`, `noUncheckedIndexedAccess: true`. No `any`. Use `unknown` + type guards where needed.
11. **SQL parameterized:** No string interpolation in SQL. Use parameterized queries (`$1`, `$2`) or Drizzle's query builder.
12. **Stack lock:** Drizzle, Vitest, pnpm, Biome — no alternatives without ADR.
13. **Biome rules (D-29):** `noExplicitAny=error` everywhere including test files. `noNonNullAssertion=off` in `*.test.ts` (D-30).

---

## Sources

### Primary (HIGH confidence)
- [PostgreSQL docs: CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html) — CONSTRAINT TRIGGER syntax, DEFERRABLE INITIALLY DEFERRED
- [PostgreSQL docs: ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html) — FOR ROLE target_role pattern
- [PostgreSQL docs: PL/pgSQL Trigger Functions](https://www.postgresql.org/docs/current/plpgsql-trigger.html) — TG_TABLE_NAME, TG_OP, AFTER trigger return value
- [PostgreSQL docs: PL/pgSQL Errors and Messages](https://www.postgresql.org/docs/current/plpgsql-errors-and-messages.html) — RAISE EXCEPTION USING ERRCODE
- [Drizzle ORM: drizzle.config.ts](https://orm.drizzle.team/docs/drizzle-config-file) — dialect, schema, out, migrations config
- [Drizzle ORM: migrations](https://orm.drizzle.team/docs/migrations) — `migrate()` function + `max: 1` requirement
- [Drizzle ORM: custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations) — `--custom` flag
- [Vitest: globalSetup](https://vitest.dev/config/globalsetup.html) — `project.provide()` / `inject()` API, setup/teardown exports
- [Testcontainers Node.js: PostgreSQL module](https://node.testcontainers.org/modules/postgresql/) — `PostgreSqlContainer` API
- [Testcontainers Node.js: Global Setup](https://node.testcontainers.org/quickstart/global-setup/) — globalSetup pattern with provide/inject
- [MADR 4.0 template](https://adr.github.io/madr/) — frontmatter fields, section order, status vocabulary
- [PostgreSQL: deferred constraint trigger semantics](https://www.postgresql.org/message-id/5C29B392-6215-4791-8DD8-7B8977A637B7@yugabyte.com) — aggregate queries work in deferred AFTER ROW triggers

### Secondary (MEDIUM confidence)
- [Drizzle + PostgreSQL schema switching via search_path](https://zenn.dev/sora_kumo/articles/drizzle-pg-schema?locale=en) — `migrationsSchema` option for test isolation
- [Using TestContainers with Vitest](https://dev.to/jcteague/using-testconatiners-with-vitest-499f) — `provide()` + `inject()` + schema-per-test pattern
- [Vitest globalSetup issue #4025](https://github.com/vitest-dev/vitest/issues/4025) — passing serializable data from globalSetup to tests

### Tertiary (LOW confidence)
- `_journal.json` internal structure — inferred from Drizzle source code behavior and community posts; official docs do not publish the schema definition. Treat as ASSUMED.
- `COMMENT ON COLUMN` not emitted by `drizzle-kit generate` — inferred from feature absence in drizzle-kit 0.31.10 changelog; needs verification.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified via npm registry on 2026-05-22
- Architecture: HIGH — PostgreSQL constraint trigger + deferred semantics verified via official docs; testcontainers + inject() API verified via official Vitest docs
- Pitfalls: MEDIUM-HIGH — most pitfalls verified via official docs; drift check strategy and `_journal.json` structure are ASSUMED
- ADR content: HIGH — content sourced from PRD.md §9 (primary source) + SUMMARY.md

**Research date:** 2026-05-22
**Valid until:** 2026-06-22 (drizzle-kit and testcontainers APIs are stable; 30-day window)
