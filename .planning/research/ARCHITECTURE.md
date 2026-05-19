# Architecture Research

**Domain:** Financial ledger (double-entry, append-only) with pluggable PSP connectors
**Researched:** 2026-05-18
**Confidence:** HIGH — architecture already defined in PRD; research validates and deepens each dimension

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          INBOUND SURFACE                                 │
│  ┌──────────────────────────┐   ┌──────────────────────────────────────┐ │
│  │   REST API (Fastify)     │   │  Webhook Ingestion (Fastify)         │ │
│  │  POST /transactions      │   │  POST /webhooks/:provider            │ │
│  │  POST /accounts          │   │  @aprumo/webhooks                    │ │
│  │  GET  /accounts/:id      │   └──────────────┬───────────────────────┘ │
│  │  GET  /health            │                  │                          │
│  └──────────────┬───────────┘                  │ connector registry       │
├─────────────────┼──────────────────────────────┼──────────────────────────┤
│                 │       @aprumo/core            │                          │
│    ┌────────────▼─────────────────────────────▼────────────────────┐     │
│    │              post_transaction(postings[])  — SQL function       │     │
│    │  BEGIN SERIALIZABLE … validate sum=0 … INSERT tx+postings …    │     │
│    │  … fromDrizzle(tx, sql) boss.send('process-webhook') … COMMIT  │     │
│    └───────────────────────────────────┬────────────────────────────┘     │
│                                        │ pg-boss queue                     │
├────────────────────────────────────────┼──────────────────────────────────┤
│                  WORKERS               │                                   │
│  ┌──────────────────┐  ┌──────────────▼──────┐  ┌─────────────────────┐  │
│  │  balance-worker  │  │  process-webhook    │  │  outbound-dispatcher│  │
│  │  (incremental    │  │  (applies postings  │  │  (HMAC, retry,      │  │
│  │   account_balance│  │   from raw_events)  │  │   dead-letter)      │  │
│  │   SELECT FOR UPD)│  │                     │  │                     │  │
│  └────────┬─────────┘  └──────────┬──────────┘  └──────────┬──────────┘  │
├───────────┼────────────────────────┼──────────────────────────┼────────────┤
│           │          POSTGRES 16+ (single DB)                 │            │
│  ┌────────▼──────────────────────────────────────────────────▼────────┐   │
│  │  accounts  transactions  postings(append-only)  raw_events(A-O)    │   │
│  │  account_balance  outbound_endpoints  outbound_events  *_audit     │   │
│  │  pgboss.*  (job queue tables live in same DB, schema pgboss)       │   │
│  └────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘

External:
  PSP (Starkbank) ←──→ connector-starkbank (MSW in tests)
  Customer systems ←── outbound webhooks (HMAC signed)
```

---

## Component Boundaries

| Package | Responsibility | Knows About | Does NOT Know About |
|---------|---------------|-------------|---------------------|
| `@aprumo/core` | Schema DDL, `post_transaction` SQL fn, REST API, balance worker, reconcile worker | Postgres, pg-boss, Drizzle, Fastify | Specific connectors, webhook ingestion routing |
| `@aprumo/connector-base` | `LedgerConnector` interface, shared types (`Money`, `NormalizedEvent`, `PaymentRef`, `WithdrawalRef`), HMAC helpers, contract test suite | TypeScript types only | Any PSP, any DB |
| `@aprumo/connector-starkbank` | Starkbank HTTP client, `parseWebhook`, `createPayment`, `getBalance`, `withdraw`, error mapping | `@aprumo/connector-base`, Starkbank SDK | `@aprumo/core`, `@aprumo/webhooks` |
| `@aprumo/webhooks` | Inbound webhook endpoint, connector registry, outbound dispatcher worker | `@aprumo/core` (via PG/boss), `@aprumo/connector-base`, registered connectors | Internal ledger logic (uses `post_transaction` through the queue, never directly) |

**Key rule:** `core` has zero import-time dependency on any connector. Connectors are registered in `webhooks` at boot time via a registry map `Record<string, LedgerConnector>`. This is the only place connector packages appear together.

---

## Package Dependency Graph

```
@aprumo/connector-base   (no deps on other aprumo packages)
         ↑
@aprumo/connector-starkbank   peerDep: connector-base ^x.0.0
         ↑
@aprumo/webhooks  ← imports connector-base (registry typing) + connector-starkbank (registered instance)
         |
         ↓ (via DB / pg-boss, not import)
@aprumo/core   (no import dep on webhooks or connectors)
```

`webhooks` is the only package with coupling to both `core` (shared DB/pg-boss connection) and connectors. That coupling is by design and is acceptable — it is the orchestration boundary.

---

## Component Boundary Validation

**Q: Should `webhooks` live inside `core`?**

No. Keep it separate. Reasons:

1. `core` is the ledger primitive — it should be publishable as a library that any app could embed without webhook infrastructure. Merging `webhooks` into `core` makes it impossible to use the ledger without also deploying a webhook listener.
2. The connector registry lives in `webhooks`. If it lived in `core`, `core` would need to import connector packages, destroying the clean dependency boundary.
3. `webhooks` has distinct operational concerns (inbound HTTP auth, signature verification, outbound retry policy) that benefit from independent versioning.
4. Risk: `webhooks` currently shares the DB connection pool and pg-boss instance with `core`. In a single-process deploy (expected for MVP), these are passed as constructor arguments. This is a coupling at the runtime layer, not the module layer — acceptable.

**Q: Should `connector-base` export the contract test suite as a runnable sub-package?**

Yes, with the `/contract` entrypoint pattern. In `package.json` exports:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./contract": "./dist/contract/index.js"
  }
}
```

The contract suite exports a `runContractSuite(connector: LedgerConnector, opts: ContractSuiteOpts)` function that any connector test file calls. This keeps the suite close to the interface definition and makes adding a new connector trivial. CI runs `pnpm test:contract` which executes this in each connector package. The suite must be compiled TypeScript (not raw TS) so connector packages can import it without depending on the monorepo's tsconfig. HIGH confidence this pattern is standard in plugin ecosystems.

---

## Data Flow: Incoming Webhook (Critical Path)

This is the most complex and durability-critical path in the system. Each hop is annotated with its failure mode and recovery guarantee.

```
1. PSP (Starkbank) → POST /webhooks/starkbank
   Failure mode: network drop before HTTP response
   Recovery: PSP retries delivery; idempotency via UNIQUE(provider, provider_event_id) makes re-delivery safe

2. Fastify handler → connector.verifySignature(rawBody, headers)
   Failure mode: invalid HMAC → reject 401
   Recovery: PSP should not retry 4xx; customer investigates secret misconfiguration

3. connector.parseWebhook(raw) → NormalizedEvent
   Failure mode: malformed/unknown event type → throw ValidationError → 422
   Recovery: log warning, return 422, PSP typically does not retry 4xx

4. BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE
   │
   ├── INSERT INTO raw_events (provider, provider_event_id, payload_jsonb)
   │   ON CONFLICT (provider, provider_event_id) DO NOTHING
   │   RETURNING id
   │   Failure mode: duplicate → zero rows returned → skip enqueue → COMMIT → 200 OK
   │
   └── IF rows returned > 0:
       boss.send('process-webhook', { rawEventId }, { db: fromDrizzle(tx, sql) })
       Failure mode: pg-boss INSERT fails → whole tx rolls back → raw_events NOT inserted
       → PSP retries → safe to reprocess
   │
   COMMIT
   Failure mode: serialization failure (40001) → retry up to 3x at HTTP handler level
   Failure mode: process crash after COMMIT → pg-boss job already persisted → worker picks it up
   Durability guarantee: after COMMIT, both raw_events row AND job row exist atomically.
                         Process death between INSERT and COMMIT = rollback = PSP retries safely.

5. HTTP response: 200 OK (even for duplicates)
   Note: Return 200 for duplicates, not 409. PSP interprets 4xx/5xx as "retry needed".

6. pg-boss worker dequeues 'process-webhook' job
   Failure mode: worker crash mid-job → pg-boss marks job as failed, retries (configured retry count)
   Recovery: idempotency in post_transaction via idempotency_key ensures re-runs are safe

7. Worker calls post_transaction(postings[])  [SQL function, BEGIN SERIALIZABLE internally]
   Failure mode: serialization failure (40001) → SQL function raises, worker catches, pg-boss retries job
   Failure mode: balancing constraint fails (sum ≠ 0) → programming error, goes to dead-letter queue

8. post_transaction COMMIT → postings row(s) inserted
   Failure mode: process crash → postings not in DB → balance worker never sees them → worker retries job

9. balance-worker polls for postings WHERE id > last_posting_id
   Updates account_balance via SELECT FOR UPDATE on account_id
   Failure mode: crash mid-update → next poll re-reads same posting → SELECT FOR UPDATE prevents double-credit

10. outbound-dispatcher worker reads outbound_events WHERE status='pending'
    Sends POST to customer URL with X-Aprumo-Signature header
    Failure mode: customer URL down → exponential retry (1s→5s→30s→5min→30min→2h) → dead-letter after 6
    Recovery: admin endpoint POST /admin/outbound/:id/replay
```

**Critical insight:** The exact-once guarantee for webhook ingestion rests entirely on step 4. The reason pg-boss is used (not BullMQ, not trigger.dev) is precisely that `fromDrizzle(tx, sql)` makes the job INSERT participate in the same Postgres transaction as the `raw_events` INSERT. No external queue can offer this without distributed transactions.

---

## Transaction Boundaries

### Where `BEGIN SERIALIZABLE` is required

| Operation | Boundary | Retry Layer |
|-----------|----------|-------------|
| `POST /transactions` | Drizzle `db.transaction({ isolationLevel: 'serializable' }, ...)` wrapping `post_transaction()` call | HTTP handler — `withRetryOnSerializationFailure(fn, maxAttempts=3)` wrapper |
| Webhook ingest `POST /webhooks/:provider` | Same Drizzle transaction: `raw_events` INSERT + `boss.send(..., { db: fromDrizzle(tx, sql) })` | HTTP handler — same wrapper |
| `process-webhook` worker | `post_transaction()` SQL function opens its own `BEGIN SERIALIZABLE` internally | pg-boss job retry — worker catches `40001`, returns `JobExecutionError` which pg-boss treats as retryable |
| `balance-worker` per-account update | `SELECT account_balance FOR UPDATE` + `UPDATE account_balance` — read committed is sufficient here because the SELECT FOR UPDATE provides the necessary mutual exclusion | No retry needed — lock is pessimistic |

### The `withRetryOnSerializationFailure` wrapper (application layer)

```typescript
// packages/core/src/db/with-retry.ts
async function withRetryOnSerializationFailure<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (isSerializationFailure(err) && attempt < maxAttempts) continue
      throw err
    }
  }
  throw new Error('unreachable')
}

function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '40001'
  )
}
```

This wrapper lives in `@aprumo/core`. It is called by both the HTTP route handler and the worker. The pg-boss job retry also contributes a second layer of retry for the worker path — both layers are complementary and correct because `post_transaction` is designed to be idempotent via the `idempotency_key`.

### The `post_transaction` SQL function pattern

```sql
-- packages/core/migrations/functions/post_transaction.sql
CREATE OR REPLACE FUNCTION post_transaction(
  p_idempotency_key TEXT,
  p_description     TEXT,
  p_source          TEXT,
  p_postings        JSONB  -- array of {account_id, amount_cents, direction}
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_tx_id uuid;
  v_sum   bigint;
BEGIN
  -- Idempotency: return existing tx if key already used
  SELECT id INTO v_tx_id
  FROM transactions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN v_tx_id; END IF;

  -- Validate double-entry balance before any write
  SELECT SUM(
    CASE direction
      WHEN 'debit'  THEN  amount_cents
      WHEN 'credit' THEN -amount_cents
    END
  ) INTO v_sum
  FROM jsonb_to_recordset(p_postings) AS p(account_id uuid, amount_cents bigint, direction text);

  IF v_sum <> 0 THEN
    RAISE EXCEPTION 'unbalanced_transaction: sum=% idempotency_key=%', v_sum, p_idempotency_key
      USING ERRCODE = 'P0001';
  END IF;

  -- Insert transaction and postings atomically
  INSERT INTO transactions (idempotency_key, ts, description, source)
  VALUES (p_idempotency_key, now(), p_description, p_source)
  RETURNING id INTO v_tx_id;

  INSERT INTO postings (transaction_id, account_id, amount_cents, direction)
  SELECT v_tx_id, p.account_id, p.amount_cents, p.direction
  FROM jsonb_to_recordset(p_postings) AS p(account_id uuid, amount_cents bigint, direction text);

  RETURN v_tx_id;
END;
$$;
```

Key design choices:
- Idempotency check is the first operation — re-delivery returns the same `tx_id` without re-inserting.
- Balance validation in SQL, not TypeScript — invariant is enforced even if TypeScript layer is bypassed.
- Single `RETURNING` captures the generated tx ID.
- The function does not call `BEGIN`/`COMMIT` — the calling context (Drizzle transaction) controls the transaction boundary. This allows the HTTP handler to wrap it in SERIALIZABLE.
- `ERRCODE = 'P0001'` is a custom application exception code; `40001` is the serialization failure code — these are distinct and must be caught separately.

---

## Suggested Build Order

Dependencies force a bottom-up order. Each phase delivers an observable user behavior to avoid long horizontal slabs.

```
Phase 1: Foundation (unblocks everything)
  ├── Monorepo scaffold (pnpm workspaces, tsconfig, Biome, Vitest, Changesets)
  ├── docker-compose.yml (Postgres 16+), PG roles, Drizzle migrations pipeline
  ├── Schema migrations: accounts, transactions, postings, raw_events, account_balance, *_audit
  ├── REVOKE UPDATE/DELETE on postings/raw_events for aprumo_app role
  └── post_transaction SQL function (with balance validation + idempotency)
  Observable: `pnpm db:migrate` succeeds; test verifies UPDATE on postings fails for aprumo_app

Phase 2: Core ledger API (first observable user behavior: POST /transactions works)
  ├── Fastify app skeleton + JSON Schema validation
  ├── withRetryOnSerializationFailure wrapper
  ├── POST /transactions → post_transaction() → 201
  ├── POST /accounts → INSERT accounts → 201
  ├── GET /accounts/:id → account metadata + balance (from account_balance, may be 0 initially)
  ├── GET /accounts/:id/postings → extrato paginado (cursor by posting.id)
  ├── GET /transactions/:id → tx + postings
  └── GET /health (liveness: 200; readiness: SELECT 1 on PG)
  Observable: curl sequence creates accounts, posts a double-entry, reads balance

Phase 3: Balance worker (completes the ledger loop)
  ├── pg-boss setup (start, graceful shutdown)
  ├── balance-worker: SELECT postings WHERE id > last_posting_id, SELECT FOR UPDATE account_balance, UPDATE
  ├── Daily reconciliation job (recalculate from zero, compare, alert on divergence)
  └── Lag metric (seconds between posting.created_at and account_balance.updated_at)
  Observable: after POST /transactions, GET /accounts/:id returns updated balance within 1s

Phase 4: connector-base + connector-starkbank (enables webhook ingestion)
  ├── LedgerConnector interface, NormalizedEvent, Money, PaymentRef types
  ├── HMAC sign/verify helpers in connector-base
  ├── Contract test suite (runContractSuite exported via ./contract entrypoint)
  ├── connector-starkbank: parseWebhook, verifySignature, createPayment, getBalance, withdraw
  ├── MSW handlers for Starkbank API mocking
  └── connector-starkbank passes contract test suite
  Observable: contract test suite is green; parseWebhook correctly normalizes a Starkbank charge.paid event

Phase 5: Webhooks inbound (exact-once ingest)
  ├── POST /webhooks/:provider — connector registry lookup
  ├── verifySignature → parseWebhook → NormalizedEvent
  ├── BEGIN SERIALIZABLE: INSERT raw_events + boss.send('process-webhook', { db: fromDrizzle })
  ├── process-webhook worker: reads raw_events row, calls post_transaction via reconcile logic
  ├── Duplicate deduplication: ON CONFLICT DO NOTHING → 200 OK
  └── Logging: structured pino, no raw payload, no PII
  Observable: send a simulated Starkbank webhook → raw_events row created → postings created → balance updated

Phase 6: Webhooks outbound (closes customer notification loop)
  ├── Schema: outbound_endpoints, outbound_events
  ├── POST /outbound-endpoints (customer registers URL + secret + event_types)
  ├── outbound-dispatcher worker: reads pending outbound_events, POST with HMAC header
  ├── Retry policy: 1s→5s→30s→5min→30min→2h, dead-letter after 6
  └── POST /admin/outbound/:id/replay
  Observable: full end-to-end: inbound Starkbank webhook → outbound charge.paid delivered to customer URL

Phase 7: Observability + docs + release
  ├── pino redact config (PII paths)
  ├── prom-client: define all aprumo_* metric names
  ├── OpenAPI via @fastify/swagger
  ├── README quickstart, concepts doc, connector guide, ADRs 001-009
  └── Changesets publish: @aprumo/core@0.1.0, @aprumo/connector-starkbank@0.1.0, @aprumo/webhooks@0.1.0
  Observable: npm install @aprumo/core works; Prometheus /metrics endpoint returns ledger metrics
```

**Why this order:**
- Schema must precede everything — `post_transaction` is a SQL function that the TS layer calls.
- Phase 2 delivers a working ledger before any PSP integration — design partners can start testing accounting logic.
- Phase 3 (balance worker) before connector work — the worker correctness is testable independently with synthetic postings.
- Phase 4 (connector-base) before Phase 5 (webhooks) — the contract test suite gates whether the webhook worker can trust `parseWebhook`.
- Phase 6 (outbound) requires Phase 5 (inbound) because `outbound_events` are created by the reconcile worker.
- Phase 7 is last because docs and metrics are useful only once behavior exists; Changesets publish is a hard release gate.

---

## Testing Topology

### Shared testcontainer via Vitest globalSetup

Use a single `PostgreSqlContainer("postgres:16")` started once in `vitest.globalSetup.ts` at the monorepo root. The container is shared across all test files in a single `pnpm test` run. This avoids Docker startup cost per test file (significant on a 4 vCPU dev machine or CI runner).

```typescript
// vitest.globalSetup.ts  (monorepo root)
import { PostgreSqlContainer } from '@testcontainers/postgresql'
let container: StartedPostgreSqlContainer

export async function setup(project: unknown) {
  container = await new PostgreSqlContainer('postgres:16').start()
  ;(project as { provide: (k: string, v: string) => void })
    .provide('POSTGRES_URI', container.getConnectionUri())
}

export async function teardown() {
  await container?.stop()
}
```

### Per-test-file schema isolation (not per-test)

Each test file creates its own Postgres schema (not a separate database) and runs migrations against it. Schema names are derived from the test file path (hash or sanitized path). This gives:

- Parallelism: test files run concurrently without row-level conflicts
- Isolation: `DROP SCHEMA IF EXISTS ... CASCADE` in `afterAll` cleans up without affecting siblings
- Cost: schema creation + migrations are fast (<100ms); per-test schema isolation is overkill and not needed

```typescript
// packages/core/src/test-helpers/create-test-schema.ts
export async function createTestSchema(uri: string, schemaName: string) {
  const db = drizzle(postgres(uri))
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(schemaName)}`)
  await runMigrations(uri, schemaName)
  return db
}
```

### Rule: no PG mocks in the ledger path

`post_transaction`, balance worker, reconcile worker, and the exact-once ingest path MUST use a real Postgres container. TypeScript unit tests (pure functions, HMAC helpers, error mapping) MAY run without a container.

### MSW for Starkbank

Use `msw/node` with `setupServer`. Handlers are colocated in `packages/connector-starkbank/src/test/handlers/`. The MSW server is started in `beforeAll`, handlers are reset in `afterEach`. This pattern is well-established for testing HTTP clients in Node.js without network access.

### Contract test invocation pattern in CI

```yaml
# .github/workflows/ci.yml
- name: Contract tests
  run: pnpm --filter '@aprumo/connector-*' test:contract
```

Each connector package exports a `test:contract` script that runs `vitest run --config vitest.contract.config.ts` pointing at the file that calls `runContractSuite(new StarkbankConnector(...))`.

### Mandatory edge case tests for ledger operations

These tests must exist and be green before any feature touching the ledger merges:

1. Idempotency: same `idempotency_key` submitted twice → second call returns same `transaction_id`, no duplicate postings
2. Race condition: two concurrent `post_transaction` calls on same accounts → both succeed or one gets 40001 and retries, final balances correct
3. Unbalanced postings: `SUM(amount_cents) ≠ 0` → SQLSTATE P0001, no rows inserted
4. Webhook duplicate: same `(provider, provider_event_id)` twice → second INSERT ON CONFLICT → 200 OK, single job enqueued
5. Stale balance: `account_balance` is behind; `GET /accounts/:id` shows stale value until worker runs — test documents lag window
6. Balance reconciliation divergence: manually corrupt `account_balance`, run daily reconciliation → alert logged

---

## Observability

### pino redact configuration

```typescript
// packages/core/src/logger.ts
import pino from 'pino'

export const logger = pino({
  redact: {
    paths: [
      // LGPD: taxpayer/payer PII
      '*.cpf',
      '*.cnpj',
      '*.nome',
      '*.name',
      '*.email',
      '*.telefone',
      '*.phone',
      // PSP credentials and tokens
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.api_key',
      '*.authorization',
      'headers.authorization',
      'headers["x-api-key"]',
      // Raw webhook payloads (may contain PII)
      '*.raw_payload',
      '*.payload_jsonb',
      // Card data (defense in depth even though we never store PAN)
      '*.pan',
      '*.card_number',
    ],
    censor: '[REDACTED]',
  },
  serializers: {
    // Never log full req/res body; log only method, url, statusCode, responseTime
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
})
```

**Rule:** Never call `logger.info({ rawBody })` or `logger.info({ payload })` anywhere in the webhook ingestion path. Log the normalized event summary (event type, provider, event ID) only.

### Prometheus metric names (`aprumo_*`)

All metrics use `prom-client` in `@aprumo/core`. Convention: `aprumo_<subsystem>_<name>_<unit>`.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `aprumo_http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP latency per endpoint |
| `aprumo_transactions_total` | Counter | `status` (`success`, `error`, `duplicate`) | Ledger writes |
| `aprumo_postings_total` | Counter | — | Total postings inserted |
| `aprumo_balance_worker_lag_seconds` | Gauge | — | Seconds between last posting and last balance update |
| `aprumo_balance_worker_last_posting_id` | Gauge | — | Cursor position for diagnostics |
| `aprumo_pgboss_jobs_pending` | Gauge | `queue` | Jobs waiting in pg-boss queue |
| `aprumo_pgboss_jobs_active` | Gauge | `queue` | Jobs currently being processed |
| `aprumo_pgboss_jobs_failed` | Counter | `queue` | Jobs moved to failed state |
| `aprumo_webhook_inbound_total` | Counter | `provider`, `status` (`accepted`, `duplicate`, `rejected`) | Inbound webhook events |
| `aprumo_webhook_outbound_total` | Counter | `status` (`delivered`, `failed`, `dead_lettered`) | Outbound delivery attempts |
| `aprumo_webhook_outbound_delivery_duration_seconds` | Histogram | — | Time to deliver outbound webhook |
| `aprumo_reconcile_lag_seconds` | Gauge | — | Seconds between `raw_events.received_at` and reconcile completion |

Metrics are exposed at `GET /metrics` in Prometheus text format. The health endpoint is at `GET /health`.

### Health endpoint contract

```
GET /health
→ 200 {"status":"ok","checks":{"db":"ok"}}           (liveness + readiness passing)
→ 503 {"status":"degraded","checks":{"db":"error"}}  (postgres unreachable)
```

`/health` performs `SELECT 1` against the pool. A failed query returns 503 — Kubernetes readiness probe removes the pod from rotation. Liveness probe should be a separate `GET /livez` that does zero I/O and returns 204 — this prevents restart loops when DB is down.

### Trace context propagation

For v0.1 (solo dev, no distributed tracing infra): propagate a `X-Request-Id` header through the inbound webhook path down to job attributes in pg-boss. Log the request ID on every log line within a handler using `child` loggers:

```typescript
const reqLogger = logger.child({ requestId: req.headers['x-request-id'] })
```

This provides correlation without requiring OpenTelemetry infrastructure in v0.1.

---

## Release Topology

### Independent versioning via Changesets

Each package has its own `package.json` version. Changesets tracks changes per-package and bumps independently. Configuration in `.changeset/config.json`:

```json
{
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

`"linked": []` means packages version independently. `"updateInternalDependencies": "patch"` means when `connector-base` releases a non-breaking change, `connector-starkbank` gets a patch bump to its `peerDependencies` range automatically.

### connector-base ↔ connector-starkbank compatibility

`connector-starkbank` declares `connector-base` as a `peerDependency` with a range:

```json
{
  "peerDependencies": {
    "@aprumo/connector-base": "^1.0.0"
  }
}
```

**When `connector-base` has a MAJOR bump** (breaking contract change — interface method renamed, `NormalizedEvent` shape changed): Changesets treats peerDependency changes as MAJOR bumps. All connectors must release a new MAJOR version to express compatibility with the new `connector-base`. This is the correct semver behavior: a connector that silently consumes a newer `connector-base` without running the contract suite would be a silent correctness failure.

**CI enforcement:** The contract test CI job runs every connector against the `connector-base` version in the monorepo at that commit. A `connector-base` breaking change that is not also accompanied by a passing contract suite for `connector-starkbank` fails CI.

### Monorepo publish flow

```bash
# 1. Contributors add changesets during PR
pnpm changeset             # creates .changeset/*.md

# 2. Release PR (automated by Changesets Action or manual)
pnpm changeset version     # bumps versions, updates CHANGELOGs, updates peerDep ranges

# 3. Publish (manual for v0.1, automate after first stable release)
pnpm build                 # compile all packages
pnpm changeset publish     # publishes only packages with version > current npm
```

The `@aprumo/connector-base` package should be published first (it has no aprumo deps). CI should enforce publish order: `connector-base` → `core` → `connector-starkbank` → `webhooks`.

---

## Self-Hosting Topology

### docker-compose.yml (minimal for design partners)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: aprumo_migration
      POSTGRES_PASSWORD: ${POSTGRES_MIGRATION_PASSWORD}
      POSTGRES_DB: aprumo
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U aprumo_migration"]
      interval: 5s
      timeout: 3s
      retries: 5

  migrate:
    image: ghcr.io/aprumo/aprumo:${VERSION:-latest}
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL: postgres://aprumo_migration:${POSTGRES_MIGRATION_PASSWORD}@postgres:5432/aprumo
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"          # run once then exit

  api:
    image: ghcr.io/aprumo/aprumo:${VERSION:-latest}
    command: ["node", "dist/server.js"]
    environment:
      DATABASE_URL: postgres://aprumo_app:${POSTGRES_APP_PASSWORD}@postgres:5432/aprumo
      PGBOSS_SCHEMA: pgboss
      LOG_LEVEL: info
      PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully

  worker:
    image: ghcr.io/aprumo/aprumo:${VERSION:-latest}
    command: ["node", "dist/worker.js"]
    environment:
      DATABASE_URL: postgres://aprumo_app:${POSTGRES_APP_PASSWORD}@postgres:5432/aprumo
      PGBOSS_SCHEMA: pgboss
      LOG_LEVEL: info
    depends_on:
      migrate:
        condition: service_completed_successfully

volumes:
  pgdata:
```

**Separation of `api` and `worker` processes:** Both services use the same Docker image but different entrypoints. This allows independent scaling later (more workers without more API replicas) and cleaner process management. For a solo design partner running on a single small VM, both can run on the same host.

### Migrate-on-boot vs explicit step

Use the **explicit `migrate` service** pattern (not migrate-on-boot inside `server.js`). Reasons:
- Multiple replicas of `api` or `worker` running `db:migrate` concurrently create race conditions.
- The `migrate` service runs once and exits with code 0 on success. `api` and `worker` have `depends_on: migrate: condition: service_completed_successfully`.
- Drizzle's `drizzle-kit migrate` is idempotent — safe to re-run.

### Environment variable contract

```
# Required
DATABASE_URL               # full postgres URL with credentials
POSTGRES_MIGRATION_PASSWORD  # migration role password (migrate service only)
POSTGRES_APP_PASSWORD      # app role password (api + worker)

# PSP connector secrets (per-provider)
STARKBANK_PRIVATE_KEY      # PEM string, newlines encoded as \n
STARKBANK_PROJECT_ID       # Starkbank project UUID
STARKBANK_WEBHOOK_SECRET   # HMAC secret for inbound webhook verification

# Optional with defaults
PORT                       # default 3000
LOG_LEVEL                  # default "info"
PGBOSS_SCHEMA              # default "pgboss"
SERIALIZABLE_RETRY_MAX     # default 3
BALANCE_WORKER_POLL_MS     # default 500
OUTBOUND_RETRY_DELAYS_MS   # default "1000,5000,30000,300000,1800000,7200000"
```

Secrets are passed as env vars. No secret manager required for v0.1 (design partners use docker-compose `.env` file with `chmod 600`). Mount a `.env` file; never commit it.

### Observability for self-hosters

Logs go to stdout in JSON (pino default). Design partners can ship to any log aggregator by piping stdout. Prometheus scrapes `GET /metrics` on port 3000. A minimal Prometheus + Grafana docker-compose service can be provided in `examples/observability/docker-compose.yml` as optional addons — not required for v0.1 but valuable for design partner feedback.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calling `post_transaction` outside a SERIALIZABLE transaction

**What people do:** Call the SQL function from a read-committed connection to "simplify" the retry logic.
**Why wrong:** Two concurrent workers processing different events for the same account can create phantom reads on `account_balance`, leading to double-credit or missed debit. The SERIALIZABLE isolation is the correctness guarantee.
**Do instead:** Always wrap calls to `post_transaction` (or any ledger write) in `db.transaction({ isolationLevel: 'serializable' }, ...)` with the `withRetryOnSerializationFailure` wrapper.

### Anti-Pattern 2: Using a queue external to Postgres for webhook enqueue

**What people do:** Introduce BullMQ/Redis or trigger.dev for "better" job management after seeing pg-boss's API.
**Why wrong:** The exact-once ingest guarantee (invariant #4) requires that `raw_events` INSERT and job enqueue happen in the same Postgres transaction. A Redis-based queue cannot participate in a Postgres transaction. You cannot have exactly-once delivery without a shared transaction log.
**Do instead:** Keep pg-boss. If pg-boss limitations become a problem (unlikely at v0.1 scale), write an ADR first.

### Anti-Pattern 3: Building balance calculation into each `GET /accounts/:id` query

**What people do:** Compute `SUM(postings)` in real time on every balance read to avoid the `account_balance` table.
**Why wrong:** O(N) over all postings history for every API call. At 1M postings per account (common in a busy SaaS), this becomes unusable. The `account_balance` materialized view with incremental worker gives O(1) reads and sub-second lag.
**Do instead:** Use the `account_balance` table. Document that it can be 0-1s stale. Provide the daily reconciliation job as a correctness check.

### Anti-Pattern 4: Testing ledger invariants with mocked Postgres

**What people do:** Mock the DB layer with an in-memory object to speed up tests.
**Why wrong:** The entire double-entry invariant, the `REVOKE` permissions, the deferred constraints, and the `UNIQUE` idempotency enforcements live in Postgres itself. A TypeScript mock cannot reproduce this behavior. The mock will pass tests that would fail in production.
**Do instead:** Always use a real `testcontainers` Postgres for any test that touches `post_transaction`, `raw_events`, or `account_balance`. Only mock the external HTTP calls to PSPs.

### Anti-Pattern 5: Logging raw webhook payloads for debugging

**What people do:** Add `logger.info({ rawBody })` in the webhook handler during debugging and forget to remove it.
**Why wrong:** Starkbank webhook payloads can contain payer CPF, name, and payment details — all LGPD-sensitive. Logs land in aggregators that many people can access.
**Do instead:** Log only the event summary: `{ provider, eventType, providerEventId }`. Use the pino `redact` config as a backup. Never log `payload_jsonb` or any field that could contain PII.

---

## Scaling Considerations

| Scale | Architectural adjustment |
|-------|--------------------------|
| 0-50 RPS (v0.1 design partners) | Single docker-compose host. `api` + `worker` as separate processes on same machine. Postgres on same host. This is the target topology. |
| 50-200 RPS | Separate Postgres to dedicated VM or managed PG (Supabase, Neon, RDS). Scale `api` process replicas. `worker` can remain single-process as long as pg-boss concurrency is tuned. |
| 200-1000 RPS | Managed Postgres with connection pooler (PgBouncer or pgcat in transaction mode). Multiple worker replicas — pg-boss handles distributed job claiming natively. Consider read replicas for `GET /accounts` queries. |
| 1000+ RPS | Partition `postings` by `account_id` (hash partitioning). At this scale, re-evaluate whether TigerBeetle or a dedicated ledger DB makes sense and write the ADR. `balance-worker` sharding by account_id range. |

**First bottleneck at v0.1 scale:** Postgres serializable transactions on `postings`. At 100 RPS with 2-3 postings each, that is ~200-300 INSERT/s under SERIALIZABLE — well within Postgres 16 capacity on modern hardware. Serialization failures should be rare (< 1%) with the retry wrapper.

**Second bottleneck:** The `balance-worker` poll interval. At 500ms poll and 100 RPS throughput, the worker processes ~50 postings per cycle. Decreasing poll interval to 100ms and increasing batch size handles 10x throughput before hitting Postgres CPU limits.

---

## Sources

- pg-boss transactional job enqueue: https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md (HIGH confidence — official docs)
- `fromDrizzle` adapter for pg-boss: https://context7.com/timgit/pg-boss/llms.txt (HIGH confidence — official)
- Drizzle Postgres transaction with `isolationLevel: 'serializable'`: https://orm.drizzle.team/docs/transactions (HIGH confidence — official docs)
- PostgreSQL serialization failure handling: https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html (HIGH confidence — official PG docs)
- PostgreSQL deferrable constraints: https://emmer.dev/blog/deferrable-constraints-in-postgresql/ (MEDIUM confidence — verified against PG docs)
- Testcontainers Node globalSetup with Vitest: https://node.testcontainers.org/quickstart/global-setup/ (HIGH confidence — official)
- MSW setupServer for Node.js: https://context7.com/mswjs/msw/llms.txt (HIGH confidence — official)
- Changesets peerDependency major bump: https://github.com/changesets/changesets/blob/main/packages/cli/README.md (HIGH confidence — official)
- Prometheus metric naming conventions: https://prometheus.io/docs/practices/naming/ (HIGH confidence — official)
- pino redact configuration: https://github.com/pinojs/pino/blob/main/docs/api.md (HIGH confidence — official)
- Fastify liveness/readiness patterns: https://dev.to/bhavyasethafk/building-effective-healthcheck-endpoints-in-modern-backend-systems-1noi (MEDIUM confidence — community, verified against Kubernetes docs)

---

*Architecture research for: Aprumo — open-source financial ledger with pluggable PSP connectors*
*Researched: 2026-05-18*
