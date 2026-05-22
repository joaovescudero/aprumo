# Phase 2: Schema Foundation + DB Tooling — Discussion Log

**Date:** 2026-05-22
**Mode:** discuss (default), 4 areas

---

## Area Selection

**Question:** Which gray areas to discuss for Phase 2 (Domain: pnpm db:migrate + ledger tables + 3-layer immutability + testcontainers + ADRs 001–009)?

**Options presented:**
1. Drizzle ↔ raw SQL boundary
2. Testcontainers strategy
3. ADR back-port scope (001–009)
4. pending_balance reservation

**Selected:** All 4.

---

## Area 1: Drizzle ↔ raw SQL boundary

### Q1.1 — Migration shape (table-modeling vs hand-written for unsupported features)

**Options:**
- (a) Drizzle TS for tables, hand-written .sql for the rest **(Recommended)**
- (b) All hand-written .sql, Drizzle only as runner
- (c) Drizzle TS schema + sql.raw() for triggers/functions

**Selected:** (a). Drizzle handles tables/FKs/indexes via schema.ts; hand-written .sql in same migrations dir for roles, grants, functions, triggers; all registered in `_journal.json` via `drizzle-kit generate --custom`.

### Q1.2 — Migration ordering

**Options:**
- (a) Numbered prefix, single linear sequence **(Recommended)**
- (b) Grouped by concern, phase-prefixed folders
- (c) Idempotent CREATE OR REPLACE in single bootstrap.sql

**Selected:** (a). `0000_init_tables` → `0001_roles` → `0002_grants` → `0003_post_transaction` → `0004_double_entry_trigger` → `0005_audit_triggers` → `0006_seed_dev`.

### Q1.3 — Drift check (FND-15 enforcement)

**Options:**
- (a) Hash committed `_journal.json` in repo; CI re-hashes and diffs **(Recommended)**
- (b) PG-side check via `__drizzle_migrations` table after migrate
- (c) Both (defence in depth)

**Selected:** (a). Single-layer drift check via `_journal.json` byte diff. PG-side rejected as overhead without real gain.

### Q1.4 — Monorepo location

**Options:**
- (a) packages/core/migrations/ + packages/core/drizzle.config.ts **(Recommended)**
- (b) Top-level db/ directory + root drizzle.config.ts
- (c) Separate @aprumo/db package

**Selected:** (a). All migrations + schema.ts + drizzle.config.ts inside @aprumo/core; root scripts delegate via `pnpm --filter @aprumo/core`.

---

## Area 2: Testcontainers strategy

### Q2.1 — Schema isolation mechanism

**Options:**
- (a) Schema name = sanitized test file path, created in setup hook **(Recommended)**
- (b) Schema name = random UUID per test file run
- (c) Template database (CREATE DATABASE ... TEMPLATE)

**Selected:** (a). `schema_name = 'test_' + sha1(testPath).slice(0,12)`. Deterministic, parallelizable, leverages vitest pool:'forks' (one process per file).

### Q2.2 — Migration speed strategy

**Options:**
- (a) Just run migrations per schema, accept the cost **(Recommended)**
- (b) Cache migrated state via pg_dump/pg_restore per schema
- (c) Schemas accumulate, never DROP

**Selected:** (a). Re-apply migrations per schema; revisit caching only if suite exceeds 30s on migrations alone.

### Q2.3 — Role pool exposure in tests

**Options:**
- (a) Helper returns two pools: appPool + migrationPool, both pointed at test schema **(Recommended)**
- (b) Single superuser pool; use `SET ROLE`
- (c) App pool only; spawn migration pool ad-hoc

**Selected:** (a). Helper exposes `{ app, migration, schema, cleanup }`. FND-08 test uses app pool to assert 42501 on UPDATE.

### Q2.4 — PG image pinning

**Options:**
- (a) `postgres:18-alpine` (user-edited from 16-alpine) pinned by digest **(Recommended)**
- (b) Tag-only pin
- (c) `.withReuse()` always on

**Selected:** (a). User upgraded image tag to `postgres:18-alpine` during review. Digest pinned in tests/setup/container.ts. `.withReuse()` opt-in via env var for local dev.

---

## Area 3: ADR back-port scope (001–009)

### Q3.1 — Depth of expansion

**Options:**
- (a) Faithful expansion: 1–2 paragraphs per section, no new claims **(Recommended)**
- (b) Minimal MADR: only mandatory fields
- (c) Full deep-dive: re-investigate each decision

**Selected:** (a). ~1 page per ADR, content from PRD §9 + research/SUMMARY.md + CLAUDE.md, alternatives from PRD.

### Q3.2 — ADR count

**Options:**
- (a) 001–009 only — capture Phase 2 implementation in CONTEXT.md **(Recommended)**
- (b) Add ADR-010 (testcontainers) + ADR-011 (deferred trigger)
- (c) Add ADR-010 only (deferred trigger)

**Selected:** (a). Implementation details stay in CONTEXT.md/PLAN to avoid ADR sprawl. Reserve ADRs for cross-phase architectural decisions.

### Q3.3 — File layout + tooling

**Options:**
- (a) MADR 4.0 + adr-tools naming + index README.md **(Recommended)**
- (b) MADR 4.0 + log4brains web viewer
- (c) MADR 4.0, no index, lexicographic

**Selected:** (a). Files like `0001-postgres-as-ledger-engine.md`; hand-maintained index at `docs/adr/README.md`. No CLI dep.

### Q3.4 — Status semantics for back-fill

**Options:**
- (a) Status: Accepted, dual date fields (decided + documented) **(Recommended)**
- (b) Single Date: 2026-05-22
- (c) Status: 'Accepted (back-filled from PRD)'

**Selected:** (a). `decided: 2026-05-18` for 001–008, `decided: 2026-05-22` for 009; `documented: 2026-05-22` for all. Honest dating without inventing retroactive process.

---

## Area 4: pending_balance reservation (STATE.md blocker resolution)

### Q4.1 — Which columns to reserve in account_balance

**Options:**
- (a) Reserve `pending_balance` + `available_balance` as nullable BIGINT now **(Recommended)**
- (b) Reserve `pending_balance` only
- (c) Don't reserve — add when v0.5 needs

**Selected:** (a). Both reserved as nullable BIGINT, NULL in v0.1, populated by v0.5 worker. Resolves STATE.md blocker.

### Q4.2 — Other v0.5 fields to reserve

**Options:**
- (a) Just pending_balance + available_balance, nothing else **(Recommended)**
- (b) Also reserve `transactions.parent_transaction_id`
- (c) Also reserve dispute thread FKs

**Selected:** (a). Future v0.5 features (split, dispute, MIT) need new tables, not new columns on hot tables.

### Q4.3 — Documentation pattern

**Options:**
- (a) `COMMENT ON COLUMN` + migration header comment + ADR-009 note **(Recommended)**
- (b) Just `COMMENT ON COLUMN`
- (c) Plus `docs/schema-reservations.md`

**Selected:** (a). Triple-link in code: PG comment (visible in psql `\d+`), migration header block, ADR-009 reservation pattern paragraph.

---

## Deferred Ideas Captured

(see CONTEXT.md `<deferred>` section)

- Template-DB caching for testcontainers
- `available_balance` worker logic (v0.5)
- `splits`, `disputes`, `payment_methods` tables (v0.5)
- PG-side migration drift check
- adr-tools CLI / log4brains
- Down migrations (forward-only convention)
- `SET ROLE` test pattern (rejected)

## Claude's Discretion

(see CONTEXT.md `<decisions>` § Claude's Discretion — planner decides)

- CONSTRAINT TRIGGER exact schema + error message format
- `post_transaction(postings[])` internal signature
- Audit trigger function shape (generic vs per-table)
- `raw_events.status` vocabulary
- `transactions.source` vocabulary
- Dev/CI role password management strategy

---

*Phase: 2 — Schema Foundation + DB Tooling*
*Discussion logged: 2026-05-22*
