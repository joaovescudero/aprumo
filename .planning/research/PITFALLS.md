# Pitfalls Research

**Domain:** Financial double-entry ledger, agnostic-PSP, Brazilian recurring-revenue SaaS
**Researched:** 2026-05-18
**Confidence:** HIGH (ledger invariants, Postgres behavior) / MEDIUM (Starkbank specifics, OSS operational)

---

## Critical Pitfalls

### Pitfall 1: Double-Entry Invariant Bypass via Direct INSERT

**What goes wrong:**
Code inserts into `postings` directly (via Drizzle ORM, raw SQL, or a helper that "knows" the math) instead of routing through `post_transaction(postings[])`. The deferred constraint never fires for individual postings — it fires per `transaction_id` at COMMIT. A single rogue INSERT creates an unbalanced transaction that passes all app-level checks because the constraint was never triggered by that code path.

**Why it happens:**
Developer needs to "just add a correction posting" quickly, or writes a reconciliation script that bypasses the API layer. Drizzle makes it trivially easy to do `db.insert(postings).values(...)`. The constraint feels like a safety net so people don't worry about calling `post_transaction`.

**How to avoid:**
- `REVOKE INSERT ON postings FROM aprumo_app` is not enough — the function needs `SECURITY DEFINER` with `aprumo_migration` privileges; the app role has zero write path to `postings` except via `post_transaction`.
- CI test: attempt direct `INSERT INTO postings` with `aprumo_app` role — assert permission denied.
- Drizzle schema for `postings` should not export an insert function; expose only query helpers. Make the "wrong" path a compile error.
- Code review rule: any PR touching `postings` that isn't `post_transaction.sql` gets rejected.

**Warning signs:**
- `SUM(amount_cents) != 0` in any `GROUP BY transaction_id` query (run this daily).
- Ad-hoc scripts in `/scripts` that import Drizzle directly and touch `postings`.
- `post_transaction` not being the only function with INSERT privilege at `EXPLAIN ANALYZE` time.

**Phase to address:** Phase 1 (schema + ledger core) — before any API or worker code exists.

---

### Pitfall 2: Deferred Constraint Silent Disabling

**What goes wrong:**
`SET CONSTRAINTS ALL IMMEDIATE` (or per-constraint immediate override) inside a migration or test helper disables the deferral mechanism. The constraint fires immediately, making individual posting inserts fail rather than validating the whole transaction at COMMIT. Developer "fixes" this by removing the deferral or disabling the constraint entirely for tests.

**Why it happens:**
Migration libraries sometimes run each DDL statement in its own transaction. Drizzle's migration runner may or may not preserve `DEFERRABLE INITIALLY DEFERRED` semantics correctly across all environments. Tests that seed data with individual postings hit the constraint and the workaround is to disable it.

**How to avoid:**
- Never use `SET CONSTRAINTS ALL IMMEDIATE` anywhere in application code.
- Test the constraint explicitly: seed a transaction with two postings that sum to zero — passes. Seed one that doesn't — assert the COMMIT fails with `check_violation`.
- Verify after every migration run that `pg_constraint` still shows the constraint as `DEFERRABLE` and `DEFERRED` (query `pg_constraint.condeferrable + condeferred`).
- Seed helpers must call `post_transaction`, never insert postings directly.

**Warning signs:**
- Migration diff shows `NOT DEFERRABLE` or `INITIALLY IMMEDIATE` for the balancing constraint.
- Test helpers that call `SET CONSTRAINTS` before seeding.
- The word "disable" near any constraint in git history touching `postings`.

**Phase to address:** Phase 1 (schema), verified in Phase 2 (API + worker tests).

---

### Pitfall 3: Idempotency Race on First-Time Insert

**What goes wrong:**
Two concurrent requests arrive with the same `Idempotency-Key`. Both read "not exists" before either commits. Both attempt INSERT. One wins (UNIQUE constraint), the other gets a conflict error and returns 409 or 500 instead of the identical 200 response. The client retries, now getting inconsistent behavior.

**Why it happens:**
The standard pattern is `SELECT → if not found → INSERT`. Under SERIALIZABLE isolation, a serialization failure (`40001`) may abort one of them. But if the retry logic re-reads and finds the committed row, it needs to return it — not start a new transaction. Many implementations don't handle this "read after conflict" path.

**How to avoid:**
- Use `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING *` + a subsequent SELECT if RETURNING is empty. Single round-trip, no race.
- Retry handler for `40001` must re-read the existing row and return it, not re-execute the business logic.
- Write an explicit concurrent test: two Promises hit `POST /transactions` with the same key simultaneously — assert both return 200 and identical bodies.

**Warning signs:**
- 409 or 5xx responses appearing for requests with repeated `Idempotency-Key` in logs.
- Error tracking shows `UniqueViolationError` bubbling to the HTTP layer.
- No concurrent idempotency test in the test suite (the most common gap).

**Phase to address:** Phase 2 (API), tested explicitly before any worker that also writes transactions.

---

### Pitfall 4: Exact-Once Broken — Enqueue Outside the Ledger Transaction

**What goes wrong:**
The webhook handler does: `BEGIN → INSERT raw_events → COMMIT → boss.send('process-webhook', ...)`. The job is enqueued after the transaction commits. If the process crashes between COMMIT and `boss.send`, the raw_event exists but no job ever runs. The event is silently lost.

The inverse also happens: `boss.send` succeeds, then the outer transaction rolls back. Now a job runs for an event that doesn't exist in `raw_events`, causing the worker to crash or produce phantom postings.

**Why it happens:**
pg-boss transactional API (`boss.send(..., { db: txClient })`) is non-obvious. Most documentation shows the fire-and-forget pattern. Developers unfamiliar with pg-boss v8+ transactional send use the simpler API.

**How to avoid:**
- `boss.send` must always receive `{ db: txClient }` where `txClient` is the active Postgres connection inside the same transaction that inserts into `raw_events`.
- Write a test: mock `boss.send` to throw after `raw_events` INSERT — assert the event is NOT in `raw_events` (transaction rolled back). Mock commit to succeed but `boss.send` to crash — assert the event IS in `raw_events` AND a job exists.
- CI check: grep for `boss.send(` not followed by `db:` in the webhooks package — lint rule or custom ESLint plugin.

**Warning signs:**
- `raw_events` rows with no corresponding `process-webhook` job in `pgboss.job`.
- pg-boss `failed` jobs referencing `provider_event_id` that don't exist in `raw_events`.
- Any code comment mentioning "enqueue after save."

**Phase to address:** Phase 3 (webhook ingestion) — this is the single most dangerous implementation detail.

---

### Pitfall 5: SERIALIZABLE 40001 Retry Inside an Already-Open Transaction

**What goes wrong:**
Retry logic catches `40001` and calls the business function again — but that function is called inside a `BEGIN` that was started before the error. Postgres has already aborted the transaction at the point of `40001`; every subsequent query in that connection returns `25P02 (in_aborted_transaction_block)`. The retry executes against the dead transaction and either fails or (worse) silently no-ops.

**Why it happens:**
Developers wrap the retry in a `try/catch` inside the transaction block rather than wrapping the entire `BEGIN ... COMMIT` in the retry loop. This is especially common when Drizzle or a connection pool abstracts the transaction boundary.

**How to avoid:**
- Retry loop must be outside the transaction: `for (let attempt = 0; attempt < 3; attempt++) { await db.transaction(async tx => { ... }) }`.
- Custom `withSerializableRetry(fn, maxAttempts)` helper in `@aprumo/core/db` — used everywhere, never rolled inline.
- Test: force `40001` by injecting a mock that throws `serialization_failure` on first call, passes on second — assert the outer result is correct and only two DB transactions were opened.

**Warning signs:**
- `25P02` errors in logs (in_aborted_transaction_block) — means retries are happening inside a dead transaction.
- Retry loops that wrap `db.execute` directly rather than `db.transaction`.
- Retry counter never incrementing (retry fires but silently no-ops due to aborted tx).

**Phase to address:** Phase 2 (core API) — the retry helper must exist before any ledger-writing endpoint.

---

### Pitfall 6: Money Precision Loss via JSON Number Type

**What goes wrong:**
`amount_cents` is `BIGINT` in Postgres. Node's `pg` driver returns BIGINT as a JavaScript string by default (to avoid the 53-bit limit), but many ORMs and query builders silently cast it to `Number`. An amount like `R$ 92,233,720.37` (9223372037 cents) exceeds `Number.MAX_SAFE_INTEGER` (9007199254740991 cents = ~R$ 90T). Below MAX_SAFE_INTEGER but above practical thresholds, rounding is silent.

The second failure mode: Fastify's JSON serializer calls `JSON.stringify` on the response object. BigInt throws `TypeError: Do not know how to serialize a BigInt`. Developer "fixes" this by converting BigInt to Number — losing precision silently for large amounts.

**Why it happens:**
The 53-bit limit is not intuitive. R$ 90 trillion sounds far away. But amounts like R$ 1,000,000,000 (1 billion reais = 100 billion cents = 1e11) are representable by a 37-bit integer — safe. The real danger is when amounts compound (running totals, aggregated balances) or when someone stores fractions (0.01 cents rounds silently).

**How to avoid:**
- Drizzle schema: declare `amount_cents` as `bigint('amount_cents', { mode: 'bigint' })` — returns native BigInt.
- Fastify serializer: register a custom JSON serializer that converts BigInt to string before sending.
- API contract: `amount_cents` is always a string in the JSON API. Clients parse it. Document this explicitly.
- Lint rule: ban `Number(x)` and `parseInt(x)` when `x` is typed as `bigint`.
- Test: insert `MAX_SAFE_INTEGER + 1` cents, retrieve via API, assert string representation matches exactly.

**Warning signs:**
- `amount_cents` typed as `number` anywhere in TypeScript interfaces.
- `JSON.parse` called on a response that has `amount_cents` without a BigInt reviver.
- Drizzle inferred type showing `number` for `amount_cents` columns.
- Any use of floating-point operations (`* 0.01`, `/ 100`) on amounts in code.

**Phase to address:** Phase 1 (schema + types) — the `Money` type in `@aprumo/connector-base` must wrap BigInt from day one.

---

### Pitfall 7: Starkbank Webhook Signature Verification Timing Attack and Replay

**What goes wrong:**
(a) Signature is verified with a simple string comparison instead of `crypto.timingSafeEqual` — opens a timing side-channel attack. (b) No timestamp validation — replayed webhook from 3 days ago passes signature check and re-inserts a raw_event if the idempotency guard fails for any reason. (c) Public key is fetched live from Starkbank's `/v2/public-key` on every request — if Starkbank is down, all webhooks fail; if the DNS is poisoned, attackers can substitute a key.

**Why it happens:**
`timingSafeEqual` requires buffers of equal length — easy to get wrong. Timestamp validation requires agreeing on tolerance (Starkbank uses timestamps in the signature payload). Public key caching is an operational consideration that gets deferred.

**How to avoid:**
- Use `crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual))` — the `signWebhook/verifyWebhook` helper in `@aprumo/connector-base` must enforce this.
- Reject events older than 5 minutes (configurable). Parse the timestamp from the signed payload, compare to server UTC now.
- Cache the Starkbank public key in memory at startup, refresh on schedule (1h TTL), never fetch per-request. Fail closed (reject) if cache is stale and refresh fails.
- Test: replay a valid webhook with a timestamp 10 minutes old — assert 400 rejection.

**Warning signs:**
- `signature === computed` anywhere in code (string equality for HMAC/signature comparison).
- No timestamp field being validated in webhook processing.
- HTTP call to Starkbank public key endpoint inside the webhook handler hot path (visible in traces).

**Phase to address:** Phase 3 (connector-starkbank + webhooks package).

---

### Pitfall 8: Functionally Duplicate Events with Different provider_event_id

**What goes wrong:**
Starkbank (and many PSPs) may send two logically identical events with different IDs: a PIX payment confirmed at the millisecond boundary between their retry batches, or a boleto partial payment followed by a "complete" event that duplicates the initial amount in different event types. Both pass the UNIQUE `(provider, provider_event_id)` check, both get inserted into `raw_events`, both get processed, and the ledger gets double-posted.

**Why it happens:**
The idempotency guard operates on event identity, not business semantics. The UNIQUE constraint is correct for deduplication, but business deduplication requires understanding event semantics.

**How to avoid:**
- Define explicit event-type semantics in the reconciliation worker: for each `NormalizedEvent.type`, specify which fields constitute a "business duplicate" and check before posting. Example: for `charge.paid`, check if a `charge.id` already has a committed `charge.paid` posting.
- Maintain a `event_business_key` in `raw_events` (nullable) derived from business identifiers — add UNIQUE constraint only for event types where business semantics demand it.
- Test: send two `raw_events` with different IDs but same `charge.id` + same event type — assert only one `post_transaction` is called.

**Warning signs:**
- Account balance growing beyond the expected max (detecting over-posting requires reconciliation).
- Duplicate `charge_id` values across two `raw_events` rows for the same event type in queries.
- Boleto events arriving in pairs (partial + complete) without deduplication logic.

**Phase to address:** Phase 3 (webhook worker + reconciliation logic) — design the reconciliation mapping before implementing event types.

---

### Pitfall 9: pg-boss Table Bloat and Vacuum Starvation

**What goes wrong:**
`pgboss.job` is a high-churn table: every job cycle (insert, state updates, delete/archive) creates dead tuples. At 50 webhook events/second, the job table sees 150+ row versions per second. Autovacuum defaults are tuned for OLTP tables, not queue tables. Within weeks, the table bloats to gigabytes, index scans slow down, and SKIP LOCKED begins wasting cycles scanning dead tuples.

**Why it happens:**
Postgres MVCC creates a new tuple version on every UPDATE. pg-boss transitions jobs through states (created → active → completed). Each transition is an UPDATE. Autovacuum's default `autovacuum_vacuum_scale_factor = 0.2` means vacuum waits until 20% of the table is dead — at high churn, this threshold is always exceeded and vacuum never completes before new dead tuples accumulate.

**How to avoid:**
- Set per-table storage parameters: `ALTER TABLE pgboss.job SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_vacuum_cost_delay = 2)`.
- Configure pg-boss `archiveCompletedAfterSeconds` and `deleteAfterDays` aggressively (e.g., archive after 1 hour, delete after 7 days).
- Monitor `pg_stat_user_tables` for `n_dead_tup` on `pgboss.job` — alert if > 100k.
- Schedule `VACUUM ANALYZE pgboss.job` explicitly in a low-traffic window if autovacuum can't keep up.

**Warning signs:**
- `pgboss.job` table size in `pg_relation_size` growing faster than job throughput suggests.
- `n_dead_tup` in `pg_stat_user_tables` for `pgboss.job` exceeding `n_live_tup`.
- Worker poll latency increasing over days (not hours) in Prometheus metrics.
- `autovacuum: VACUUM public.pgboss_job (to prevent wraparound)` appearing in PG logs.

**Phase to address:** Phase 1 (dev environment + DB setup) — add autovacuum tuning to the initial migration/docker-compose. Verify in Phase 3 under load.

---

### Pitfall 10: Abstraction Leak — First Connector Concepts Bleeding into Core

**What goes wrong:**
While building the Starkbank connector, the developer adds a `starkbank_charge_id` column to `transactions`, or models `NormalizedEvent` with a `pixEndToEndId` field that only PIX has, or adds a `boleto_expiry_date` to the account metadata type. Core starts depending on PSP-specific concepts. When AbacatePay arrives in v0.5, these assumptions break and require a core migration — breaking API consumers.

**Why it happens:**
The connector is built first and the boundary feels theoretical until a second connector reveals which assumptions were wrong. Building alone without a second PSP to test the abstraction makes it easy to miss.

**How to avoid:**
- `@aprumo/core` must have zero `import` from any connector package — enforced by pnpm workspace dependency graph (core does not depend on connector-starkbank).
- `NormalizedEvent` in `@aprumo/connector-base` uses only canonical fields. All PSP-specific data lives in `metadata: Record<string, unknown>` — typed via generics in the connector, opaque in core.
- Before merging the Starkbank connector, write a stub `FakeConnector` that implements `LedgerConnector` with completely different field semantics — verify core processes it without modification.
- Contract test suite explicitly tests that `NormalizedEvent` fields are only the canonical ones (using TypeScript `Exact<>` type assertion or Zod schema).

**Warning signs:**
- Any `import` in `packages/core/` referencing `packages/connector-starkbank/`.
- `NormalizedEvent` gaining a field that is undefined/null for non-Starkbank events.
- A migration for `transactions` or `postings` that references Starkbank in the migration name or comment.
- The word "PIX" or "boleto" appearing in `packages/core/` TypeScript files (lint rule).

**Phase to address:** Phase 2 (connector-base design) must finalize `NormalizedEvent` before Phase 3 (connector-starkbank) touches core.

---

### Pitfall 11: Secrets Accidentally Committed — Starkbank Private Key

**What goes wrong:**
Starkbank authentication uses ECDSA private keys (P-256). The developer generates the key pair, copies the private key to `.env` for local testing, and at some point commits `.env` or pastes the key into `config.ts` to "test something quickly." The repo is public (MIT OSS). The key is now compromised and all Starkbank API calls can be forged.

**Why it happens:**
Private key material looks like a multi-line PEM string, easy to mistake for a certificate or non-sensitive config. `.env` files are commonly forgotten in `.gitignore` edits.

**How to avoid:**
- `.gitignore` must include `.env`, `.env.*`, `*.pem`, `*.key`, `*.p8` — added before the first commit, never amended later.
- Add a pre-commit hook (via lefthook or husky) that runs `git secrets` or `trufflesecurity/detect-secrets` on every commit.
- Starkbank private key never lives in the repository in any form — not in config, not in test fixtures, not as a constant.
- Tests use the Starkbank sandbox environment with a separate key pair generated for CI, injected via GitHub Actions secrets.
- If a key is ever committed: rotate immediately (generate new Starkbank key pair, revoke old one in the dashboard), then use `git filter-repo` to purge it from history, then force-push.

**Warning signs:**
- Lines starting with `-----BEGIN EC PRIVATE KEY-----` in any committed file.
- `STARKBANK_PRIVATE_KEY=` appearing in any committed file.
- `git log --all -p | grep "BEGIN"` returning results.

**Phase to address:** Phase 0 (pre-v0.1 setup) — `.gitignore` and pre-commit hooks before any key is ever generated.

---

### Pitfall 12: LGPD/PCI — Logging Raw Webhook Payloads Containing CPF or PAN Tokens

**What goes wrong:**
A webhook payload from Starkbank for a payment event includes the payer's CPF (taxpayer ID), name, and bank account details. The developer adds `logger.debug({ payload })` in the webhook handler for debugging. In production with structured logging, this PII flows into the log aggregator, retention is indefinite by default, and the team doesn't realize it.

PCI risk: some webhook payloads include tokenized card data or partial PANs in certain events. Even partial PANs increase PCI scope.

**Why it happens:**
Debug logging is added during development and never removed. `pino`'s `redact` config is set up for known fields but the webhook payload structure is not fully known upfront. LGPD compliance feels abstract until a breach occurs.

**How to avoid:**
- `pino` `redact` config must include paths for known PII: `['payload.document', 'payload.cpf', 'payload.name', 'payload.taxId', 'payload.holderName']` — and more broadly `['payload']` if the entire payload is opaque.
- Log only: provider, event_id, event_type, received_at. Never log the payload body in production.
- LGPD retention policy: log retention ≤ 90 days (align with legal basis and ANPD guidance). Configure at the log aggregator level before onboarding design partners.
- CI check: grep for `logger.*payload` in webhooks package — fail if found without explicit `LGPD-safe` comment.
- Store raw payload in `raw_events.payload_jsonb` — this is intentional and lawful (processing legal basis). Logs are not the right place.

**Warning signs:**
- `pino` logs containing `cpf`, `document`, `holderName`, `taxId` fields in structured output.
- Log volume per webhook event exceeding ~200 bytes (suggests full payload is being logged).
- No `redact` configuration in `pino` options.
- Log retention set to "never" or "forever" in the log aggregator.

**Phase to address:** Phase 3 (webhook ingestion) — `redact` config and logging policy must be in place before design partners send real events.

---

### Pitfall 13: TDD Anti-Pattern — Mocking Postgres in Ledger Tests

**What goes wrong:**
Developer mocks the database layer in tests for `post_transaction` and the idempotency logic: `vi.mock('../db', () => ({ execute: vi.fn().mockResolvedValue(...) }))`. Tests pass with a mock that always returns success. The actual constraint logic, SERIALIZABLE behavior, role permissions, and deferred constraint firing are never exercised. A bug in `post_transaction.sql` ships to production because the test never talked to a real database.

**Why it happens:**
Testcontainers adds ~10 seconds to the first test run. Mocks are instant. The developer optimizes for speed and mocks "just the DB" thinking the logic is what matters.

**How to avoid:**
- CLAUDE.md rule: "Não use mocks no caminho do PG do ledger" — codify this as a Vitest rule in `packages/core/vitest.config.ts` that bans `vi.mock` for any file in `db/`.
- Shared Postgres testcontainer with per-test transaction rollback (seed once, rollback after each test — fast and clean).
- Only mock the HTTP layer of external PSPs (use MSW or nock for Starkbank HTTP calls).
- Code review rule: any `vi.mock` touching a DB module in `@aprumo/core` is an automatic request-for-changes.

**Warning signs:**
- `vi.mock` appearing in `packages/core/` test files for any import from `./db` or `./pg`.
- Test suite for `post_transaction` runs in < 1 second (no container startup means no real DB).
- Coverage at 95% but the balance divergence alert has never been triggered in tests.

**Phase to address:** Phase 1 (test infrastructure) — testcontainer setup must exist before the first `post_transaction` test.

---

### Pitfall 14: Schema Drift Between Local Dev and CI

**What goes wrong:**
Developer runs `pnpm db:reset` locally, which re-runs all migrations. A migration file is edited after being run (common during rapid iteration in pre-alpha). Local DB reflects the edited migration. CI creates a fresh container and runs migrations in file-system order — but the old migration file is still present with the original content. CI uses a different schema than local. Tests pass locally, fail in CI (or worse: pass in CI against a wrong schema).

**Why it happens:**
Drizzle migrations are files. Editing a migration that was already run is tempting when you notice a small error. Drizzle doesn't enforce immutability of applied migrations by default (it uses a hash, but only if you configure it that way).

**How to avoid:**
- Never edit a migration file after it has been committed. Always add a new migration.
- Drizzle `meta/_journal.json` locks applied migration hashes — CI must verify this hash matches on every run. If hash mismatch: fail loudly.
- `pnpm db:reset` in local dev is acceptable only because it destroys the entire DB. CI always starts fresh.
- Add a test that applies migrations from scratch to a clean Postgres container and runs the full test suite — this is the regression test for migration ordering.

**Warning signs:**
- Git diff showing changes to an existing migration file (not a new one).
- CI migration step passing but subsequent tests failing with "column does not exist."
- Developer running `pnpm db:reset` more than once per feature branch.

**Phase to address:** Phase 1 (DB setup and migration tooling) — migration discipline must be established before writing any migration.

---

### Pitfall 15: Solo Developer Productivity Trap — Yak-Shaving Before v0.1

**What goes wrong:**
The developer spends weeks on: INPI trademark research, domain registrations, GitHub org setup, branding wordmark iterations, writing all 8 ADRs before writing code, perfecting the CONTRIBUTING.md, and setting up release automation — before writing a single migration or test. v0.1 never ships. Design partners lose interest. The window for early adopters closes.

**Why it happens:**
Each pre-v0.1 task feels important (and most are). The psychological safety of "doing setup correctly" is higher than shipping code that might have bugs. OSS projects have a lot of visible ceremony. Solo developers with high standards can loop indefinitely on setup.

**How to avoid:**
- Explicit scope boundary in PROJECT.md (already present): "brand/INPI/domains fora do escopo GSD."
- Time-box setup tasks: commit to spending no more than 2 days on brand/infra before writing the first migration.
- The definition of "v0.1 shipped" is: `@aprumo/core@0.1.0` published on npm, one design partner running it locally against a real Starkbank sandbox account.
- Weekly self-check: "Is there code that runs today that didn't run last week?" If no: escalate urgency.
- Fake design partner pressure: write the outreach email to potential design partners now, before v0.1 is done. The commitment makes the deadline real.

**Warning signs:**
- Git log shows only `chore:` and `docs:` commits for more than 5 consecutive days.
- All tasks in "Pré-v0.1" section of Tarefas are complete but no migration file exists.
- ADR count > 5 but `packages/core/migrations/` is empty.

**Phase to address:** Phase 0 (pre-v0.1) — bake the "ship first" constraint into the phase definition and success criteria.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Mock Postgres in unit tests | Tests run in 50ms | Deferred constraints, role permissions, serialization failures never tested — bugs reach prod | Never in `@aprumo/core` ledger path |
| `amount_cents` as `number` in TypeScript types | No BigInt boilerplate | Silent precision loss for large amounts (>R$90T per transaction is unlikely, but running balances can approach) | Never |
| Skip `Idempotency-Key` on internal API calls | Simpler internal contracts | Worker retries after `40001` create duplicate transactions | Never on any ledger-writing endpoint |
| Hardcode Starkbank event-type mapping in core | Faster v0.1 | Makes second connector painful — core has implicit PSP knowledge | Never |
| Log full webhook payload in dev | Easy debugging | Team habit of full-payload logging stays in prod | Dev-only, behind `NODE_ENV !== 'production'` guard |
| Single Postgres connection in worker | Simple connection management | Under concurrency, workers block each other; connection pool exhaustion | Never in production; acceptable in local dev only |
| Skip deferred constraint, validate in application | Avoids SQL complexity | Application bypass possible; constraint is the last line of defense | Never |
| Publish `@aprumo/core` with `*` version for workspace deps | Simple monorepo setup | Consumers get unpinned deps; breaking changes in connector-base break core consumers silently | Never in published packages |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Starkbank SDK | Import the Node SDK and use it without pinning the version | Pin to `starkbank@2.x` in package.json; SDK major versions change authentication flow |
| Starkbank webhook | Compare `Digital-Signature` header with `===` | Use `crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))` |
| Starkbank public key | Fetch `/v2/public-key` on every request | Cache at startup, refresh every 1 hour, fail closed if stale |
| Starkbank PIX | Assume every PIX event has a unique `id` per business event | PIX confirmations can arrive multiple times for same transaction with different event IDs (retry behavior) |
| pg-boss v8+ | Use `boss.send(name, data)` without `db` option | Use `boss.send(name, data, { db: txClient })` inside the ledger transaction |
| pg-boss schema | Assume `pgboss.*` tables are read-only during pg-boss version upgrade | pg-boss auto-migrates its own schema — ensure this runs before workers start after an upgrade |
| Drizzle BigInt | Use `int` column type for `amount_cents` | Use `bigint('amount_cents', { mode: 'bigint' })` — returns native BigInt |
| Fastify JSON | Let Fastify serialize BigInt with default serializer | Register a custom JSON serializer that converts BigInt to string in responses |
| pino redact | Set redact paths for known PII fields only | Use `['payload', '*.payload', '*.*.payload']` glob pattern to catch all nested payload positions |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full-table scan on `postings` for account extract | Extract queries take seconds; CPU spikes on PG | Composite index `(account_id, id DESC)` on `postings` from migration 1 | First account with >10k postings |
| Missing index on `raw_events (provider, received_at)` | Reconciliation worker does full scan to find unprocessed events | Add index; reconciliation should query by `reconciled_at IS NULL` with partial index | First day of production ingestion |
| Balance worker using `SELECT * FROM postings` instead of delta | Worker runs O(N) over all postings every cycle | Cursor pattern: `WHERE id > last_processed_id ORDER BY id LIMIT batch_size` | ~100k postings |
| Connection pool too small for SERIALIZABLE workload | 40001 errors spike; connections queue; p99 latency explodes | Size pool to `(worker_count + api_workers) * 1.5`; use separate pools for read and write | 50+ concurrent API clients |
| JSONB `payload_jsonb` without GIN index | Queries filtering by event type inside payload are slow | Index specific JSONB paths or add `event_type` as a dedicated column | First reconciliation query that needs to filter by event type |
| pg-boss polling interval too low (< 1s) | Polling queries dominate PG CPU at rest | Set `newJobCheckInterval` to 2000ms; use `onComplete` hooks where possible | Idle systems where polling overhead > job processing overhead |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Starkbank private key in `.env` committed to repo | Full API access compromise; irreversible until key rotated | `.gitignore` + pre-commit secret scanning + CI secret detection |
| Webhook endpoint accessible without signature verification | Attacker can inject arbitrary events, creating fraudulent postings | Signature check is the first operation in the handler, before any DB write |
| `aprumo_app` role granted UPDATE on `postings` | Rogue code or compromised dependency can mutate ledger history | `REVOKE UPDATE, DELETE ON postings, raw_events FROM aprumo_app` in migration — not revocable without new migration |
| Outbound webhook signed with predictable or weak secret | Consumers' systems accept forged events | Require secrets >= 32 bytes of entropy; document minimum length; reject short secrets at registration |
| Raw CPF or name stored in `transactions.description` | LGPD violation; PII in immutable append-only table is undeletable | Validate `description` field at API boundary — reject if it matches CPF regex pattern |
| PAN token from Starkbank stored in `postings.metadata` | PCI scope expansion from SAQ-A to SAQ-D | `metadata` schema in connector validates no PAN-shaped strings; add regex check in contract tests |

---

## "Looks Done But Isn't" Checklist

- [ ] **Double-entry constraint:** The deferred constraint is configured AND tested to fire correctly at COMMIT — verify `pg_constraint.condeferrable = true AND condeferred = true` in CI.
- [ ] **Idempotency under concurrency:** Two simultaneous requests with the same key both return 200 with identical response — tested with `Promise.all`, not sequentially.
- [ ] **Exact-once webhook:** A crash between `raw_events` INSERT and pg-boss enqueue leaves NO orphaned raw_event without a job — tested by injecting a crash mock.
- [ ] **40001 retry:** Retry loop wraps the entire transaction, not just the failing query — tested by mocking `serialization_failure` on first attempt.
- [ ] **BigInt serialization:** `amount_cents` arrives as a string in the JSON API response — verified with an automated assertion, not eyeballed.
- [ ] **Role permissions:** `aprumo_app` cannot `UPDATE` or `DELETE` from `postings` and `raw_events` — tested by attempting these operations and asserting permission error.
- [ ] **Webhook signature:** Replayed webhook with old timestamp is rejected — tested with a timestamp > 5 minutes in the past.
- [ ] **PII in logs:** Pino `redact` covers all payload paths — tested by asserting `cpf`, `document`, `holderName` never appear in structured log output during webhook processing.
- [ ] **Abstraction boundary:** `packages/core/` has no direct import from `packages/connector-starkbank/` — verified by `pnpm why` or a CI dependency graph check.
- [ ] **Migration immutability:** CI fails if any committed migration file's content differs from what was applied — Drizzle hash check.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-entry violation discovered in production | HIGH | (1) Identify unbalanced transaction_ids via `GROUP BY` query. (2) Create correction transactions (new postings, never update). (3) Audit how the bypass happened. (4) Fix the code path. (5) Add regression test. |
| Orphaned raw_event (no job) | LOW | Admin endpoint `POST /admin/raw-events/:id/replay` enqueues the job manually. Add a scheduled job that detects raw_events without a matching pgboss.job and re-enqueues. |
| Private key committed to git | CRITICAL | (1) Rotate key in Starkbank dashboard immediately. (2) `git filter-repo --invert-paths --path .env` to purge from history. (3) Force-push (warn contributors). (4) Audit whether key was used maliciously (Starkbank dashboard logs). |
| PII in logs discovered | HIGH | (1) Purge affected log indices from aggregator. (2) Add LGPD-required breach notification if CPF/name of data subjects was exposed to unauthorized parties. (3) Fix `redact` config immediately. (4) ANPD notification if breach threshold met. |
| pg-boss table bloat causing slowdown | MEDIUM | `VACUUM FULL pgboss.job` (takes exclusive lock — schedule in maintenance window). Then add autovacuum overrides. Longer term: partition the job table or increase `deleteAfterDays` aggressiveness. |
| Schema drift between local and CI | LOW | (1) Identify which migration was edited post-commit. (2) Create a new corrective migration. (3) Never edit applied migrations again — write new ADR-style note if tempted. |
| Functionally duplicate posting (double-spend) | HIGH | (1) Identify the duplicate transactions via business key query. (2) Create reversal transactions (new postings that net to zero against the duplicates). (3) Add business-key deduplication logic to reconciliation worker. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Double-entry bypass via direct INSERT | Phase 1: Schema + ledger core | `aprumo_app` INSERT permission test green |
| Deferred constraint disabled | Phase 1: Schema | `pg_constraint` query in CI asserts `condeferrable AND condeferred` |
| Idempotency race on first insert | Phase 2: Core API | Concurrent `Promise.all` test both return 200 with same body |
| Exact-once broken (enqueue outside tx) | Phase 3: Webhook ingestion | Crash-injection test: no orphaned raw_event |
| 40001 retry inside dead transaction | Phase 2: Core API (retry helper) | Mock serialization_failure test passes on 2nd attempt |
| Money precision loss (BigInt/JSON) | Phase 1: Types + schema | `amount_cents` typed as BigInt, API returns string, test with >MAX_SAFE_INTEGER |
| Starkbank signature timing attack | Phase 3: Connector-starkbank | `timingSafeEqual` in code review + replay attack test |
| Functionally duplicate events | Phase 3: Reconciliation worker | Business-key deduplication test: same charge, two event IDs → one posting |
| pg-boss table bloat | Phase 1: Dev env (autovacuum config) | `n_dead_tup` monitoring from day 1 |
| Abstraction leak from connector into core | Phase 2: connector-base design | Dependency graph CI check: core has no connector-starkbank import |
| Secrets committed | Phase 0: Pre-v0.1 setup | `.gitignore` + pre-commit hook before any key generated |
| LGPD PII in logs | Phase 3: Webhook ingestion | Pino `redact` test: no CPF/name in log output |
| TDD anti-pattern: mocking Postgres | Phase 1: Test infrastructure | Testcontainer shared setup + lint rule banning `vi.mock` on DB modules |
| Schema drift local/CI | Phase 1: DB tooling | Drizzle hash check in CI migration step |
| Solo dev yak-shaving | Phase 0: Pre-v0.1 setup | Time-box of 2 days; first migration file in git by day 3 |

---

## Sources

- PostgreSQL documentation: [Serialization Failure Handling](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html) — official guidance on retry semantics
- [Solving the Five Most Common Pitfalls from Building a Payments Ledger](https://medium.com/slope-stories/solving-the-five-most-common-pitfalls-from-building-a-payments-ledger-0afe1a6eceae) — industry post-mortem (Slope)
- [Potential Consequences of Using Postgres as a Job Queue](https://richyen.com/postgres/2026/05/04/postgres_job_queue.html) — bloat and MultiXact contention analysis
- [Knex.js + pg-boss transactional pattern](https://hyeomans.com/posts/how-i-use-a-knexjs-pgboss-transaction-to-keep-api-writes-and-jobs-consistent/) — exact-once enqueue pattern
- [pg-boss GitHub README](https://github.com/timgit/pg-boss) — official transactional send API documentation
- [MDN: BigInt not serializable in JSON](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/BigInt_not_serializable) — BigInt/JSON serialization behavior
- [HackerOne: Safely Handling Large Integers in JSON](https://www.hackerone.com/blog/safely-handling-large-integers-json-best-practices-and-pitfalls) — 53-bit limit analysis
- [Starkbank Node.js SDK](https://github.com/starkbank/sdk-node) — `Digital-Signature` header, public key endpoint
- [LGPD Compliance requirements](https://secureprivacy.ai/blog/lgpd-compliance-requirements) — Brazilian data protection obligations
- CLAUDE.md invariants and LGPD constraints (project-specific)
- PRD.md §6 (NFRs), §11 (risks and mitigations)

---
*Pitfalls research for: Aprumo — financial double-entry ledger, agnostic-PSP, Brazilian SaaS*
*Researched: 2026-05-18*
