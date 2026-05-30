# Phase 3: Core Ledger API - Context

**Gathered:** 2026-05-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 builds the **HTTP surface of the ledger** on top of the Phase 2 schema and `post_transaction` function. Fastify 5 REST API exposing: `POST/GET /transactions`, `POST/GET /accounts`, `GET /accounts/:id/postings` (paginated), `GET /health`, and OpenAPI docs. It enforces (by surfacing, not reimplementing) every ledger invariant at the HTTP boundary: double-entry → 422, idempotent duplicates → 200, SERIALIZABLE 40001 → app-level retry then 503, BigInt → JSON string.

**In scope:** route handlers, TypeBox schemas, BigInt serializer, `withRetryOnSerializationFailure`, global error handler, idempotency relay, cursor pagination, health check, OpenAPI generation, API-layer logging/redaction.

**Out of scope (later phases / out of v0.1):** balance worker + reconciliation (Phase 4), webhooks (Phase 7), connectors (Phase 5–6), **authentication / authz** (no auth ships in v0.1), **rate limiting**, **CORS** (no OSS UI), hosted/multi-tenant concerns.

**Note:** This discussion is retroactive — 7 plans (03-01..03-07) already exist. User chose **capture context + replan**: Phase 3 will be re-planned (`/gsd:plan-phase 3`) so plans reflect the decisions below.

</domain>

<decisions>
## Implementation Decisions

### URL & Versioning
- **D-01:** All routes carry a `/v1` prefix — `/v1/transactions`, `/v1/accounts`, `/v1/accounts/:id/postings`. ROADMAP success criteria wrote unprefixed paths as shorthand; the real contract is versioned so it can evolve without breaking self-hosted consumers and future connectors. OpenAPI spec reflects `/v1`.

### Error Contract
- **D-02:** Error responses use **RFC 9457 `application/problem+json`** with `{ type, title, status, detail, code, instance }`. IETF standard, self-documenting for an OSS API third parties integrate. Mappings: unbalanced postings (PG `P0001` / `double_entry_violation:`) → **422**; validation failure → **422**; serialization retry exhausted (40001 ×3) → **503**; idempotency conflict → **200** (relay original, never an error); missing/invalid Idempotency-Key → **400**; not found → **404**.
- **D-03:** The `instance` member of the problem document is set to the request correlation id (see D-08).

### Pagination (`GET /v1/accounts/:id/postings`)
- **D-04:** Cursor sorts by **`created_at` desc with `id` as tiebreaker** — NOT `posting.id` alone. Rationale discovered during discussion: all ids are **UUID v4 (`defaultRandom()`)**, so `posting.id` has no chronological order; an id-only cursor would be meaningless. Migration `0010` added `postings.created_at` precisely for this. API-09's literal "cursor by posting.id desc" is **superseded** by this decision.
- **D-05:** Cursor is **opaque** (base64-encoded `(created_at, id)` tuple). Response envelope: `{ "data": [...], "next_cursor": "<opaque|null>" }`. `next_cursor` is `null` on the last page.
- **D-06:** `?limit=` — **default 50, hard max 200**. A `limit` greater than max is a **client error → 400 problem+json** (explicit, no silent clamping — fits a strict ledger). Caps DB scan cost.

### Health
- **D-07:** **Single `GET /health`** doing both liveness + readiness, including a PG connectivity check (`SELECT 1`). Matches success criterion #5 exactly and is sufficient for the v0.1 docker-compose self-host target. Split `/health/live` + `/health/ready` (k8s-style) is deferred — premature for v0.1 (no orchestrator ships).

### Idempotency
- **D-08 (Idempotency-Key policy):** `Idempotency-Key` is **REQUIRED** on `POST /v1/transactions`. Missing → **400 problem+json** (never auto-generated server-side — a client retry without the key must not silently create a duplicate transaction). Validate: non-empty, max ~255 chars. Maps to `transactions.idempotency_key UNIQUE NOT NULL`. Concurrent-duplicate race is already handled at the PG layer (migration 0008 `EXCEPTION WHEN unique_violation`); the API relays the original tx with 200.

### Observability — Request Correlation
- **D-09:** Generate a per-request correlation id via Fastify `genReqId` (UUID; honor an inbound `X-Request-Id` header if present). **Echo it in the response `X-Request-Id` header** and use it as the problem+json `instance`. Makes self-host debugging and log correlation trivial.

### Observability — Log Redaction
- **D-10:** **Strict redaction** at the API logger (pino `redact`). Redact by default: `authorization`, `cookie`, `set-cookie`, and the `Idempotency-Key` header value; do **not** log request/response bodies — log only a summary (route, method, status, reqId, account `type`s) and **never** amounts, `owner_ref`, `metadata`, CPF/email or other PII. Aligns with CLAUDE.md no-PII rule + LGPD.

### Payload Conventions
- **D-11 (JSON field casing):** **snake_case** for all request/response fields (`amount_cents`, `owner_ref`, `created_at`, `transaction_id`). Matches DB columns 1:1 (no mapping layer) and the `amount_cents` naming already fixed in REQ/ROADMAP.
- **D-12 (ID format):** All entity ids are exposed as **UUID strings** (schema uses `uuid(...).defaultRandom()` for accounts/transactions/postings) — already strings, no BigInt precision concern. `amount_cents` and all money fields remain **BigInt serialized to JSON string** (API-02).

### Claude's Discretion
- TypeBox vs raw JSON Schema (research recommends `@fastify/type-provider-typebox` — discretion confirmed by research).
- Internal module layout, file naming, exact backoff timings for the 40001 retry (≤3 attempts per API-10), test structure (`app.inject()` + Phase 2 testcontainers).
- Concrete `type`/`title` URN strings for each problem+json error type.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 planning inputs
- `.planning/phases/03-core-ledger-api/03-RESEARCH.md` — stack versions, BigInt serializer + retry approach, idempotency relay, test strategy (HIGH confidence)
- `.planning/phases/03-core-ledger-api/03-PATTERNS.md` — pattern map for new files
- `.planning/phases/03-core-ledger-api/03-VALIDATION.md` — validation/success-criteria strategy
- `.planning/ROADMAP.md` §"Phase 3: Core Ledger API" — goal, requirements (API-01..API-13), success criteria

### Locked stack (ADRs — MUST NOT revisit without new ADR)
- `docs/adr/0002-fastify-http-framework.md` — Fastify as HTTP framework
- `docs/adr/0001-postgres-as-ledger-engine.md` — Postgres-only; SERIALIZABLE retry is app-level
- `docs/adr/0009-drizzle-orm-migrations.md` — Drizzle for queries + migrations (e.g. migration 0010)

### Invariants & schema
- `CLAUDE.md` §"Invariantes críticos" — immutability, double-entry, idempotency, SERIALIZABLE retry, no PII logging, BIGINT amount_cents
- `packages/core/src/db/schema.ts` — accounts/transactions/postings/account_balance shapes; **all ids are UUID v4**, `amount_cents` is `bigint({mode:'bigint'})`
- `post_transaction` SQL function (migration `0008`) — sole INSERT path into postings; raises `P0001` on imbalance; handles concurrent-duplicate via `EXCEPTION WHEN unique_violation`
- Migration `0010` — adds `postings.created_at` for cursor pagination (see D-04)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createTestDb()` / testcontainers shared PG container (Phase 2) — reuse for integration tests via Fastify `app.inject()`; no network listener needed.
- `post_transaction(posting_input[])` PG function — API calls it via Drizzle `db.execute(sql\`...\`)`; double-entry + idempotency already enforced at PG layer.
- Drizzle `schema.ts` — typed table defs for all read queries (transactions, accounts, postings, account_balance).

### Established Patterns
- **P0001 error-code convention** with message prefixes (e.g. `double_entry_violation:`) established in Phase 2 — the global error handler discriminates on these to route to 422.
- **SERIALIZABLE isolation** for ledger writes — `withRetryOnSerializationFailure` must wrap the **entire** `db.transaction()` (not the inner query), retrying on `error.code === '40001'`, ≤3 attempts.
- BigInt kept as `mode:'bigint'` in Drizzle for precision; conversion to JSON string happens only at the Fastify serializer boundary (`setSerializerCompiler`).

### Integration Points
- API sits directly on Phase 2's schema + functions; emits no events yet (webhooks = Phase 7).
- `GET /accounts/:id` reads materialized `account_balance` (may be `null` until Phase 4 worker runs — handle gracefully).

</code_context>

<specifics>
## Specific Ideas

- amount/money fields: BigInt → JSON **string**, documented as such in OpenAPI (API-13).
- problem+json error `code` values should be stable, machine-readable strings (e.g. `unbalanced_postings`, `idempotency_key_required`, `serialization_retry_exhausted`) so connectors/consumers can branch on them.

</specifics>

<deferred>
## Deferred Ideas

- **Authentication / authorization** — no auth in v0.1; whole concern deferred (likely enterprise edition or a later milestone).
- **Rate limiting** — deferred; no auth/tenancy to scope it to yet.
- **CORS** — deferred; OSS core ships no browser UI.
- **Split `/health/live` + `/health/ready` k8s probes** — revisit if/when a hosted/orchestrated deployment lands (enterprise).
- **OpenAPI security scheme** — add when auth lands.

None of these expand Phase 3 scope; recorded so they aren't lost.

</deferred>

---

*Phase: 3-core-ledger-api*
*Context gathered: 2026-05-30*
