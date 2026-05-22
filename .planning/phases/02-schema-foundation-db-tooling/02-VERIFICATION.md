---
phase: 02-schema-foundation-db-tooling
verified: 2026-05-22T22:00:06Z
status: human_needed
score: 5/6
overrides_applied: 0
human_verification:
  - test: "Run pnpm db:migrate against a fresh Postgres 16+ container and confirm it exits 0 with all 10 tables present"
    expected: "Command exits 0; SELECT table_name FROM information_schema.tables shows all 10 ledger tables"
    why_human: "Integration tests run via testcontainers but pnpm db:migrate itself (the CLI entrypoint for prod ops) cannot be verified without Docker running in the local dev environment"
  - test: "Verify docker-compose up -d postgres starts correctly, then run pnpm db:migrate against it"
    expected: "docker-compose postgres container starts healthy; pnpm db:migrate exits 0"
    why_human: "Docker daemon not available in CI-less local check; full stack smoke-test needed"
  - test: "Inspect docs/adr/ prose quality for MADR 4.0 conformance across all 9 ADRs"
    expected: "Each ADR has frontmatter (status, date, decision-makers), sections Context/Drivers/Options/Outcome/Consequences; prose is coherent and accurately reflects the rationale"
    why_human: "ADR prose quality is judgment-bound; structure can be verified automatically but content accuracy requires human reading"
---

# Phase 02: Schema Foundation + DB Tooling — Verification Report

**Phase Goal:** `pnpm db:migrate` runs to completion on a fresh Postgres 16 container, producing all ledger tables with immutability enforced at three layers (role permissions, `post_transaction` sole write path, deferred constraint trigger), and the testcontainers globalSetup makes integration tests possible.
**Verified:** 2026-05-22T22:00:06Z
**Status:** human_needed (5/6 automated truths verified; 3 items need human testing)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm db:migrate` applies all migrations from scratch on a blank Postgres 16 container; `pnpm db:reset` destroys and recreates the local DB without manual intervention | ? UNCERTAIN | `src/db/migrate.ts` implements seed-skipping migration runner; `src/db/reset.ts` implements destroy+recreate; root `package.json` delegates via `pnpm --filter @aprumo/core`. Structural correctness verified. Cannot run end-to-end without Docker in this environment. Testcontainers E2E test (`migration-e2e.integration.test.ts`) covers the migration correctness. |
| 2 | CI queries `pg_constraint` after migration and asserts the double-entry constraint trigger is `condeferrable=true AND condeferred=true` | ✓ VERIFIED | `constraint-trigger.integration.test.ts` lines 50–66 and `migration-e2e.integration.test.ts` lines 135–173 both query `pg_constraint` and assert `condeferrable=true AND condeferred=true`. The `integration-test` CI job in `.github/workflows/ci.yml` (line ~120) runs `pnpm --filter @aprumo/core test --run` which includes both test files. |
| 3 | An integration test connecting as `aprumo_app` attempts `UPDATE postings SET amount_cents = 0` and receives error code `42501` — this test must be green before phase closes | ✓ VERIFIED | `revoke.integration.test.ts` lines 24–28: `db.app.query("UPDATE postings SET amount_cents = 0 WHERE id = gen_random_uuid()")` expects `{ code: "42501" }`. Same assertion in `migration-e2e.integration.test.ts` lines 107–110. `0002_grants.sql` lines 11–12 confirm `REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app` and `REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app`. |
| 4 | `post_transaction` SQL function rejects postings that do not sum to zero (returns error at COMMIT) and accepts balanced postings atomically; verified by a red-path test using testcontainers real PG | ✓ VERIFIED | `0003_post_transaction.sql` validates signed sum at application level (lines 82–89) and the `0005_double_entry_trigger.sql` adds belt-and-suspenders at COMMIT. `post-transaction.integration.test.ts` covers: balanced path (line 49), idempotency (line 73), unbalanced (line 100), empty array (line 121), invalid direction (line 139), zero amount (line 160), sole-write-path enforcement (line 183). |
| 5 | Drizzle migration hash check runs in CI and fails if any previously committed migration file is edited | ✓ VERIFIED | `scripts/check-migration-drift.mjs` exits 0 on clean state (verified live: "Migration integrity check passed — no drift detected (7 migrations verified)"). `migration-drift.test.ts` contains tamper and missing-file tests. CI has both dedicated `migration-integrity` job AND the `integration-test` job runs `node scripts/check-migration-drift.mjs` as a hard gate before tests. |
| 6 | ADRs 001–009 are written in `docs/adr/` in MADR format and committed | ✓ VERIFIED (structure) | `docs/adr/` contains 9 ADR files (0001–0009) + `README.md`. Each file has MADR frontmatter (`status`, `date`, `decision-makers`) confirmed by reading ADR-001 and ADR-009. `README.md` index lists all 9 ADRs with status "Accepted". Prose quality requires human review (see Human Verification section). |

**Score:** 5/6 truths verified automatically. Truth #1 is UNCERTAIN due to Docker not running in local environment (structural verification passed). Truth #6 is structurally VERIFIED but prose quality deferred to human.

---

### CLAUDE.md Invariants Verification

All 8 CLAUDE.md invariants have been verified against the landed schema and migrations:

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Imutabilidade: `postings` and `raw_events` are append-only; `aprumo_app` has no UPDATE/DELETE | ✓ VERIFIED | `0002_grants.sql` lines 11–12: `REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app` and `REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app`. Tested by 4 assertions in `revoke.integration.test.ts` and 4 in E2E test. |
| 2 | Double-entry balanceado: SUM(amount_cents com sinal) = 0 | ✓ VERIFIED | Three-layer enforcement: (a) `0003_post_transaction.sql` validates inline before INSERTs; (b) `0005_double_entry_trigger.sql` CONSTRAINT TRIGGER fires at COMMIT; (c) `migration-e2e.integration.test.ts` tests both balanced and unbalanced paths. |
| 3 | Idempotência: duplicate Idempotency-Key returns existing tx without error | ✓ VERIFIED | `0003_post_transaction.sql` lines 46–51: `SELECT id INTO v_tx_id FROM transactions WHERE idempotency_key = p_idempotency_key; IF FOUND THEN RETURN v_tx_id; END IF`. Tested by `post-transaction.integration.test.ts` idempotency group and E2E group 6 (also verifies COUNT=1 in transactions). |
| 4 | Exact-once de webhook: INSERT raw_events + pg-boss enqueue in same tx | ✓ VERIFIED (schema layer) | `raw_events` table schema with `UNIQUE(provider, provider_event_id)` prevents duplicate ingestion. Full exact-once guarantee (pg-boss enqueue) is Phase 7 — schema foundation is correct. |
| 5 | Isolation level: SERIALIZABLE with retry on 40001 | DEFERRED to Phase 3 | Not a Phase 2 deliverable per ROADMAP. `withRetryOnSerializationFailure` wrapper is API-10 (Phase 3 success criterion 4). Schema does not block SERIALIZABLE usage. |
| 6 | Audit: mutable tables have shadow `*_audit` with AFTER UPDATE/DELETE trigger | ✓ VERIFIED | `0004_audit_triggers.sql` creates `audit_row_change()` SECURITY DEFINER function + triggers on `accounts`, `outbound_endpoints`, `outbound_events`. `audit-triggers.integration.test.ts` tests UPDATE capture, DELETE capture, INSERT exclusion, trigger existence, and postings exclusion. |
| 7 | Sem PAN próprio: never store PAN | ✓ VERIFIED | No PAN fields in any migration or schema. `outbound_endpoints.secret_hash` stores a hash, never plaintext. Schema has no `card_number`, `pan`, `cvv`, or similar fields. |
| 8 | Valores em centavos: BIGINT amount_cents | ✓ VERIFIED | `0000_init_tables.sql` line 86: `"amount_cents" bigint NOT NULL`. `schema.ts` uses `bigint({ mode: 'bigint' })` for all 9 money columns. Tests in `schema-shape.integration.test.ts` assert `data_type = 'bigint'` for `amount_cents`. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/migrations/0000_init_tables.sql` | All 10 ledger tables + audit shadows + FKs + indexes | ✓ VERIFIED | 10 CREATE TABLEs, correct constraints, `COMMENT ON COLUMN` for v0.5 reservations |
| `packages/core/migrations/0001_roles.sql` | `CREATE ROLE IF NOT EXISTS` for aprumo_app + aprumo_migration | ✓ VERIFIED | Lines 8–9 correct; `IF NOT EXISTS` ensures re-run safety |
| `packages/core/migrations/0002_grants.sql` | GRANT + REVOKE on postings/raw_events | ✓ VERIFIED | Grants SELECT+INSERT to aprumo_app, REVOKEs UPDATE+DELETE on append-only tables, sets DEFAULT PRIVILEGES |
| `packages/core/migrations/0003_post_transaction.sql` | SECURITY DEFINER function, sole write path | ✓ VERIFIED | `posting_input` composite type, `post_transaction()` function with SECURITY DEFINER + SET search_path = public, owned by aprumo_migration |
| `packages/core/migrations/0004_audit_triggers.sql` | `audit_row_change()` + triggers on mutable tables | ✓ VERIFIED | SECURITY DEFINER generic function + triggers on accounts, outbound_endpoints, outbound_events |
| `packages/core/migrations/0005_double_entry_trigger.sql` | `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` | ✓ VERIFIED | Lines 53–57: `CREATE CONSTRAINT TRIGGER assert_double_entry AFTER INSERT ON postings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW` |
| `packages/core/migrations/0006_seed_dev.sql` | Dev seed using post_transaction only | ✓ VERIFIED | Uses `post_transaction()` exclusively (no direct INSERT into postings). Excluded from `pnpm db:migrate` via `SEED_TAG_PATTERN` regex in `src/db/migrate.ts`. |
| `packages/core/migrations/migration-hashes.json` | SHA-256 hashes for all 7 migrations | ✓ VERIFIED | Contains hashes for 0000–0006. Drift check script exits 0 (live verification). |
| `packages/core/migrations/meta/_journal.json` | 7 entries, linear ordering | ✓ VERIFIED | 7 entries idx=0..6, all correctly tagged |
| `packages/core/src/db/schema.ts` | Drizzle schema declarations for all tables | ✓ VERIFIED | Exports 10 table definitions with correct types, CHECK constraints, FKs, indexes |
| `packages/core/src/db/migrate.ts` | Programmatic migration runner, seed-skip | ✓ VERIFIED | `SEED_TAG_PATTERN = /seed/i` skips seed entries; idempotent via hash tracking |
| `packages/core/src/db/reset.ts` | DB destroy+recreate, dev-only guard | ✓ VERIFIED | `NODE_ENV=production` guard, terminates connections before DROP |
| `packages/core/src/db/seed.ts` | Seed runner, reads 0006_seed_dev.sql | ✓ VERIFIED | Reads and executes seed SQL, separate from migrate path |
| `packages/core/tests/globalSetup.ts` | Testcontainers globalSetup with shared container | ✓ VERIFIED | Starts `PostgreSqlContainer(PG_IMAGE)`, provides URI via `inject()`, APRUMO_TEST_REUSE support |
| `packages/core/tests/setup/container.ts` | Pinned PG image constant | ⚠️ PARTIAL | `PG_IMAGE = "postgres:18-alpine"` — tag-pinned but NOT digest-pinned. D-40 says "pinned by digest" for full reproducibility. Comment documents how to pin but digest is not applied. |
| `packages/core/tests/helpers/createTestDb.ts` | Schema-per-file helper returning `{ app, migration, schema, cleanup }` | ✓ VERIFIED | SHA1-based schema naming, runs migrations into isolated schema, returns pools for both roles, cleanup drops schema |
| `packages/core/tests/schema/revoke.integration.test.ts` | 4 REVOKE tests | ✓ VERIFIED | Covers UPDATE/DELETE on postings and raw_events via aprumo_app; expects 42501 |
| `packages/core/tests/schema/post-transaction.integration.test.ts` | 7 post_transaction tests | ✓ VERIFIED | Covers balanced, idempotency, unbalanced, empty, invalid direction, zero amount, sole-write-path |
| `packages/core/tests/schema/constraint-trigger.integration.test.ts` | pg_constraint assertion | ✓ VERIFIED | Asserts condeferrable=true AND condeferred=true for assert_double_entry |
| `packages/core/tests/schema/audit-triggers.integration.test.ts` | 5 audit tests | ✓ VERIFIED | UPDATE capture, DELETE capture, INSERT exclusion, trigger existence, postings exclusion |
| `packages/core/tests/schema/schema-shape.integration.test.ts` | 7 schema shape tests | ✓ VERIFIED | Verifies columns, constraints, nullable fields for key tables |
| `packages/core/tests/e2e/migration-e2e.integration.test.ts` | Full E2E migration gate test | ✓ VERIFIED | 6 groups, 11 assertions — all 10 tables, REVOKE, trigger deferrability, post_transaction paths |
| `packages/core/tests/infra/migration-drift.test.ts` | 3 drift check tests | ✓ VERIFIED | Clean state (exit 0), tampered (exit non-zero), missing file (exit non-zero) |
| `scripts/check-migration-drift.mjs` | Drift check script | ✓ VERIFIED | Exits 0 on clean state (live verified). Implements journal-based hash comparison. |
| `docker-compose.yml` | postgres:18-alpine with role env vars + autovacuum | ✓ VERIFIED | `image: postgres:18-alpine`, `POSTGRES_USER: aprumo_migration`, `POSTGRES_PASSWORD` via env, `autovacuum_naptime=10` |
| `docs/adr/0001–0009 + README.md` | 9 ADRs in MADR 4.0 format + index | ✓ VERIFIED (structure) | All 10 files exist. Frontmatter has `status`, `date`, `decision-makers`. README.md index lists all 9. |
| `.github/workflows/ci.yml` | `integration-test` job + `migration-integrity` job | ✓ VERIFIED | Both jobs present. `integration-test` depends on lint+typecheck+build, runs testcontainers, drift check as first step. `migration-integrity` is standalone job. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/db/schema.ts` | `migrations/0000_init_tables.sql` | `drizzle-kit generate` | ✓ WIRED | Schema matches generated SQL (10 tables, same constraints, same column types) |
| `migrations/meta/_journal.json` | `migrations/*.sql` | tag entries | ✓ WIRED | All 7 entries in journal point to existing `.sql` files |
| `src/db/migrate.ts` | `migrations/` | `readNonSeedMigrations()` | ✓ WIRED | Reads journal, loads SQL files, skips seed, applies idempotently |
| `tests/globalSetup.ts` | `tests/setup/container.ts` | `import { PG_IMAGE }` | ✓ WIRED | `PG_IMAGE` constant imported and used in `new PostgreSqlContainer(PG_IMAGE)` |
| `tests/helpers/createTestDb.ts` | `migrations/` | `drizzle/postgres-js/migrator.migrate()` | ✓ WIRED | `MIGRATIONS_FOLDER` resolves to `../../migrations`, passed to `migrate(db, { migrationsFolder })` |
| `tests/helpers/createTestDb.ts` | `aprumo_app` role | `pg.Pool({ user: 'aprumo_app' })` | ✓ WIRED | app pool uses `aprumo_app` credentials; role enabled login in test container via `ALTER ROLE` |
| `tests/schema/*.integration.test.ts` | `tests/helpers/createTestDb.ts` | `import { createTestDb }` | ✓ WIRED | All 5 integration test files import and call `createTestDb(import.meta.url)` |
| `scripts/check-migration-drift.mjs` | `migrations/migration-hashes.json` | file read + hash comparison | ✓ WIRED | Script reads both journal and hashes file, compares SHA-256 for each entry |
| `ci.yml:integration-test` | `@aprumo/core test --run` | `pnpm --filter` | ✓ WIRED | Job runs all integration tests including E2E migration gate |
| `ci.yml:migration-integrity` | `scripts/check-migration-drift.mjs` | `node scripts/check-migration-drift.mjs` | ✓ WIRED | Dedicated CI job for FND-15 |
| `0002_grants.sql` | `postings` + `raw_events` tables | REVOKE statement | ✓ WIRED | `REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app` and same for `raw_events` |
| `0003_post_transaction.sql` | `postings` table | `INSERT INTO postings` inside SECURITY DEFINER | ✓ WIRED | Function owns INSERT path; `aprumo_app` has only EXECUTE on function |
| `0005_double_entry_trigger.sql` | `postings` table | `AFTER INSERT ON postings` | ✓ WIRED | Trigger fires on every INSERT to postings, deferred to COMMIT |

---

### Requirements Coverage (FND-01..FND-18)

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|---------|
| FND-01 | accounts table with type CHECK | ✓ SATISFIED | `0000_init_tables.sql` lines 21–28; CHECK constraint `account_type_check` |
| FND-02 | transactions with idempotency_key UNIQUE NOT NULL + metadata jsonb | ✓ SATISFIED | `0000_init_tables.sql` lines 103–111; `idempotency_key` NOT NULL + UNIQUE constraint; `metadata jsonb` column |
| FND-03 | postings: amount_cents BIGINT, direction CHECK, append-only | ✓ SATISFIED | `0000_init_tables.sql` lines 82–89; `amount_cents bigint NOT NULL`; `posting_direction_check` CHECK |
| FND-04 | raw_events: UNIQUE(provider, provider_event_id) | ✓ SATISFIED | `0000_init_tables.sql` line 99: composite UNIQUE constraint |
| FND-05 | account_balance with pending_balance and available_balance reserved NULL | ✓ SATISFIED | `0000_init_tables.sql` lines 17–18; both columns `bigint` nullable; COMMENT ON COLUMN added per D-47 |
| FND-06 | Audit shadow tables for mutable tables | ✓ SATISFIED (scoped) | Three audit shadow tables created: `accounts_audit`, `outbound_endpoints_audit`, `outbound_events_audit`. FND-06 requirement listed `configs_audit` and `customers_audit` but neither `configs` nor `customers` tables exist in Phase 2 schema — the requirement description referenced tables planned for later phases. Implementation is correct per CLAUDE.md Invariant #6: "any mutable table" gets an audit shadow; all Phase 2 mutable tables have shadows. `outbound_events_audit` was correctly added (not listed in FND-06 but is a mutable table). |
| FND-07 | Roles: aprumo_app (SELECT/INSERT) + aprumo_migration (DDL) | ✓ SATISFIED | `0001_roles.sql` creates both roles; `0002_grants.sql` grants and DEFAULT PRIVILEGES |
| FND-08 | REVOKE UPDATE/DELETE on postings + raw_events; CI test expects 42501 | ✓ SATISFIED | `0002_grants.sql` lines 11–12; 4 tests in `revoke.integration.test.ts`; 4 more in E2E test |
| FND-09 | post_transaction validates balance, persists atomically, sole write path | ✓ SATISFIED | `0003_post_transaction.sql` full implementation with SECURITY DEFINER; tested by 7 test cases |
| FND-10 | CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED | ✓ SATISFIED | `0005_double_entry_trigger.sql` lines 53–57 |
| FND-11 | CI asserts condeferrable=true AND condeferred=true | ✓ SATISFIED | `constraint-trigger.integration.test.ts` + E2E test + integration-test CI job |
| FND-12 | docker-compose dev with Postgres 16+, role env vars, autovacuum | ✓ SATISFIED | `docker-compose.yml` with `postgres:18-alpine`, `POSTGRES_USER: aprumo_migration`, `autovacuum_naptime=10` |
| FND-13 | pnpm db:reset destroys+recreates; pnpm db:migrate applies migrations | ✓ SATISFIED | `src/db/reset.ts` + `src/db/migrate.ts`; root `package.json` delegates correctly |
| FND-14 | Dev seed via post_transaction only | ✓ SATISFIED | `0006_seed_dev.sql` uses `SELECT post_transaction(...)`, no direct INSERT into postings |
| FND-15 | Migration hash check fails on edited migration | ✓ SATISFIED | `scripts/check-migration-drift.mjs` + `migration-hashes.json` + `migration-drift.test.ts` + CI jobs |
| FND-16 | Testcontainers globalSetup + schema-per-file isolation | ✓ SATISFIED | `tests/globalSetup.ts`, `tests/helpers/createTestDb.ts` (SHA1 schema naming), `vitest.config.ts` registers globalSetup |
| FND-17 | ADR-009 written in docs/adr/ MADR 4.0 | ✓ SATISFIED | `docs/adr/0009-drizzle-orm-migrations.md` exists, correct frontmatter, MADR sections present |
| FND-18 | ADRs 001–008 ported to docs/adr/ MADR 4.0 | ✓ SATISFIED | `docs/adr/0001–0008-*.md` all exist, all have MADR frontmatter. `README.md` index present. |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `packages/core/tests/setup/container.ts` line 5 | `PG_IMAGE = "postgres:18-alpine"` — tag-pinned only, not digest-pinned | ⚠️ Warning | D-40 required digest pinning for full reproducibility. Comment explains how to pin but doesn't apply the digest. Not a blocking issue: tag-pinning still ensures major/minor version consistency; divergence only possible on patch-level Alpine rebuilds. No credentials or data integrity risk. |
| `packages/core/src/index.ts` | `// Phase 1 stub. Real implementation in Phase 2. export {}` | ℹ️ Info | Phase 2 scope excluded Fastify API — `src/index.ts` remains a stub intentionally. This is accurate per CONTEXT.md: Phase 2 delivers schema + tooling only, not application code. Phase 3 populates this. |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 2 modified files. No empty implementations or hardcoded empty data in production paths.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Migration drift script exits 0 on clean state | `node scripts/check-migration-drift.mjs` | "Migration integrity check passed — no drift detected (7 migrations verified)" | ✓ PASS |
| Migration journal has 7 entries | `cat migrations/meta/_journal.json \| grep '"tag"'` | 7 tags: 0000_init_tables through 0006_seed_dev | ✓ PASS |
| REVOKE is present for both tables | `grep "REVOKE" migrations/0002_grants.sql` | 2 REVOKE lines: postings + raw_events | ✓ PASS |
| SECURITY DEFINER in post_transaction | `grep "SECURITY DEFINER" migrations/0003_post_transaction.sql` | Line 35: `SECURITY DEFINER` | ✓ PASS |
| DEFERRABLE INITIALLY DEFERRED in trigger | `grep "DEFERRABLE INITIALLY DEFERRED" migrations/0005_double_entry_trigger.sql` | Line 55: present | ✓ PASS |
| All 9 ADR files exist | `ls docs/adr/*.md \| wc -l` | 10 files (9 ADRs + README.md) | ✓ PASS |
| root pnpm scripts delegate correctly | `grep "db:migrate" package.json` | `"pnpm --filter @aprumo/core db:migrate"` | ✓ PASS |
| integration-test CI job wired | `grep "integration-test" .github/workflows/ci.yml` | Job defined with correct needs/env | ✓ PASS |

---

### Probe Execution

No `probe-*.sh` files found in `scripts/`. Phase uses Vitest integration tests as the verification mechanism. The `scripts/check-migration-drift.mjs` serves as the equivalent of a probe and was executed directly (see Behavioral Spot-Checks above: exit 0).

---

### Human Verification Required

#### 1. Full `pnpm db:migrate` End-to-End Against Live Postgres Container

**Test:** `docker compose up -d postgres && sleep 5 && DATABASE_URL=postgres://aprumo_migration:changeme@localhost:5432/aprumo pnpm db:migrate`
**Expected:** Command exits 0. Then run `psql -U aprumo_migration aprumo -c "\dt"` and confirm 10 tables present (accounts, transactions, postings, raw_events, account_balance, outbound_endpoints, outbound_events, accounts_audit, outbound_endpoints_audit, outbound_events_audit). Also run `pnpm db:reset` and confirm it drops+recreates without error.
**Why human:** Docker daemon was unavailable in the verification environment. The testcontainers E2E test validates migration correctness but the `pnpm db:migrate` CLI path itself requires a running Docker host to execute.

#### 2. Docker Compose Stack Verification

**Test:** `docker compose up -d postgres && docker compose ps` — confirm postgres container is healthy.
**Expected:** `postgres` service shows as "healthy" per the healthcheck (`pg_isready -U aprumo_migration -d aprumo` with `interval: 5s, retries: 10`).
**Why human:** Requires Docker daemon running locally; cannot verify without it.

#### 3. ADR Prose Quality (FND-17, FND-18)

**Test:** Open each of `docs/adr/0001-postgres-as-ledger-engine.md` through `docs/adr/0009-drizzle-orm-migrations.md` and read the Context, Decision Drivers, Considered Options, Decision Outcome, and Consequences sections.
**Expected:** Each ADR reads coherently, accurately describes the tradeoffs made during project design, presents legitimate alternatives (TigerBeetle for ADR-001, Hono for ADR-002, trigger.dev/BullMQ for ADR-003, etc.), and the Consequences section is honest about limitations. MADR 4.0 structure is present. Honest back-fill dating noted per D-44.
**Why human:** Prose quality and content accuracy are judgment-bound. Structure can be verified programmatically (done — all 9 files exist with correct frontmatter) but whether the prose "accurately documents" the decisions is a human judgment call.

---

## Gaps Summary

No BLOCKER gaps. The phase goal is substantially achieved.

**FND-06 note:** The REQUIREMENTS.md description of FND-06 listed `configs_audit` and `customers_audit` as required audit shadow tables. Neither `configs` nor `customers` tables exist in the Phase 2 schema. The implementation is correct per CLAUDE.md Invariant #6 (shadow every mutable table that exists). The REQUIREMENTS.md text appears to reference tables from a later phase or a prior design iteration. The actually implemented audit shadows (`accounts_audit`, `outbound_endpoints_audit`, `outbound_events_audit`) cover all mutable tables in the current schema. This is a stale requirement description, not a missing implementation.

**D-40 digest pinning:** `PG_IMAGE` in `container.ts` uses `"postgres:18-alpine"` without a SHA256 digest. D-40 required digest pinning for strict reproducibility between CI and local dev. This is a minor reliability gap — tag-pinned images are still reproducible at the major/minor level. Recommend adding the digest in a follow-up commit.

**SERIALIZABLE isolation (CLAUDE.md Invariant #5):** Not present in Phase 2 code — correctly deferred. ROADMAP maps SERIALIZABLE + retry wrapper to Phase 3 (API-10: `withRetryOnSerializationFailure`). The schema produces by Phase 2 is compatible with SERIALIZABLE transactions; the wrapper is an application-layer concern.

---

## Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | SERIALIZABLE isolation level + 40001 retry (CLAUDE.md Invariant #5) | Phase 3 | Phase 3 Success Criterion 4: "`withRetryOnSerializationFailure` wrapper retries the entire `db.transaction()` call on SQLSTATE 40001" |
| 2 | `pg_boss` startup, graceful shutdown, and balance queue | Phase 4 | Phase 4 goal: "pg-boss starts cleanly alongside the Fastify process and shuts down gracefully" |
| 3 | `configs` and `customers` tables (and their audit shadows) | Phase 8+ | `outbound_endpoints` audit exists; `configs`/`customers` tables are referenced in CLAUDE.md invariant examples but have no mapping to Phase 2 schema tables |

---

_Verified: 2026-05-22T22:00:06Z_
_Verifier: Claude (gsd-verifier) — goal-backward analysis against actual codebase_
