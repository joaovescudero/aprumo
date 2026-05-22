---
status: "Accepted"
date: "2026-05-22"
decision-makers: "Joao Escudero"
---

# ADR-009: Drizzle ORM + Hybrid Migration Strategy

> **Note on dating:** This decision was made during Phase 2 implementation planning (2026-05-22). Unlike ADRs 001–008 which were back-filled from PRD.md §9, this ADR documents a net-new decision made in this phase. The `date` field reflects the actual decision date.

## Context and Problem Statement

Aprumo needs a migration strategy for the Postgres schema. The requirements are unusually demanding for a financial ledger:

1. **TypeScript schema as source-of-truth**: table definitions, column types, foreign keys, check constraints, and indexes should be declared in TypeScript and generate SQL — not written by hand and re-declared in TypeScript separately.
2. **Hand-written SQL for unsupported features**: Drizzle (or any ORM) cannot generate `CREATE ROLE`, `GRANT`/`REVOKE`, plpgsql functions, `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`, or audit triggers. These must be hand-written SQL.
3. **Programmatic migrate() for test isolation**: each test file needs to run migrations against its own schema (schema-per-file isolation pattern). This requires a programmatic `migrate()` call, not a CLI-only tool.
4. **Single migration registry**: hand-written and generated migrations must be tracked in one canonical `_journal.json` — no separate tracking for the two types.
5. **Forward-only migrations**: no rollback. Rollback is a new forward migration that undoes the change. This is the ledger convention.
6. **ESM-native**: the monorepo uses `"type": "module"`. The migration tool and driver must be ESM-native or have a clean ESM compatibility story.
7. **Drizzle `fromDrizzle` adapter**: pg-boss v12 requires the `fromDrizzle(tx, sql)` adapter to participate in a Drizzle transaction. This makes `drizzle-orm` a runtime dependency regardless of which migration tool is used — so Drizzle is effectively in the stack for the query builder.

The decision is: **which migration tool + ORM combination serves as the schema management layer for Aprumo?**

## Decision Drivers

* **`fromDrizzle` adapter requirement**: pg-boss v12 requires `fromDrizzle(tx, sql)` from `drizzle-orm`. This makes Drizzle a runtime dependency for the exact-once webhook guarantee (ADR-003). Using a different migration tool would mean maintaining both Drizzle (for pg-boss adapter) and another tool (for migrations) — an unnecessary split.
* **Hybrid migration support**: `drizzle-kit generate --custom --name=<slug>` scaffolds an empty `.sql` file and registers it in `meta/_journal.json`. This is the official Drizzle mechanism for hand-written SQL migrations that participate in the same journal as generated migrations.
* **Programmatic `migrate()` for testcontainers**: `drizzle-orm/postgres-js/migrator` exposes `migrate(db, { migrationsFolder })` for programmatic execution. This enables the schema-per-file test isolation pattern (create schema, run migrations, run tests, drop schema).
* **ESM-native**: Drizzle + `postgres` (postgres-js) are ESM-native. `node-pg-migrate` has CommonJS roots with a less clean ESM story.
* **`noUncheckedIndexedAccess` compatibility**: Drizzle query results are typed arrays. `result[0]` requires a null check. Drizzle's TypeScript types are accurate and compatible with `strict: true` + `noUncheckedIndexedAccess: true`.
* **Not an ORM in the traditional sense**: Drizzle is a query builder with a thin type layer. It does not impose Active Record / Data Mapper patterns. SQL remains explicit and readable, which is correct for a financial ledger where SQL clarity is a safety requirement.
* **Forward-only convention**: Drizzle Kit does not enforce rollback migrations. The forward-only convention is enforced by project convention (no `down` migrations written), not by tooling.
* **max:1 connection requirement**: `migrate()` requires the postgres-js connection to be initialized with `{ max: 1 }`. This is a documented Drizzle constraint — the migrator uses a single connection and does not work with a pool.

## Considered Options

* **Option A: Drizzle ORM + drizzle-kit (hybrid — generated + hand-written SQL)** (chosen)
* **Option B: node-pg-migrate (pure hand-written SQL)**
* **Option C: Flyway (Java-based, language-agnostic migration runner)**

## Decision Outcome

**Chosen option: Option A — Drizzle ORM (`drizzle-orm` 0.45.2) + Drizzle Kit (`drizzle-kit` 0.31.10) with the hybrid migration strategy.**

Migration sequence:
1. `0000_init_tables.sql` — Drizzle-generated from `schema.ts` (`drizzle-kit generate`).
2. `0001_roles.sql` — hand-written (`CREATE ROLE aprumo_app`, `CREATE ROLE aprumo_migration`).
3. `0002_grants.sql` — hand-written (`GRANT SELECT, INSERT ... TO aprumo_app`; `REVOKE UPDATE, DELETE ON postings, raw_events FROM aprumo_app`; default privileges).
4. `0003_post_transaction.sql` — hand-written (`post_transaction(postings[])` plpgsql SECURITY DEFINER function).
5. `0004_double_entry_trigger.sql` — hand-written (`CONSTRAINT TRIGGER assert_double_entry ... DEFERRABLE INITIALLY DEFERRED`).
6. `0005_audit_triggers.sql` — hand-written (generic `audit_row_change()` + per-table triggers).
7. `0006_seed_dev.sql` — hand-written (dev-only; NOT run by `db:migrate` in production).

All migrations registered in `packages/core/migrations/meta/_journal.json` via `drizzle-kit generate --custom`.

### Reservation pattern (D-47)

The `account_balance` table in `0000_init_tables.sql` declares two reserved columns for v0.5:

```sql
pending_balance   BIGINT NULL,
available_balance BIGINT NULL,
```

These columns are annotated with `COMMENT ON COLUMN` statements in `0000_init_tables.sql`:

```sql
COMMENT ON COLUMN account_balance.pending_balance IS
  'Reserved for v0.5 pending balance tracking; NULL in v0.1. '
  'Populated by v0.5 balance worker using pending postings.';

COMMENT ON COLUMN account_balance.available_balance IS
  'Reserved for v0.5 available balance tracking; NULL in v0.1. '
  'Computed as balance - pending_balance by v0.5 worker.';
```

The v0.1 balance worker writes only `balance` and `last_posting_id`. The reserved columns remain `NULL` until the v0.5 worker populates them.

**Rationale for reservation**: adding `pending_balance` and `available_balance` as new columns via `ALTER TABLE ADD COLUMN` during a v0.1 → v0.5 upgrade would require a table rewrite on design partners with millions of `account_balance` rows. Reserving the columns in v0.1 (cost: 16 bytes per row, NULL storage) avoids this hot-table migration. The columns are also declared in `drizzle`'s `schema.ts` with `.$type<bigint | null>()` to maintain TypeScript source-of-truth.

### Consequences

**Good:**
* `schema.ts` is the single source of truth for table structure. TypeScript types are derived from the schema declaration, not hand-maintained.
* Hand-written migrations for plpgsql functions, CONSTRAINT TRIGGERs, GRANT/REVOKE are registered in the same `_journal.json` as generated migrations — single migration runner, single journal.
* Programmatic `migrate()` enables schema-per-file test isolation with testcontainers.
* Drizzle query builder co-located with migrations avoids maintaining two separate libraries.
* `fromDrizzle(tx, sql)` adapter for pg-boss is a first-class feature of the chosen tool.
* ESM-native — no CommonJS interop shims required.

**Bad:**
* `migrate()` requires `{ max: 1 }` on the postgres-js connection — cannot reuse an existing pool. Test helpers must create a dedicated migration connection.
* Forward-only migrations only (by convention). No `down` migrations. Rollback requires writing a compensating forward migration.
* Drizzle Kit's `--custom` flag for hand-written migrations is not a widely known workflow. Contributors must read the CONTRIBUTING guide to understand the hybrid pattern.
* `drizzle-kit` version pinning is important — `drizzle-kit` and `drizzle-orm` have tightly coupled version semantics.

## Pros and Cons of the Options

### Option A: Drizzle ORM + drizzle-kit (hybrid)

**Pros:**
- `fromDrizzle` adapter is first-class — exact-once pg-boss guarantee is achievable.
- `drizzle-kit generate --custom` for hand-written migrations participating in `_journal.json`.
- Programmatic `migrate()` for test isolation.
- TypeScript schema-as-code source-of-truth.
- ESM-native.

**Cons:**
- `migrate()` requires `{ max: 1 }` dedicated connection.
- Forward-only by convention (no tooling enforcement).
- `--custom` workflow is non-obvious for new contributors.

### Option B: node-pg-migrate

node-pg-migrate is a mature, pure SQL migration tool for Node.js.

**Why node-pg-migrate was not chosen:**
- No TypeScript schema-as-code: table types must be maintained separately in TypeScript, creating schema drift risk.
- No `fromDrizzle` adapter: would require using `drizzle-orm` for the pg-boss adapter anyway, resulting in two tools for the same responsibility.
- CommonJS origins with mixed ESM support — more complex setup in an ESM-native monorepo.
- Supports rollback (down migrations) — not a feature Aprumo uses (forward-only convention), but adds cognitive overhead.

### Option C: Flyway

Flyway is a widely used, JVM-based migration runner that is language-agnostic (SQL-first).

**Why Flyway was not chosen:**
- Java/JVM runtime dependency in a pure Node.js monorepo. Adds a JVM installation requirement for all contributors and CI.
- No TypeScript schema-as-code integration.
- No `fromDrizzle` adapter — same split as node-pg-migrate.
- Programmatic migration runner (for testcontainers) requires calling Flyway CLI from Node.js subprocess — awkward and slow.
- Adds infrastructure complexity for what is solvable entirely in TypeScript.

## More Information

* [Drizzle custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)
* [Drizzle `_journal.json` structure](https://orm.drizzle.team/docs/kit-overview#migrations-folder)
* [Drizzle programmatic migrator](https://orm.drizzle.team/docs/migrations)
* [pg-boss `fromDrizzle` adapter](https://github.com/timgit/pg-boss/blob/master/docs/readme.md#transact)
* Drizzle ORM version: 0.45.2. Drizzle Kit version: 0.31.10.
* `postgres` (postgres-js) driver: 3.4.9 — required by Drizzle postgres-js adapter.
* Migration folder: `packages/core/migrations/`. Drizzle config: `packages/core/drizzle.config.ts`.
* CI drift check: re-hashes each `.sql` file in `migrations/` and diffs byte-by-byte against `_journal.json`. Any edit to an applied migration fails CI (FND-15).
* See ADR-001 for Postgres selection. See ADR-003 for pg-boss exact-once rationale (requires `fromDrizzle`).
