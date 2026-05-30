---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-004: Incremental Balance Worker with Cursor

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

`account_balance` stores the materialized running balance per account. It must be updated whenever new postings are committed. The update mechanism must satisfy:

1. **p99 lag < 1s** (BAL-06): from the moment a posting is committed, the materialized `account_balance` must reflect it within 1 second at the 99th percentile.
2. **O(delta) processing**: the balance update algorithm must process only new postings since the last run, not re-scan the entire `postings` table (which grows unboundedly).
3. **Safe concurrency**: if multiple worker processes run simultaneously (e.g., rolling deploy), they must not produce a corrupted balance. The update must be serialized per account.
4. **Restartability**: if the worker crashes mid-run, it must be able to resume from the last committed position without duplicating or losing updates.

The decision is: **which mechanism keeps `account_balance` fresh?**

## Decision Drivers

* **p99 lag < 1s (BAL-06)**: balance update must be triggered promptly after new postings, not on a slow periodic schedule.
* **Cursor pattern for restartability**: `account_balance.last_posting_id` serves as the cursor. On each worker run, the worker queries `postings WHERE id > last_posting_id ORDER BY id` and aggregates the delta. After applying the delta, it updates `last_posting_id`. Crash-safe: restarted worker picks up from the last committed `last_posting_id`.
* **`SELECT FOR UPDATE` on `account_balance` row (BAL-04)**: prevents two concurrent worker instances from simultaneously updating the same account's balance. The row lock is released at COMMIT.
* **Async, not synchronous**: the balance update must not be in the write path of `post_transaction()`. Slowing the ledger write path to update balance synchronously would hurt throughput and create a failure dependency.
* **pg-boss polling interval**: the balance worker runs via pg-boss scheduled job at sub-second poll intervals. This achieves the p99 < 1s target without a synchronous trigger.

## Considered Options

* **Option A: pg-boss incremental worker with cursor and `SELECT FOR UPDATE`** (chosen)
* **Option B: `AFTER INSERT` trigger on `postings` (synchronous in-transaction update)**
* **Option C: Postgres materialized view with periodic `REFRESH MATERIALIZED VIEW`**

## Decision Outcome

**Chosen option: Option A — pg-boss incremental worker with `last_posting_id` cursor and `SELECT FOR UPDATE`**, because it satisfies all four requirements: p99 lag < 1s (via pg-boss polling), O(delta) processing (cursor-based scan), safe concurrency (`SELECT FOR UPDATE` row lock), and restartability (cursor persisted in `account_balance`). The synchronous trigger approach (Option B) blocks the write path; the materialized view approach (Option C) is O(N) on the full posting history.

### Consequences

**Good:**
* Balance update is fully decoupled from the write path. `post_transaction()` commits immediately without waiting for balance materialization.
* O(delta) processing: the cursor ensures the worker only processes postings newer than `last_posting_id` — efficient even when the postings table has millions of rows.
* `SELECT FOR UPDATE` prevents concurrent balance corruption without application-level distributed locking.
* Crash-safe: `last_posting_id` is updated atomically with the balance. A worker restart resumes from the last committed position.
* pg-boss provides retry, backoff, and monitoring for the balance worker job.
* Prometheus metric `aprumo_balance_worker_lag_seconds` can be derived from `now() - MAX(postings.created_at WHERE id > last_posting_id)`.

**Bad:**
* Balance update is async (< 1s lag, not zero-lag). A `GET /accounts/:id` immediately after `POST /transactions` may return a stale balance. Acceptable: API clients must tolerate < 1s eventual consistency on `account_balance`.
* Requires pg-boss to be running at all times for `account_balance` to stay fresh. If the worker process is down, balance lag accumulates.
* `SELECT FOR UPDATE` serializes balance updates per account — high-volume accounts (many postings per second) may experience worker queue depth. Acceptable at v0.1/v0.5 throughput targets.

## Pros and Cons of the Options

### Option A: pg-boss incremental worker with cursor

**Pros:**
- Decoupled from write path — no latency added to `post_transaction()`.
- O(delta) processing via `last_posting_id` cursor.
- `SELECT FOR UPDATE` prevents concurrent balance corruption.
- Crash-safe and restartable.
- pg-boss handles scheduling, retry, and dead-letter for the worker.

**Cons:**
- Async: < 1s lag (not zero-lag).
- Requires worker process to be healthy.
- High-volume accounts face per-account serialization.

### Option B: AFTER INSERT trigger on `postings` (synchronous)

An `AFTER INSERT` trigger on `postings` would update `account_balance` inside the same transaction as the posting INSERT, achieving zero-lag balance materialization.

**Why Option B was not chosen:**
- The trigger runs inside the `post_transaction()` transaction. Any failure in the trigger rolls back the entire transaction — a balance update bug causes ledger write failures.
- The trigger blocks the write path. High-volume inserts (batch postings) are slowed by synchronous aggregate recomputation.
- Deadlock risk: triggers on `postings` acquiring locks on `account_balance` rows, combined with concurrent writers, creates a deadlock surface that is difficult to analyze.
- Deferred triggers that scan the full posting set are O(N) per transaction, not O(delta).
- Not compatible with the `DEFERRABLE INITIALLY DEFERRED` constraint trigger pattern — mixing deferred constraint triggers with AFTER INSERT triggers on the same table requires careful ordering analysis.

### Option C: Materialized view with REFRESH MATERIALIZED VIEW

A standard Postgres materialized view computing `SUM(amount_cents)` per account, refreshed periodically.

**Why Option C was not chosen:**
- `REFRESH MATERIALIZED VIEW` is O(N) — it recomputes the full aggregate over all postings. As the postings table grows, refresh time increases unboundedly.
- `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index and still locks the view during the diff phase, causing query latency spikes.
- Refresh frequency is limited by the O(N) cost. Achieving p99 lag < 1s via periodic refresh is impractical as posting history grows.
- No built-in cursor or checkpoint: a failed refresh leaves the view stale until the next successful refresh.

## More Information

* [pg-boss job scheduling](https://github.com/timgit/pg-boss/blob/master/docs/readme.md#schedule)
* [Postgres SELECT FOR UPDATE](https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE)
* `account_balance` columns: `account_id PK`, `balance BIGINT NOT NULL`, `last_posting_id BIGINT`, `updated_at TIMESTAMPTZ`, `pending_balance BIGINT NULL`, `available_balance BIGINT NULL`.
* `pending_balance` and `available_balance` columns are reserved for v0.5 (see ADR-009 Reservation pattern). The v0.1 balance worker writes only `balance` and `last_posting_id`.
* See Phase 4 (Balance Worker) for the full worker implementation including pg-boss queue definition and autovacuum overrides.
* Prometheus metric target: `aprumo_balance_worker_lag_seconds` histogram.
