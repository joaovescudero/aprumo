# Project Research Summary

**Project:** Aprumo — open-source PSP-agnostic financial ledger
**Domain:** Double-entry financial ledger with pluggable PSP connectors, Brazilian recurring-revenue SaaS
**Researched:** 2026-05-18
**Confidence:** HIGH

## Executive Summary

Aprumo is a backend-only, self-hosted financial ledger that records PSP activity as immutable double-entry bookkeeping entries. This is a well-understood domain (Formance, Fragment, Modern Treasury, Blnk all solve adjacent problems) but the combination of PSP-agnostic connector contract + Brazilian payment rail semantics (PIX devolution, boleto lifecycle, BACEN MED window) + MIT OSS distribution creates a differentiated position that none of the reference products occupy. The architecture is bottom-up: schema and `post_transaction` must exist before any API, and the API must exist before connector or webhook work begins. Everything composes on Postgres — ledger tables, pg-boss job queue, and Drizzle migrations all share one DB, which is the design decision that makes exact-once webhook ingest tractable.

The recommended approach is a strict 7-phase build order: schema+foundation → core ledger API → balance worker → connector-base+Starkbank → inbound webhooks → outbound webhooks → observability+release. Each phase delivers an observable, testable user behavior before the next begins. The stack is fully closed (ADRs 001–009 decided), versions are verified as of the research date, and all critical implementation patterns are documented — the main work is execution, not discovery. TDD is non-negotiable and the testcontainers pattern (shared Postgres container, per-file schema isolation) is the correct implementation given the rule against mocking Postgres in ledger tests.

The highest-risk implementation detail in the entire system is the exact-once webhook guarantee: `raw_events` INSERT and `pg-boss.send()` must occur in the same Postgres transaction via `fromDrizzle(tx, sql)`. This is non-obvious from the pg-boss docs and the failure mode (silent event loss or phantom jobs) is invisible until production. The second-highest risk is money precision: `BIGINT amount_cents` in Postgres must map to JS `bigint` throughout, serialized as a JSON string at the API boundary — never converted to `Number`. Both risks must be addressed in Phase 1 (types) and Phase 5 (webhooks), with explicit CI tests before those phases close.

## Key Findings

### Recommended Stack

All versions verified against npm registry and official documentation as of 2026-05-18. The stack is fixed by ADRs 001–009. Key version constraints: pg-boss 12.18.2 requires Node >= 22.12.0; the `fromDrizzle(tx, sql)` transactional adapter is a v12 addition — do not use earlier versions. Drizzle was chosen over Kysely specifically because `fromDrizzle` is the canonical pg-boss tx adapter, making Drizzle a runtime dependency regardless of migration tool. MSW 2.14.6 replaces nock — nock does not work with Node 22 native fetch that the Starkbank SDK may use internally.

**Core technologies:**
- `fastify` 5.8.5: HTTP layer — `coerceTypes: false` is mandatory on a money API (never coerce '123' → 123)
- `drizzle-orm` 0.45.2 + `drizzle-kit` 0.31.10: schema-as-code migrations + runtime query builder — required for `fromDrizzle` tx adapter
- `pg-boss` 12.18.2: job queue in same Postgres DB — the only queue that can participate in the same Postgres transaction as `raw_events` INSERT; workers receive an array in v12 (`async (jobs) => { for (const job of jobs) }`)
- `@testcontainers/postgresql` 11.14.0: real Postgres in tests — mocking Postgres in ledger tests is explicitly prohibited
- `vitest` 4.1.6 + `@vitest/coverage-v8` 4.1.6: 90% LoC gate for `@aprumo/core`, 80% for other packages
- `starkbank` 2.40.0: SDK handles ECDSA (secp256k1) via `starkbank.event.parse()` — do not implement ECDSA manually
- `msw` 2.14.6: HTTP mock server for Starkbank connector tests — `onUnhandledRequest: 'error'` is mandatory
- `@biomejs/biome` 2.4.15, `@changesets/cli` 2.31.0

**Critical patterns confirmed by research:**
- Double-entry validation: `CONSTRAINT TRIGGER` (DEFERRABLE INITIALLY DEFERRED), NOT a `CHECK` constraint — CHECK is not deferrable in PostgreSQL
- Starkbank webhooks: ECDSA secp256k1 via SDK `starkbank.event.parse({ content, signature })`, not HMAC
- BigInt at JSON boundary: `bigint` internally, `string` in API responses — `JSON.stringify(42n)` throws TypeError at runtime
- `DEFAULT PRIVILEGES FOR ROLE aprumo_migration` required or new tables won't have correct grants for `aprumo_app`

### Expected Features

**Must have (table stakes) — confirmed by research:**
- Double-entry `post_transaction` with SERIALIZABLE isolation and idempotency
- Account CRUD with 5 canonical types; paginated posting history (cursor-based by posting.id)
- Materialized balance via incremental worker (p99 lag < 1s)
- Exact-once webhook ingest (INSERT raw_events + pg-boss enqueue in same tx)
- Webhook signature validation (ECDSA inbound, HMAC-SHA256 outbound)
- Outbound webhooks with exponential retry, dead-letter after 6, admin replay
- Structured pino logging with redact + Prometheus metrics + `/health`
- Automatic reconciliation worker; OpenAPI/Swagger spec

**Gap analysis — add to v0.1 scope (low effort, high deferral cost):**
- `refundPayment(ref, amount?)` and `getPayment(ref)` on `LedgerConnector` — every PSP has refunds; reconciliation needs polling fallback
- 14-event outbound vocabulary instead of 4 (add: charge.pending, charge.captured, charge.expired, charge.refunded, charge.partially_refunded, dispute.evidence_submitted, dispute.won, dispute.lost, transfer.failed, boleto.paid_overdue, boleto.expired, pix.refund.completed, pix.refund.failed)
- `metadata jsonb` column on `transactions` — zero migration cost now, expensive to retrofit after design partners have data
- `GET /admin/raw-events?status=unreconciled` endpoint

**Brazilian-specific differentiators (core competitive position):**
- PIX devolution semantics: 90-day BACEN window, MED distinction, partial devoluções
- Boleto lifecycle: `boleto.paid_overdue` with acrescimos modeling, partial payment, post-due grace period
- BR card semantics: CIT vs. MIT distinction for recurring (createToken deferred to v0.5)

**Defer to v0.5:** `createToken`, `cancelPayment`, `listEvents`; `pending_balance`/`available_balance`; full dispute lifecycle; boleto partial payment; split payment, smart routing, dunning

**Never build:** Subscription management, invoice generation, tax calculation, PAN storage, FX, P&L reports, managed multi-tenancy in OSS, UI/dashboards in core

### Architecture Approach

The monorepo is 4 packages with a strict dependency hierarchy. `@aprumo/core` knows nothing about connectors. `@aprumo/connector-base` has zero dependencies on other Aprumo packages — it is the shared contract. `@aprumo/webhooks` is the only orchestration boundary that imports both core (via shared DB/pg-boss connection at runtime, not import-time) and connectors (via registry `Record<string, LedgerConnector>`). The contract test suite is exported from connector-base via a `/contract` subpath export so any connector can import and run it without a monorepo dependency.

**Major components:**
1. `@aprumo/core` — schema DDL, `post_transaction` SQL function, REST API (Fastify), balance worker, reconciliation worker, `withRetryOnSerializationFailure` helper
2. `@aprumo/connector-base` — `LedgerConnector` interface (6 methods including refundPayment + getPayment), `Money` branded type, `NormalizedEvent`, HMAC sign/verify helpers, `/contract` suite export
3. `@aprumo/connector-starkbank` — ECDSA webhook verification via SDK, event normalization, MSW-based tests
4. `@aprumo/webhooks` — `POST /webhooks/:provider` ingest, connector registry, `process-webhook` worker, `outbound-dispatcher` worker
5. Docker-compose: explicit `migrate` service (not migrate-on-boot), separate `api` and `worker` processes from same image, `aprumo_app` role for runtime (no UPDATE/DELETE on postings/raw_events), `aprumo_migration` for DDL only

**Testing topology:** Single `PostgreSqlContainer('postgres:16')` in `vitest.globalSetup.ts` shared across all test files. Per-test-file schema isolation (CREATE SCHEMA + migrations per file, DROP SCHEMA CASCADE in afterAll). No PG mocks in the ledger path. MSW `setupServer` for Starkbank HTTP mocking.

### Critical Pitfalls

1. **Exact-once broken — enqueue outside the ledger transaction** — `boss.send(name, data, { db: fromDrizzle(tx, sql) })` must always receive the active Drizzle transaction. Crash between COMMIT and send = silent event loss. Tx rollback after send = phantom postings. Write a crash-injection test before Phase 5 closes.

2. **Deferred constraint silently disabled** — `SET CONSTRAINTS ALL IMMEDIATE` in migrations or test helpers disables the DEFERRABLE trigger. CI must query `pg_constraint.condeferrable AND condeferred` after every migration run. Seed helpers must call `post_transaction`, never INSERT postings directly.

3. **BigInt serialization pressure** — `JSON.stringify(42n)` throws TypeError. Natural "fix" is cast to Number → silent precision loss. Correct fix: custom Fastify serializer converting BigInt to string. API contract: `amount_cents` is always a JSON string. Lock in Phase 1.

4. **Functionally duplicate events with different provider_event_id** — Starkbank may emit two logically identical events with different IDs. Both pass the UNIQUE `(provider, provider_event_id)` guard, both get processed, ledger is double-posted. Reconciliation worker needs business-semantic deduplication: for `charge.paid`, check whether a `charge.id` already has a committed posting.

5. **Starkbank private key committed to repo** — ECDSA private key in a public MIT repo is immediate full API compromise. `.gitignore` + pre-commit secret scanning (lefthook + detect-secrets) must exist before any key is ever generated. Phase 0 task, not negotiable.

## Implications for Roadmap

### Suggested Phase Structure (7 phases)

**Phase 1: Foundation — Schema, Migrations, DB Tooling**
Rationale: Everything calls `post_transaction` or reads ledger tables. Schema and SQL function are bedrock. Deferred constraint trigger, role permissions (REVOKE), and testcontainer infrastructure must exist before any TypeScript code.
Delivers: `pnpm db:migrate` green on fresh PG16; `aprumo_app` cannot UPDATE/DELETE `postings`/`raw_events`; deferred double-entry constraint active; testcontainer globalSetup wired; CI lint+typecheck+migration pipeline green.
Avoids: Double-entry bypass (REVOKE enforced), deferred constraint disabled (pg_constraint CI check), BigInt precision loss (bigint mode in Drizzle schema locked from day 1), schema drift (Drizzle hash check), TDD anti-pattern (testcontainer setup before first test), secrets committed (gitignore + pre-commit hook), pg-boss bloat (autovacuum tuning in docker-compose).

**Phase 2: Core Ledger API — post_transaction, REST Endpoints**
Rationale: Design partners must create accounts, post transactions, and read balances before any PSP integration. Delivers a working ledger primitive that can be demoed independently of Starkbank.
Delivers: `POST /transactions` → `post_transaction()` → 201; POST/GET accounts; GET extrato (cursor-paginated); GET /transactions/:id; GET /health; `withRetryOnSerializationFailure` wrapper; Fastify error handler (40001 → 503); BigInt→string serializer.
Avoids: 40001 retry inside dead transaction (wrapper wraps entire db.transaction call), idempotency race (INSERT ... ON CONFLICT DO NOTHING RETURNING + read-if-empty), BigInt serialization (custom serializer enforced before any response ships).

**Phase 3: Balance Worker and Reconciliation**
Rationale: Worker correctness is testable with synthetic postings from Phase 2. Must exist before connector work so design partners can observe balance updates before any PSP event.
Delivers: pg-boss startup + graceful shutdown; `balance-worker` (cursor-based delta, SELECT FOR UPDATE on account_balance); daily reconciliation job; `aprumo_balance_worker_lag_seconds` Prometheus metric; all pg-boss queue definitions with autovacuum overrides.
Avoids: Full-table scan on postings (cursor pattern), balance calculation on every GET (materialized table only), pg-boss bloat (deleteAfterDays config).

**Phase 4: connector-base + connector-starkbank**
Rationale: `LedgerConnector` interface must be finalized before writing the Starkbank connector. Contract test suite gates whether `parseWebhook` can be trusted by the webhook worker. FakeConnector stub validates no Starkbank-specific assumptions leaked into core.
Delivers: `LedgerConnector` interface with 6 methods (including `refundPayment` and `getPayment`); `NormalizedEvent` canonical shape; `Money` branded type; HMAC helpers; `/contract` subpath export; Starkbank connector implementing all 6 methods; MSW handlers; contract tests green.
Avoids: Abstraction leak — connector concepts into core (FakeConnector validation + pnpm dependency graph CI check), Starkbank ECDSA confusion (SDK `event.parse()`, not manual ECDSA), private key exposure (MSW in tests, sandbox credentials in CI secrets only).
Research flag: Starkbank SDK TypeScript types are partially inaccurate — targeted research spike on Starkbank event taxonomy before writing the NormalizedEvent mapping table.

**Phase 5: Webhooks Inbound — Exact-Once Ingest**
Rationale: Depends on Phase 4 (connector registry requires a connector). Highest-risk phase — exact-once guarantee lives here. Must not ship without crash-injection test confirming raw_events INSERT and job enqueue are atomic.
Delivers: `POST /webhooks/:provider`; connector registry; Starkbank ECDSA verification via SDK; `parseWebhook → NormalizedEvent`; BEGIN SERIALIZABLE: INSERT raw_events + boss.send({ db: fromDrizzle(tx, sql) }); duplicate → 200 OK; `process-webhook` worker applying postings via `post_transaction`; pino logging (no raw payload, no PII).
Avoids: Exact-once broken (crash-injection test mandatory), LGPD PII in logs (pino redact active), functionally duplicate events (business-key deduplication), Starkbank signature timing attack (timingSafeEqual + 5-minute replay window).
Research flag: Business-semantic deduplication rules for each NormalizedEvent type need specification before implementation. PIX duplicate event patterns need documentation. Flag Phase 5 for focused research on PIX duplicate event scenarios before writing the reconciliation worker.

**Phase 6: Webhooks Outbound — Customer Notification Loop**
Rationale: Depends on Phase 5 (outbound_events created by reconciliation worker). Closes end-to-end loop: inbound Starkbank webhook → ledger posting → outbound `charge.paid` to customer URL.
Delivers: `outbound_endpoints` + `outbound_events` schema; `POST /outbound-endpoints`; outbound-dispatcher worker (HMAC-SHA256 signed, exponential retry 1s→5s→30s→5min→30min→2h, dead-letter after 6); DLQ inspection + admin replay; `GET /admin/raw-events?status=unreconciled`; 14-event vocabulary.
Avoids: Weak outbound secret (minimum 32 bytes enforced at registration), timing attack (timingSafeEqual in outbound verify helper), PII in outbound payload (schema validation at event creation).

**Phase 7: Observability, Docs, and Release**
Rationale: Docs and metrics are useful only once behavior exists. Changesets publish is the hard gate — npm packages must be published before design partners can self-host.
Delivers: Full pino redact config; all `aprumo_*` Prometheus metrics; OpenAPI spec with `amount_cents` documented as JSON string; README quickstart; self-host docker-compose with explicit migrate service; connector implementation guide; ADRs 001–009; `@aprumo/core@0.1.0`, `@aprumo/connector-starkbank@0.1.0`, `@aprumo/webhooks@0.1.0` published to npm.
Avoids: Solo dev yak-shaving (ceremony only in this final phase), logging raw payloads (redact config verified).

### Phase Ordering Rationale

- Schema before API: `post_transaction` is a SQL function; TypeScript calls it. No app code can work without it.
- API before balance worker: Worker consumes postings created by `post_transaction`. Phase 2 creates the insertion path; Phase 3 creates the consumption path.
- Balance worker before connectors: Worker correctness is testable with synthetic postings, eliminating one debug variable before real PSP events arrive.
- connector-base before connector-starkbank: Contract test suite defines "correct." Starkbank implements to that contract.
- connector-starkbank before inbound webhooks: Webhook dispatcher requires at least one registered connector.
- Inbound before outbound: `outbound_events` are created by the inbound reconciliation worker.
- Observability + docs last: Metrics are useful over real behavior; docs are useful when behavior is stable.

### Research Flags

Phases needing targeted research during planning:
- **Phase 4 (connector-starkbank):** Starkbank SDK TypeScript types partially inaccurate. Starkbank sandbox PIX devolution and boleto partial-pay event sequences need empirical sandbox verification before writing the NormalizedEvent mapping table.
- **Phase 5 (inbound webhooks):** Business-semantic deduplication rules for each NormalizedEvent type must be specified before coding the reconciliation worker. PIX duplicate event patterns need explicit documentation.

Phases with standard, well-documented patterns (skip research-phase):
- **Phase 1:** PG REVOKE, DEFERRABLE CONSTRAINT TRIGGER, Drizzle migrations, testcontainers globalSetup — all verified.
- **Phase 2:** Fastify v5, withRetryOnSerializationFailure, BigInt serialization — all verified with code examples.
- **Phase 3:** pg-boss queue setup, singleton policy, scheduled jobs — official pg-boss v12 docs.
- **Phase 6:** HMAC-SHA256 with timingSafeEqual, exponential retry — established patterns.
- **Phase 7:** Changesets publish workflow, Prometheus naming — official docs.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified via npm registry + Context7 official docs. `fromDrizzle` adapter confirmed in pg-boss v12 official docs. Starkbank ECDSA behavior confirmed via SDK GitHub README. |
| Features | HIGH | Table stakes verified across 4+ reference products. BR-specific semantics (PIX, boleto) verified against BACEN regulation + Adyen/Asaas PSP docs. Connector interface gaps derived from Hyperswitch patterns. |
| Architecture | HIGH | Package split validated. `fromDrizzle` transactional pattern in official pg-boss docs. Testcontainers globalSetup in official Testcontainers Node.js docs. Drizzle isolationLevel serializable in official Drizzle docs. |
| Pitfalls | HIGH (ledger invariants) / MEDIUM (Starkbank specifics) | Postgres MVCC, deferred constraints, REVOKE: official PG docs. pg-boss exact-once: official docs + community post-mortem. Starkbank duplicate event behavior: MEDIUM — inferred from PSP industry patterns, not direct Starkbank documentation. |

**Overall confidence:** HIGH

### Gaps to Address

- **Starkbank duplicate PIX event patterns:** Research confirmed PSPs emit retried events with different IDs, but specific Starkbank behavior for PIX and boleto edge cases is MEDIUM confidence. During Phase 4/5 planning, run empirical tests against Starkbank sandbox to document exact event sequences for: PIX paid at millisecond boundary, boleto partial pay followed by full pay, PIX MED devolução lifecycle.

- **`pending_balance` schema reservation:** FEATURES research recommends reserving the column even though the feature is v0.5. The exact design (single gauge vs. `pending_credits` + `pending_debits`) should be decided in Phase 1 before migrations are committed — retroactively adding it requires a migration affecting all existing `account_balance` rows.

- **Starkbank SDK type inaccuracies:** During Phase 4 planning, identify which SDK methods will be called and verify their type signatures against actual Starkbank API response shapes. Document all `as unknown as T` casts with justification comments before Phase 4 closes.

- **pg-boss autovacuum tuning values:** Recommended values (`autovacuum_vacuum_scale_factor = 0.01`, `autovacuum_vacuum_cost_delay = 2`) come from community analysis. Verify empirically with a load test during or after Phase 3.
