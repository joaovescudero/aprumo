# Roadmap: Aprumo

## Overview

Aprumo is built bottom-up. The schema and `post_transaction` SQL function are bedrock — no TypeScript can run without them. The API is built on that foundation, then the balance worker consumes what the API produces, then the connector contract is defined before any connector implements it, then the Starkbank connector implements against that contract, then inbound webhooks compose connector + core into the exact-once guarantee, then outbound webhooks close the customer notification loop, and finally observability and docs arrive when there is stable behavior to measure and document. Each phase is a delivery boundary, not a technical layer — at the end of every phase, something observable and testable is true that was not true before.

Security and tooling discipline come first (Phase 1) because the repo is public MIT OSS and a Starkbank private key committed to git is an immediate, irreversible compromise. Nothing else ships until `.gitignore`, pre-commit scanning, and CI are green.

## Phases

**Phase Numbering:**
- Integer phases (1–9): Planned v0.1 milestone work
- Decimal phases (X.Y): Urgent insertions if needed post-planning

- [ ] **Phase 1: Monorepo Scaffold + CI + Dev Security** - pnpm workspace, TypeScript, Biome, Vitest, CI pipeline, secret scanning, and `.gitignore` — before any key or credential is ever generated
- [ ] **Phase 2: Schema Foundation + DB Tooling** - Drizzle migrations for all ledger tables, PG roles, REVOKE enforcement, deferred double-entry constraint trigger, testcontainers setup, and ADRs
- [ ] **Phase 3: Core Ledger API** - Fastify REST endpoints for transactions/accounts/postings, `post_transaction` function, idempotency, serialization retry, BigInt serializer, and error handling
- [ ] **Phase 4: Balance Worker + Reconciliation** - pg-boss queues, incremental balance worker (cursor + FOR UPDATE), daily reconciliation job, and lag Prometheus metric
- [ ] **Phase 5: Connector Base Interface** - `LedgerConnector` interface, canonical types, HMAC helpers, contract test suite export, FakeConnector, and dependency graph CI check
- [ ] **Phase 6: Starkbank Connector** - Starkbank SDK integration with ECDSA webhook parsing, 6-method implementation, MSW mocks, contract tests green, and Starkbank event taxonomy spike
- [ ] **Phase 7: Webhooks Inbound** - `POST /webhooks/:provider` exact-once ingest (INSERT raw_events + pg-boss enqueue in same tx), connector registry, process-webhook worker, crash-injection test
- [ ] **Phase 8: Webhooks Outbound** - outbound_endpoints + outbound_events schema, HMAC-signed dispatch worker, exponential retry, dead-letter after 6, admin replay, 14-event vocabulary
- [ ] **Phase 9: Observability, Docs + Release** - pino redact globally enforced, full Prometheus metrics, OpenAPI spec, quickstart docs, ADRs 001–009 published, npm release v0.1.0

## Phase Details

### Phase 1: Monorepo Scaffold + CI + Dev Security
**Goal**: Operators can clone the repo, run `pnpm install`, and see lint, typecheck, and test pipeline pass in CI — with secret scanning blocking any accidental credential commit before a single key is ever generated.
**Depends on**: Nothing (first phase)
**Requirements**: INF-01, INF-02, INF-03, INF-04, INF-05, INF-06, INF-07, INF-08, INF-09, INF-10
**Success Criteria** (what must be TRUE):
  1. `pnpm install` succeeds from a fresh clone; `pnpm lint`, `pnpm typecheck`, and `pnpm test` all run without error in CI matrix (Node 22, Node 24)
  2. Pre-commit hook blocks a commit containing `-----BEGIN EC PRIVATE KEY-----` or a mock `.env` with `SECRET=` — detect-secrets or equivalent fires before git accepts the commit
  3. `.gitignore` covers `.env*`, `*.key`, `*.pem`, `secrets/`, build artifacts — verified by asserting those files are untracked after `touch`
  4. GitHub Actions runs lint + typecheck + build + test + coverage gate jobs; PR without changeset in a publishable package fails CI (INF-10 enforced)
  5. Changesets is configured; `pnpm changeset` works and produces a valid changeset file
**Plans**: TBD
**UI hint**: no

### Phase 2: Schema Foundation + DB Tooling
**Goal**: `pnpm db:migrate` runs to completion on a fresh Postgres 16 container, producing all ledger tables with immutability enforced at three layers (role permissions, `post_transaction` sole write path, deferred constraint trigger), and the testcontainers globalSetup makes integration tests possible.
**Depends on**: Phase 1
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06, FND-07, FND-08, FND-09, FND-10, FND-11, FND-12, FND-13, FND-14, FND-15, FND-16, FND-17, FND-18
**Success Criteria** (what must be TRUE):
  1. `pnpm db:migrate` applies all migrations from scratch on a blank Postgres 16 container; `pnpm db:reset` destroys and recreates the local DB without manual intervention
  2. CI queries `pg_constraint` after migration and asserts the double-entry constraint trigger is `condeferrable = true AND condeferred = true` — fails the build if not
  3. An integration test connecting as `aprumo_app` attempts `UPDATE postings SET amount_cents = 0` and receives error code `42501` (permission denied) — this test must be green before phase closes
  4. `post_transaction` SQL function rejects postings that do not sum to zero (returns error at COMMIT) and accepts balanced postings atomically; verified by a red-path test using testcontainers real PG
  5. Drizzle migration hash check runs in CI and fails if any previously committed migration file is edited — no schema drift between local and CI
  6. ADRs 001–009 are written in `docs/adr/` in MADR format and committed
**Plans**: TBD
**UI hint**: no

### Phase 3: Core Ledger API
**Goal**: Developers can `POST /transactions` with balanced postings and an `Idempotency-Key`, receive a 201 with persisted postings, and query accounts and their posting history via the REST API — all with correct BigInt serialization and serialization failure retry.
**Depends on**: Phase 2
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, API-07, API-08, API-09, API-10, API-11, API-12, API-13
**Success Criteria** (what must be TRUE):
  1. `POST /transactions` with a balanced posting set returns 201 with transaction + postings; `amount_cents` in the JSON response is a string (never a number) — asserted in automated test
  2. `POST /transactions` with the same `Idempotency-Key` sent twice concurrently (`Promise.all`) returns 200 both times with identical response bodies — no 409 or 500
  3. `POST /transactions` with postings that do not sum to zero returns 422 (constraint violation mapped correctly by error handler)
  4. `withRetryOnSerializationFailure` wrapper retries the entire `db.transaction()` call (not just the failing query) on SQLSTATE 40001 — verified by mocking `serialization_failure` on first attempt and asserting success on second
  5. `GET /health` returns 200 with PG connectivity check; `GET /docs` serves OpenAPI UI; `amount_cents` documented as JSON string in the spec
**Plans**: TBD
**UI hint**: no

### Phase 4: Balance Worker + Reconciliation
**Goal**: After a `POST /transactions` posting is committed, `GET /accounts/:id` reflects the updated balance within 1 second (p99), and a daily reconciliation job alerts when the incremental balance diverges from a full recalculation.
**Depends on**: Phase 3
**Requirements**: BAL-01, BAL-02, BAL-03, BAL-04, BAL-05, BAL-06, BAL-07, BAL-08
**Success Criteria** (what must be TRUE):
  1. pg-boss starts cleanly alongside the Fastify process and shuts down gracefully (no orphaned connections); `process.on('SIGTERM')` triggers graceful shutdown of both server and boss
  2. Balance worker updates `account_balance` within 1 second (p99) of posting commit — measured in a load test with 100 synthetic postings and asserted via `aprumo_balance_worker_lag_seconds` histogram in Prometheus output at `/metrics`
  3. `SELECT ... FOR UPDATE` on `account_balance` by `account_id` prevents concurrent balance corruption under parallel worker runs — verified by running two workers concurrently against the same account and asserting final balance equals sum of all postings
  4. Daily reconciliation job recalculates balance from scratch, compares to `account_balance`, and logs a structured alert when they diverge — verified by manually corrupting `account_balance.balance` and asserting the job's log output contains the divergence record
**Plans**: TBD
**UI hint**: no

### Phase 5: Connector Base Interface
**Goal**: `@aprumo/connector-base` is published with a zero-dependency `LedgerConnector` interface, canonical types, HMAC sign/verify helpers, and an exported contract test suite — and CI enforces that `@aprumo/core` has no import dependency on any connector package.
**Depends on**: Phase 4
**Requirements**: CNB-01, CNB-02, CNB-03, CNB-04, CNB-05, CNB-06, CNB-07
**Success Criteria** (what must be TRUE):
  1. `@aprumo/connector-base` has zero runtime dependencies (confirmed by `pnpm why` on the package); `LedgerConnector` interface exports all 6 methods: `createPayment`, `getPayment`, `refundPayment`, `getBalance`, `withdraw`, `parseWebhook`
  2. `FakeConnector` (implementing `LedgerConnector` with semantics completely different from Starkbank) passes the full contract test suite exported via `@aprumo/connector-base/contract` — proving no Starkbank assumptions leaked into the contract
  3. CI `pnpm why` or dependency graph check confirms `packages/core/` has zero direct or transitive imports from `packages/connector-starkbank/` — fails build if any path is found
  4. `signOutboundWebhook` and `verifyInboundHmac` helpers use `timingSafeEqual` — verified by code assertion (regex grep in CI) and by a replay-attack test that sends a valid webhook with a timestamp 10 minutes old and asserts rejection
**Plans**: TBD
**UI hint**: no

### Phase 6: Starkbank Connector
**Goal**: `@aprumo/connector-starkbank` implements all 6 `LedgerConnector` methods (including `getPayment` and `refundPayment`) against Starkbank's ECDSA-authenticated SDK, passes the full connector-base contract test suite under MSW mocks, and documents the complete Starkbank event taxonomy.
**Depends on**: Phase 5
**Requirements**: SBC-01, SBC-02, SBC-03, SBC-04, SBC-05, SBC-06, SBC-07, SBC-08, SBC-09, SBC-10, SBC-11
**Success Criteria** (what must be TRUE):
  1. `@aprumo/connector-base/contract` suite runs against `StarkbankConnector` and all assertions pass — no skipped tests
  2. `parseWebhook` uses `starkbank.event.parse({ content, signature })` exclusively (ECDSA via SDK, no manual HMAC); any call to a manual ECDSA implementation causes CI to fail (lint rule or grep check)
  3. All Starkbank HTTP calls in tests are intercepted by MSW v2 with `onUnhandledRequest: 'error'` — no real network calls during tests; any unregistered HTTP call fails the test immediately
  4. Starkbank event taxonomy spike is documented in `docs/connectors/starkbank-events.md` with payloads for PIX paid, PIX devolução, boleto paid on time, boleto paid late, boleto expired, transfer confirmed — derived from sandbox testing before implementation
  5. Error mapping covers `retryable`, `terminal`, and `validation` categories — verified by a test that injects each Starkbank error code and asserts the correct category
**Plans**: TBD
**UI hint**: no

### Phase 7: Webhooks Inbound
**Goal**: A signed Starkbank webhook arrives at `POST /webhooks/starkbank`, is inserted into `raw_events` and enqueued in pg-boss within a single Postgres SERIALIZABLE transaction (exact-once), and the `process-webhook` worker applies the corresponding `post_transaction` — with a crash-injection test proving atomicity in CI.
**Depends on**: Phase 6
**Requirements**: WHI-01, WHI-02, WHI-03, WHI-04, WHI-05, WHI-06, WHI-07, WHI-08, WHI-09, WHI-10, WHI-11
**Success Criteria** (what must be TRUE):
  1. Crash-injection test: a mock that kills the process between `raw_events` INSERT and `boss.send` leaves no orphaned `raw_events` row without a corresponding job — asserted by querying both tables after simulated crash and recovery; this test must be green before phase closes
  2. Duplicate webhook (same `provider` + `provider_event_id`) returns 200 OK without error and without creating a second `raw_events` row or a second pg-boss job — verified by sending the same signed payload twice
  3. A signed Starkbank `charge.paid` webhook arrives end-to-end: INSERT to `raw_events` → `process-webhook` worker fires → `post_transaction` called → `account_balance` updated — asserted in an E2E test using MSW-intercepted Starkbank ECDSA verification
  4. Pino structured log output during webhook processing contains zero occurrences of `cpf`, `document`, `holderName`, `taxId`, or raw `payload` content — asserted by capturing log output in tests and scanning for PII patterns
  5. Business-key deduplication: two `raw_events` with different `provider_event_id` but same `charge.id` and same event type result in exactly one `post_transaction` call — asserted by the reconciliation worker test
**Plans**: TBD
**UI hint**: no

### Phase 8: Webhooks Outbound
**Goal**: When the ledger processes a posting, an `outbound_events` record is created and dispatched to the customer's registered URL with an HMAC-SHA256 signature, retry up to 6 times with exponential backoff, and operators can inspect dead-letter events and replay them via admin endpoint.
**Depends on**: Phase 7
**Requirements**: WHO-01, WHO-02, WHO-03, WHO-04, WHO-05, WHO-06, WHO-07, WHO-08, WHO-09, WHO-10, WHO-11
**Success Criteria** (what must be TRUE):
  1. `POST /outbound-endpoints` with a secret shorter than 32 bytes returns 422; with a valid secret returns 201 and the secret is never returned in subsequent `GET` responses
  2. Outbound dispatcher sends `POST` to the registered URL with `X-Aprumo-Signature: t=<unix>,sha256=<hmac>` header; a test listener verifies the signature using the registered secret and `timingSafeEqual` — asserted green
  3. After 6 failed delivery attempts, the outbound event status is `dead_letter`; `POST /admin/outbound/:id/replay` re-enqueues it and the next attempt is dispatched — verified in an E2E test with a failing mock endpoint
  4. `GET /admin/raw-events?status=unreconciled` returns events that have not been reconciled — verified by inserting a `raw_events` row with `status='pending'` and asserting it appears in the response
  5. All 14 outbound event types in the v0.1 vocabulary are validated against schema at event creation time; an event with a PII field (`cpf`, `email`) in the payload is rejected at creation — asserted by schema validation test
**Plans**: TBD
**UI hint**: no

### Phase 9: Observability, Docs + Release
**Goal**: Operators can self-host Aprumo via `docker-compose up`, observe the system via `/metrics` and `/health/ready`, and design partners can install `@aprumo/core@0.1.0` from npm and follow the quickstart to their first `POST /transactions`.
**Depends on**: Phase 8
**Requirements**: OBS-01, OBS-02, OBS-03, OBS-04, OBS-05, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05, DOC-06, DOC-07, DOC-08, DOC-09, DOC-10
**Success Criteria** (what must be TRUE):
  1. `/metrics` exposes `aprumo_balance_worker_lag_seconds`, `aprumo_balance_worker_processed_total`, pg-boss queue metrics (pending/active/failed/dead per queue), and outbound webhook metrics (sent/failed/dead) — verified by scraping the endpoint and asserting metric names present
  2. `/health/ready` returns 200 when Postgres and pg-boss are healthy; returns 503 when Postgres connection is down — verified by stopping the test PG container and asserting 503
  3. W3C `traceparent` header is propagated from inbound HTTP request through to the `process-webhook` worker log line — asserted by sending a request with a known `traceparent` and asserting it appears in worker structured logs
  4. `docker-compose -f docker-compose.prod.yml up` starts `migrate` service first (with `depends_on: service_completed_successfully`), then `api` and `worker` — verified by reading the compose file and a smoke test that runs the compose stack and confirms `/health` returns 200
  5. `pnpm changeset publish` succeeds (dry-run in CI); `@aprumo/core@0.1.0`, `@aprumo/connector-base@0.1.0`, `@aprumo/connector-starkbank@0.1.0`, `@aprumo/webhooks@0.1.0` are published to npm — release notes generated from Changesets CHANGELOG
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Monorepo Scaffold + CI + Dev Security | 0/TBD | Not started | - |
| 2. Schema Foundation + DB Tooling | 0/TBD | Not started | - |
| 3. Core Ledger API | 0/TBD | Not started | - |
| 4. Balance Worker + Reconciliation | 0/TBD | Not started | - |
| 5. Connector Base Interface | 0/TBD | Not started | - |
| 6. Starkbank Connector | 0/TBD | Not started | - |
| 7. Webhooks Inbound | 0/TBD | Not started | - |
| 8. Webhooks Outbound | 0/TBD | Not started | - |
| 9. Observability, Docs + Release | 0/TBD | Not started | - |
