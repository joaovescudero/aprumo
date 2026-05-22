---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-001: Use PostgreSQL as the Ledger Engine

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Aprumo needs a persistence engine that can:
1. Enforce immutability guarantees at the database level (not just at the application level).
2. Support deferrable constraint triggers for double-entry validation at COMMIT time.
3. Participate in the same transaction boundary as the job queue (pg-boss) to achieve exact-once webhook ingest.
4. Enforce permission-level write restrictions (`REVOKE UPDATE, DELETE ON postings FROM aprumo_app`).
5. Provide ACID-strict SERIALIZABLE isolation for concurrent ledger writes.

The decision is: **which database engine serves as the Aprumo ledger backend?**

## Decision Drivers

* **Three-layer immutability**: `postings` and `raw_events` must be append-only. Layer 1 = PG role `REVOKE`; Layer 2 = `SECURITY DEFINER` function `post_transaction()` as the sole INSERT path; Layer 3 = `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` asserting `SUM(amount_cents with sign) = 0` per `transaction_id` at COMMIT.
* **Exact-once webhook guarantee**: `INSERT INTO raw_events` and `pg-boss.send()` must happen in the same Postgres transaction. This requires the job queue to be co-located in the same Postgres instance.
* **DEFERRABLE CONSTRAINT TRIGGER**: double-entry validation must run at COMMIT, not at INSERT time, to allow multi-row posting batches to accumulate before validation. PostgreSQL supports `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`; this is not a standard feature in non-relational stores.
* **`SECURITY DEFINER` functions**: the sole write path into `postings` must be enforceable at the DB level, not just by convention. PostgreSQL SECURITY DEFINER functions run as the function owner, allowing `aprumo_app` to call `post_transaction()` without having INSERT permission on `postings` directly.
* **SERIALIZABLE isolation**: ledger writes use `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` with retry on `40001` (serialization failure). This maps directly to Postgres MVCC semantics.
* **v0.1 throughput target**: 100 RPS; v0.5 target: ~500 RPS. Postgres handles this with single-instance hardware.
* **Operational simplicity**: single-DB design (ledger tables + pg-boss queue + Drizzle migration tracking in the same instance) minimizes operational complexity for self-hosted design partners.
* **Standard SQL and ecosystem**: Drizzle ORM, `psql`, `pg_dump`, standard tooling. No custom binary protocol or proprietary query language.

## Considered Options

* **Option A: PostgreSQL 16+** (chosen)
* **Option B: TigerBeetle**
* **Option C: CockroachDB**

## Decision Outcome

**Chosen option: Option A — PostgreSQL 16+**, because it is the only option that satisfies all seven decision drivers simultaneously. TigerBeetle fails on exact-once co-location, CONSTRAINT TRIGGER DEFERRABLE, and standard SQL ecosystem. CockroachDB adds operational complexity without meaningful benefit at v0.1 scale.

### Consequences

**Good:**
* Full standard SQL. Drizzle, Kysely, pg-boss, psql all work natively.
* DEFERRABLE CONSTRAINT TRIGGER available — the critical mechanism for deferred double-entry validation.
* pg-boss participates in the same PG transaction — exact-once webhook ingest is achievable without distributed consensus.
* REVOKE at role level enforces immutability unconditionally — even future application code cannot bypass it.
* SECURITY DEFINER functions enforce the single-write-path invariant at the DB level.
* `DEFAULT PRIVILEGES FOR ROLE aprumo_migration` ensures new tables created by migrations automatically have correct grants for `aprumo_app`.
* Battle-tested at financial institutions. Extensive tooling for backup, replication, and observability.
* Single Postgres instance for all state: ledger, queue, and migration tracking.

**Bad:**
* Not optimized purely for financial transaction throughput (e.g., TigerBeetle benchmarks at ~1M TPS with custom binary protocol). Acceptable: Aprumo v0.1 targets 100 RPS; v0.5 targets ~500 RPS. Postgres handles this on commodity hardware.
* SERIALIZABLE isolation increases write contention under high concurrency — mitigated by `withRetryOnSerializationFailure` wrapper (up to 3 retries on `40001`).
* pg-boss adds autovacuum tuning overhead (queue tables experience high INSERT/DELETE churn). Mitigated via per-table `autovacuum_vacuum_scale_factor = 0.01` in docker-compose.

## Pros and Cons of the Options

### Option A: PostgreSQL 16+

**Pros:**
- DEFERRABLE CONSTRAINT TRIGGER available — the core double-entry enforcement mechanism.
- SECURITY DEFINER functions enforce the single-write-path invariant.
- pg-boss co-location enables exact-once webhook ingest in a single transaction.
- REVOKE UPDATE, DELETE enforces immutability at role level.
- Standard SQL, full Drizzle/pg-boss/psql ecosystem.
- SERIALIZABLE isolation natively supported with retry on `40001`.
- Mature operational tooling (pg_dump, streaming replication, Patroni).
- Single instance covers ledger + queue + migration tracking.

**Cons:**
- Not purpose-built for high-throughput financial ledger (vs. TigerBeetle).
- SERIALIZABLE mode increases contention; requires retry logic.
- pg-boss queue tables require autovacuum tuning to prevent bloat.

### Option B: TigerBeetle

TigerBeetle is a purpose-built financial database written in Zig, designed for high-throughput double-entry bookkeeping. It was evaluated and rejected for the following reasons:

**Why TigerBeetle was rejected:**
- **No pg-boss compatibility**: TigerBeetle is a separate process with a binary protocol. pg-boss requires Postgres to participate in the same transaction boundary. Exact-once webhook ingest (`INSERT raw_events` + enqueue in same tx) is architecturally impossible with TigerBeetle as the ledger.
- **No DEFERRABLE CONSTRAINT TRIGGER equivalent**: TigerBeetle enforces debits-must-equal-credits at insertion time, not at COMMIT time. This prevents multi-row posting batches where individual rows are temporarily imbalanced. Aprumo's `post_transaction()` pattern requires deferred validation.
- **No REVOKE / role-based permission model**: TigerBeetle does not have a role system. The three-layer immutability model (REVOKE + SECURITY DEFINER + trigger) cannot be implemented.
- **No standard SQL**: TigerBeetle uses a binary protocol. Drizzle, psql, standard tooling do not work. This eliminates the entire standard PG ecosystem.
- **Operational complexity**: Two databases (TigerBeetle for ledger + Postgres for queue, config, and jobs) would be required. Self-hosted design partners would need to operate and monitor two distinct systems.
- **Not ACID relational**: TigerBeetle enforces its own invariants but is not a general-purpose ACID relational store. `transactions`, `raw_events`, `account_balance`, audit tables, and outbound webhook tables are all relational — they cannot live in TigerBeetle.
- **v0.1 throughput is not a bottleneck**: TigerBeetle's core advantage (millions of TPS) is irrelevant at Aprumo's v0.1 target of 100 RPS. The added operational complexity has no compensating benefit in the MVP window.

**Pros of TigerBeetle (acknowledged):**
- Extremely high throughput (benchmarked at ~1M TPS).
- Built-in double-entry enforcement with strong consistency guarantees.
- Designed specifically for financial workloads.

### Option C: CockroachDB

CockroachDB is a distributed SQL database with Postgres-compatible wire protocol.

**Why CockroachDB was not chosen:**
- Distributed transactions add latency overhead not justified at v0.1 scale.
- `DEFERRABLE CONSTRAINT TRIGGER` behavior is implementation-specific and may not behave identically to Postgres.
- Adds operational complexity (distributed cluster vs. single Postgres instance) without a meaningful throughput benefit at 100 RPS.
- pg-boss is tested and documented against Postgres; CockroachDB compatibility is not guaranteed.

## More Information

* [PostgreSQL CONSTRAINT TRIGGER documentation](https://www.postgresql.org/docs/16/sql-createtrigger.html)
* [TigerBeetle GitHub](https://github.com/tigerbeetle/tigerbeetle) — reviewed during evaluation (2026-05-18)
* [pg-boss transactional adapter](https://github.com/timgit/pg-boss/blob/master/docs/readme.md#transact) — requires same Postgres connection
* See ADR-003 for pg-boss exact-once rationale.
* See ADR-009 for Drizzle migration strategy.
* Postgres version target: 16+ (v0.1 tested on 18-alpine in testcontainers).
