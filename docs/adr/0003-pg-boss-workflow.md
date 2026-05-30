---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-003: Use pg-boss for Workflow Queue

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Aprumo must guarantee that when a webhook arrives and is inserted into `raw_events`, the corresponding processing job is enqueued **exactly once**. The failure modes that must be prevented are:

1. **Silent event loss**: webhook is inserted into `raw_events` but the enqueue call fails or is never reached (e.g., process crash between INSERT and enqueue).
2. **Phantom jobs**: the enqueue succeeds but the `raw_events` INSERT fails (transaction rollback) — a job exists for an event that was never recorded.

Both failure modes produce incorrect ledger state: missing postings or duplicate postings. The only correct solution is to make the `INSERT INTO raw_events` and the job enqueue happen **in the same Postgres transaction**, such that COMMIT means both happened or ROLLBACK means neither happened.

The decision is: **which job queue mechanism participates in the same Postgres transaction as the `raw_events` INSERT?**

## Decision Drivers

* **Exact-once guarantee (WHI-04)**: `INSERT INTO raw_events` and job enqueue must be atomic. No distributed consensus, no two-phase commit, no saga pattern — the queue must participate in the PG transaction directly.
* **Same transaction boundary**: the queue must accept a Postgres client/connection handle and participate in an existing Postgres transaction via the `fromDrizzle(tx, sql)` adapter.
* **No separate queue process**: introducing a separate message broker (RabbitMQ, SQS, Redis) requires a second infrastructure component that design partners must operate. Aprumo is self-hosted-first; operational complexity must be minimal.
* **Postgres co-location**: the queue implementation must store its state in the same Postgres instance as the ledger tables. This enables the transactional boundary requirement above.
* **v12 API**: the `fromDrizzle(tx, sql)` transactional adapter is a pg-boss v12 addition. Older versions do not support this pattern.
* **Worker polling model**: pg-boss workers poll for jobs using `boss.work()`. This is acceptable for Aprumo's throughput targets (100–500 RPS webhook ingest). Sub-second polling interval is sufficient for p99 lag < 1s.
* **pg-boss autovacuum compatibility**: queue tables experience high INSERT/DELETE churn. pg-boss supports per-table autovacuum overrides via schema config, mitigating bloat.

## Considered Options

* **Option A: pg-boss 12** (chosen)
* **Option B: trigger.dev**
* **Option C: BullMQ (Redis-backed)**

## Decision Outcome

**Chosen option: Option A — pg-boss 12**, because it is the sole option that participates in the same Postgres transaction as the `raw_events` INSERT via the `fromDrizzle(tx, sql)` adapter. This is the architectural foundation of the exact-once webhook guarantee (WHI-04). No other evaluated option can provide this guarantee without introducing distributed consensus or two-phase commit.

### Consequences

**Good:**
* Exact-once webhook guarantee achieved without distributed systems complexity. `INSERT raw_events + boss.send({ db: fromDrizzle(tx, sql) })` in a SERIALIZABLE transaction is atomic.
* No additional infrastructure. Queue tables live in the same Postgres instance as ledger tables.
* pg-boss provides job retry, exponential backoff, dead-letter queuing, and singleton job policies — all required for the balance worker, reconciliation worker, and outbound dispatcher.
* `boss.work()` polling model is simple to reason about and test with testcontainers.
* pg-boss v12 workers receive an array: `async (jobs) => { for (const job of jobs) }` — enables micro-batching if needed.

**Bad:**
* Queue tables experience high INSERT/DELETE churn. Autovacuum must be tuned per-table (`autovacuum_vacuum_scale_factor = 0.01`, `autovacuum_vacuum_cost_delay = 2`) to prevent bloat. This is a documented pg-boss operational requirement.
* No separate queue process means queue processing competes with ledger writes for Postgres connections. Mitigated by connection pool sizing and the fact that Aprumo's workers run in a separate OS process from the API.
* pg-boss is not a general-purpose message broker. It does not support pub/sub fan-out, ordered delivery guarantees beyond queue semantics, or cross-database federation.

## Pros and Cons of the Options

### Option A: pg-boss 12

**Pros:**
- `fromDrizzle(tx, sql)` adapter participates in an existing Drizzle transaction — exact-once INSERT+enqueue is achievable.
- Queue state in the same Postgres instance as ledger — single infrastructure component for self-hosted deployment.
- Built-in: retry with exponential backoff, dead-letter queues, singleton policies, scheduled jobs (cron-like), job visibility timeouts.
- No additional process or container required beyond Postgres and the Node.js application.
- v12 adds worker array API (`async (jobs) => ...`) and the `fromDrizzle` adapter — both required features.

**Cons:**
- Autovacuum tuning required for queue tables.
- Not a general-purpose message broker.
- Polling model (not push) adds slight latency compared to dedicated queue brokers.

### Option B: trigger.dev

trigger.dev is a background job framework with a hosted orchestration layer and a local runner for self-hosted use.

**Why trigger.dev was not chosen:**
- trigger.dev runs jobs on its own scheduler, which communicates with the application via HTTP or WebSocket. It cannot participate in an existing Postgres SERIALIZABLE transaction — the `INSERT raw_events` and job creation are in separate systems.
- Exact-once guarantee requires two-phase commit or saga compensation when using trigger.dev, adding significant complexity.
- trigger.dev's self-hosted model introduces an additional service (the trigger.dev runner) that design partners must operate.
- At v0.1 scale (100 RPS), the operational overhead of trigger.dev outweighs its benefits.

### Option C: BullMQ (Redis-backed)

BullMQ is a Node.js queue library backed by Redis. It is widely used and battle-tested.

**Why BullMQ was not chosen:**
- BullMQ uses Redis as its backing store. Redis cannot participate in a Postgres SERIALIZABLE transaction — the `INSERT raw_events` and the Redis enqueue are in separate systems with no shared atomicity.
- Achieving exact-once with BullMQ + Postgres requires saga/outbox pattern: write to a `pending_jobs` table in PG, commit, then a separate process reads `pending_jobs` and enqueues to Redis, then marks as enqueued. This is a two-phase design that reintroduces the exact-once problem at the `pending_jobs → Redis` boundary.
- Adds Redis as an infrastructure dependency. Self-hosted design partners must operate Postgres + Redis instead of just Postgres.
- Not justified at Aprumo's v0.1 throughput target.

## More Information

* [pg-boss documentation](https://github.com/timgit/pg-boss/blob/master/docs/readme.md)
* [`fromDrizzle` transactional adapter](https://github.com/timgit/pg-boss/blob/master/docs/readme.md#transact) — v12 addition, critical for exact-once guarantee.
* pg-boss version: 12.18.2 (verified 2026-05-18); requires Node >= 22.12.0.
* See ADR-001 for Postgres selection rationale (exact-once co-location is a key driver).
* See Phase 5 (Webhooks Inbound) for crash-injection test that validates exact-once behavior.
* **Critical implementation note**: `boss.send(name, data, { db: fromDrizzle(tx, sql) })` must always receive the active Drizzle transaction handle. A call outside the transaction (even if `await`-ed before commit) does not have the same atomicity guarantee.
