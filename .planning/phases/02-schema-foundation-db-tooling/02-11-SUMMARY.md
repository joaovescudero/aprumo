---
phase: "02-schema-foundation-db-tooling"
plan: "11"
subsystem: "docs/adr"
tags: ["adr", "architecture", "documentation", "madr"]
dependency_graph:
  requires: []
  provides: ["docs/adr/0001-0009", "docs/adr/README.md"]
  affects: ["all-phases"]
tech_stack:
  added: []
  patterns: ["MADR 4.0", "honest back-fill dating", "reservation pattern"]
key_files:
  created:
    - docs/adr/0001-postgres-as-ledger-engine.md
    - docs/adr/0002-fastify-http-framework.md
    - docs/adr/0003-pg-boss-workflow.md
    - docs/adr/0004-incremental-balance-worker.md
    - docs/adr/0005-accounting-split-async-settlement.md
    - docs/adr/0006-versioning-v01-v05.md
    - docs/adr/0007-smart-routing-as-logical-failover.md
    - docs/adr/0008-mit-core-enterprise-edition.md
    - docs/adr/0009-drizzle-orm-migrations.md
    - docs/adr/README.md
  modified: []
decisions:
  - "ADR-001: PostgreSQL chosen over TigerBeetle — DEFERRABLE TRIGGER + pg-boss exact-once + REVOKE are PostgreSQL-exclusive features at this intersection"
  - "ADR-009 date: 2026-05-22 (net-new decision in Phase 2, not a back-fill)"
  - "Honest back-fill dating: D-44 pattern applied — each ADR notes it was back-filled from PRD.md §9"
  - "No adr-tools or log4brains dependency — naming convention is the interface (D-43)"
  - "D-47 reservation pattern documented in ADR-009: pending_balance/available_balance reserved as NULL for v0.5 upgrade path"
metrics:
  duration: "~65 minutes"
  completed: "2026-05-22"
  tasks_completed: 2
  tasks_total: 2
  files_created: 10
  files_modified: 0
requirements:
  - FND-17
  - FND-18
---

# Phase 2 Plan 11: Architecture Decision Records (ADRs 001–009) Summary

## One-liner

Nine MADR 4.0 Architecture Decision Records documenting Postgres-over-TigerBeetle, Fastify, pg-boss exact-once, incremental balance worker, async settlement, versioning, smart routing, MIT licensing, and Drizzle hybrid migrations — with honest back-fill dating and ADR-009 reservation pattern.

## What Was Built

Wrote all 9 ADRs in MADR 4.0 format in `docs/adr/`, replacing the `.gitkeep` placeholder with substantive content:

**Task 1 — ADRs 001–005** (commit `3010cfc`):
- **ADR-001**: Full Postgres vs. TigerBeetle evaluation. Covers why TigerBeetle was rejected: no pg-boss co-location for exact-once, no DEFERRABLE CONSTRAINT TRIGGER equivalent, no REVOKE role model, no standard SQL. Includes 7 decision drivers (SECURITY DEFINER, SERIALIZABLE isolation, etc.).
- **ADR-002**: Fastify 5 over Hono and Express. Key driver: `coerceTypes: false` is mandatory for a money API.
- **ADR-003**: pg-boss 12 over trigger.dev and BullMQ. The `fromDrizzle(tx, sql)` adapter is the architectural linchpin for exact-once webhook ingest.
- **ADR-004**: Incremental balance worker with `last_posting_id` cursor + `SELECT FOR UPDATE`. Explains why synchronous triggers and materialized views were rejected.
- **ADR-005**: Post at settlement event only (v0.1 scope). `pending_balance`/`available_balance` reserved as NULL for v0.5 full accounting split.

**Task 2 — ADRs 006–009 + README** (commit `d2f43e5`):
- **ADR-006**: v0.1 vs v0.5 milestone scoping. Defines what ships vs. what is deferred.
- **ADR-007**: Smart routing = exponential retry on same PSP (Starkbank) in v0.1. True multi-PSP routing deferred to v0.5 when AbacatePay connector exists.
- **ADR-008**: MIT license for all `@aprumo/*` packages. Enterprise edition for dashboards, hosted instance, SLA.
- **ADR-009**: Drizzle ORM + hybrid migration strategy (net-new decision, `date: "2026-05-22"`). Includes the D-47 reservation pattern documenting `pending_balance`/`available_balance` NULL columns in v0.1 to avoid hot-table ALTER TABLE during v0.5 upgrade.
- **README.md**: Index table with all 9 ADRs, status, decided date, and documented date. Explains the naming convention and honest back-fill dating.

## Verification Results

All verification criteria from the plan passed:

| Check | Expected | Result |
|-------|----------|--------|
| `ls docs/adr/*.md \| wc -l` | 10 | 10 |
| `status: "Accepted"` in ADR files (0*.md) | 9 | 9 |
| `decision-makers: "Joao Escudero"` in ADR files | 9 | 9 |
| SECURITY DEFINER/DEFERRABLE/pg-boss/Drizzle in ADR-001 | matches | 29 matches |
| "Reservation pattern" in ADR-009 | matches | 1 match (§D-47) |
| `date: "2026-05-22"` in ADR-009 | matches | 1 match |
| Honest dating note in each ADR | yes | yes (ADRs 001–008) |
| No adr-tools/log4brains referenced | none | none found |

## Deviations from Plan

None — plan executed exactly as written.

All ADR content was derived faithfully from `PRD.md §9`, `SUMMARY.md`, `CLAUDE.md`, and the `02-CONTEXT.md` decisions (D-41 through D-47). No new benchmarks, no invented alternatives.

## Known Stubs

None. ADRs are documentation-only with no data source wiring required.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. ADRs are static Markdown files. No threat flags.

## Self-Check: PASSED

- `docs/adr/0001-postgres-as-ledger-engine.md` — FOUND
- `docs/adr/0002-fastify-http-framework.md` — FOUND
- `docs/adr/0003-pg-boss-workflow.md` — FOUND
- `docs/adr/0004-incremental-balance-worker.md` — FOUND
- `docs/adr/0005-accounting-split-async-settlement.md` — FOUND
- `docs/adr/0006-versioning-v01-v05.md` — FOUND
- `docs/adr/0007-smart-routing-as-logical-failover.md` — FOUND
- `docs/adr/0008-mit-core-enterprise-edition.md` — FOUND
- `docs/adr/0009-drizzle-orm-migrations.md` — FOUND
- `docs/adr/README.md` — FOUND
- Commit `3010cfc` — FOUND (ADRs 001–005)
- Commit `d2f43e5` — FOUND (ADRs 006–009 + README)
