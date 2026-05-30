---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: milestone
status: executing
stopped_at: Phase 3 Plan 04 complete — TypeBox schemas, BigInt serializer, server factory
last_updated: "2026-05-30T05:00:00Z"
last_activity: 2026-05-30
progress:
  total_phases: 9
  completed_phases: 2
  total_plans: 28
  completed_plans: 27
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Ledger imutável, ACID estrito, double-entry, agnóstico a PSP — fonte da verdade contábil sobre tudo que se movimenta nos PSPs, sem custodiar dinheiro.
**Current focus:** Phase 3 — core ledger api

## Current Position

Phase: 3
Plan: 04 (complete), 05 next
Status: In progress
Last activity: 2026-05-30

Progress: [██████████] 89%

## Performance Metrics

**Velocity:**

- Total plans completed: 24
- Average duration: 10m 19s
- Total execution time: 0.52 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 7 | - | - |
| 02 | 14 | - | - |

**Recent Trend:**

- Last 5 plans: 01-00 (7m 27s), 01-01 (8m), 01-02 (15m)
- Trend: establishing baseline

*Updated after each plan completion*
| Phase 01 P03 | 8m | 2 tasks | 3 files |
| Phase 01 P04 | 4m | 2 tasks | 7 files |
| Phase 02 P01 | 20m | 2 tasks | 8 files |
| Phase 02-schema-foundation-db-tooling P11 | 65m | 2 tasks | 10 files |
| Phase 02-schema-foundation-db-tooling P08 | 25 | 2 tasks | 7 files |
| Phase 02-schema-foundation-db-tooling P02 | 7 | 2 tasks | 5 files |
| Phase 02-schema-foundation-db-tooling P03 | 5min | 2 tasks | 4 files |
| Phase 02-schema-foundation-db-tooling P04 | 3min | 2 tasks | 3 files |
| Phase 02-schema-foundation-db-tooling P06 | 3min | 2 tasks | 3 files |
| Phase 02-schema-foundation-db-tooling P05 | 150 | 2 tasks | 3 files |
| Phase 02-schema-foundation-db-tooling P07 | 5min | 1 tasks | 10 files |
| Phase 02-schema-foundation-db-tooling P09 | 8 | 2 tasks | 5 files |
| Phase 02-schema-foundation-db-tooling P10 | 15min | 2 tasks | 2 files |
| Phase 02-schema-foundation-db-tooling P12 | 180 | 2 tasks | 4 files |
| Phase 02-schema-foundation-db-tooling P13 | 97s | 2 tasks | 1 files |
| Phase 02-schema-foundation-db-tooling P14 | 12min | 3 tasks | 2 files |
| Phase 03-core-ledger-api P01 | 6m 5s | 2 tasks | 2 files |
| Phase 03 P02 | 138s | 2 tasks | 4 files |
| Phase 03 P03 | 367 | 3 tasks | 5 files |
| Phase 03 P04 | 8m 5s | 3 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- ADR-009 (Drizzle ratificado) must be written in Phase 2 as part of `docs/adr/`
- All ADRs 001–008 must be ported to MADR format in Phase 2 before any migration is committed
- Starkbank event taxonomy spike (SBC-11) is Phase 6 prerequisite — must be done BEFORE writing NormalizedEvent mapping code
- Phase 5 (connector-base) must finalize `LedgerConnector` interface including `refundPayment` + `getPayment` before Phase 6 begins
- Exact-once webhook guarantee (WHI-04) is highest-risk implementation detail — crash-injection test is a hard gate for Phase 7
- D-20 AMENDED confirmed: vitest.config.ts uses `projects:` array with inline root-tests project (not vitest.workspace.ts deprecated in 3.2)
- Wave 0 vitest config needs inline project object for tests/ to avoid "No projects found" startup error before packages/ exist
- Biome v2 breaking change: files.ignore renamed to files.includes with ! negation syntax (discovered during 01-01 execution)
- tests/tsconfig.json required for vitest OXC transformer when root tsconfig.json uses composite/files:[] pattern
- D-01..D-06 (pre-commit stack): lefthook + gitleaks 8.30.1 + commitlint wired; ROADMAP success criterion #2 met (EC key blocked pre-commit)
- [Phase ?]: drizzle-orm/postgres-js/migrator requires max:1 connection — enforced in migrate.ts
- [Phase ?]: db:reset guarded by NODE_ENV=production check to prevent accidental data loss in production
- [Phase ?]: postgres:18-alpine pinned for docker-compose (D-40) — same image as testcontainers for reproducibility
- [Phase ?]: ADR-001: PostgreSQL over TigerBeetle — DEFERRABLE TRIGGER + pg-boss exact-once + REVOKE
- [Phase ?]: ADR-009 (2026-05-22): Drizzle hybrid migrations + D-47 reservation pattern for pending_balance
- [Phase ?]: CREATE ROLE IF NOT EXISTS used for idempotent role creation on db:reset + re-migrate
- [Phase ?]: REVOKE UPDATE, DELETE on postings and raw_events enforces CLAUDE.md Invariant #1 at DB layer
- [Phase ?]: No passwords in migration files; aprumo_app NOLOGIN in production; test helper enables LOGIN temporarily
- [Phase ?]: SECURITY DEFINER function post_transaction is sole INSERT path into postings — DB-level enforcement, not convention
- [Phase ?]: posting_input composite type chosen over JSONB array for PG-level type safety
- [Phase ?]: P0001 error code with message prefixes for all validation failures — mappable to HTTP 422 in Phase 3
- [Phase ?]: Migration landed at idx=5 (0005_double_entry_trigger.sql) — plan 02-06 (audit triggers) occupied idx=4 during parallel execution
- [Phase ?]: CONSTRAINT TRIGGER is the only trigger type supporting DEFERRABLE — fires at COMMIT (not statement end) for aggregate cross-row double-entry validation
- [Phase ?]: P0001 + double_entry_violation: prefix for Phase 3 HTTP 422 routing — third immutability layer belt-and-suspenders with post_transaction inline check
- [Phase 02 P07]: Custom migrate runner with SEED_TAG_PATTERN=/seed/i skips journal entries tagged as seed — seed registered in _journal.json for Plan 09 drift check but never applied by pnpm db:migrate
- [Phase 02 P07]: db:seed script points to src/db/seed.ts (TypeScript runner in src/ follows project convention alongside migrate.ts and reset.ts)
- [Phase 02 P12]: FK qualifiers rewritten in-memory; migration files never modified — drift gate remains intact
- [Phase 02 P12]: pg_advisory_xact_lock serializes ALTER ROLE across concurrent vitest forks (pg_authid row-lock)
- [Phase 02 P12]: GRANT USAGE ON SCHEMA to aprumo_migration required for SECURITY DEFINER PL/pgSQL compilation in test schema
- [Phase 02 P12]: readWithRetry() 10-attempt exponential backoff resolves macOS APFS ENOENT race under concurrent I/O
- [Phase ?]: D-40 digest pin
- [Phase 02 P14]: D-50: globalSetup pre-creates cluster-global roles with PL/pgSQL EXCEPTION duplicate_object (not IF NOT EXISTS) — atomic idempotency for cold and reuse-mode containers
- [Phase 02 P14]: D-51: RACE-02 targets shared inject('pgUri') container to test actual fix boundary; RACE-01 targets ephemeral container to document raw race without savepoint masking
- [Phase 03 P01]: @fastify/type-provider-typebox downgraded to 5.2.0 — v6.1.0 requires standalone typebox@1.x peer, incompatible with @sinclair/typebox@0.34.49; v5.2.0 supports @sinclair/typebox >=0.26 <=0.34
- [Phase 03 P04]: Two-layer BigInt serializer: setSerializerCompiler alone does not apply to schema-less routes in Fastify 5 — added setReplySerializer as universal fallback
- [Phase 03 P04]: AnyDrizzleDb = PostgresJsDatabase | NodePgDatabase union exported from server.ts; all route plugins import this type

### Pending Todos

None yet.

### Blockers/Concerns

- Starkbank SDK TypeScript types partially inaccurate — identify which methods need `as unknown as T` casts with justification comments during Phase 6 planning
- `pending_balance` schema reservation decision needed before Phase 2 migrations are committed (retroactive migration affects all `account_balance` rows)
- Business-semantic deduplication rules per NormalizedEvent type need specification before Phase 7 coding (flag for Phase 7 planning)

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v0.5 | AbacatePay connector | Deferred | Project init |
| v0.5 | Split de pagamento contábil | Deferred | Project init |
| v0.5 | Smart routing / dunning | Deferred | Project init |
| v0.5 | createToken (recurring cards) | Deferred | Project init |
| v0.5 | cancelPayment | Deferred | Project init |
| v0.5 | pending_balance / available_balance | Deferred | Project init |
| v0.5 | Full dispute lifecycle | Deferred | Project init |

## Session Continuity

Last session: 2026-05-30T05:00:00Z
Stopped at: Phase 3 Plan 04 complete — TypeBox schemas, BigInt serializer, server factory
Resume file: None
